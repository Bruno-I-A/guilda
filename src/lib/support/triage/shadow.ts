import "server-only";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { withOrgTx, type OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { getAiConfig } from "@/lib/ai/config";

import { runAgentTurn } from "../agent/turn";
import { classificarMensagem, type OpcoesClassificacao } from "./classificacao";
import { retrieveApprovedKnowledge } from "./knowledge";
import { loadTurnInput, suggestionFields, TRIAGE_PROMPT_VERSION, type Candidate, type Classifier } from "./turn-input";

export { TRIAGE_PROMPT_VERSION, type Classifier } from "./turn-input";

/**
 * Modo sombra da triagem (decisão de 2026-11-09): a IA lê cada conversa nova e
 * grava o que faria — setor, urgência, resumo, pergunta ou resposta —, mas NADA
 * vai ao cliente. A equipe compara com o que ela mesma fez antes de qualquer
 * resposta automática. Mesmo quando um atendente assume a conversa, o modo
 * sombra continua sugerindo internamente: assumir só impede automação de saída.
 * Desligado por padrão: as mensagens dos clientes só vão
 * à Anthropic com SUPPORT_AI_MODE=shadow.
 */

export type SupportAiMode = "off" | "shadow";

export function supportAiMode(): SupportAiMode {
  return process.env.SUPPORT_AI_MODE?.trim() === "shadow" ? "shadow" : "off";
}

/** Espera o cliente terminar de escrever: várias mensagens seguidas viram um turno só. */
function debounceMs(): number {
  const seconds = Number(process.env.SUPPORT_TRIAGE_DEBOUNCE_SECONDS);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 20_000;
}

/**
 * Teto de leituras por conversa: o custo não cresce com cliente que escreve
 * muito. A rodada do teste do agente tem o teto dela (AGENT_TURN_CAP), que
 * encaminha em vez de calar; por isso fica fora deste.
 */
const MAX_RUNS_PER_CONVERSATION = 6;

async function findCandidates(tx: OrgTx, orgId: string, cutoff: Date, limit: number): Promise<Candidate[]> {
  const result = await tx.execute<{ conversation_id: string; contact_id: string; message_id: string; live: boolean }>(sql`
    SELECT c.id AS conversation_id, c.contact_id, m.id AS message_id,
           (c.status = 'ai_active' AND c.ai_test_started_at IS NOT NULL) AS live
    FROM support_conversations c
    JOIN LATERAL (
      SELECT id, actor, occurred_at FROM support_messages
      WHERE org_id = c.org_id AND conversation_id = c.id
      ORDER BY occurred_at DESC LIMIT 1
    ) m ON true
    WHERE c.org_id = ${orgId}
      AND c.resolved_at IS NULL
      AND m.actor = 'customer'
      AND m.occurred_at < ${cutoff.toISOString()}::timestamptz
      AND NOT EXISTS (SELECT 1 FROM support_ai_runs r WHERE r.org_id = c.org_id AND r.trigger_message_id = m.id)
      AND (
        (c.status = 'ai_active' AND c.ai_test_started_at IS NOT NULL)
        OR (SELECT count(*) FROM support_ai_runs r WHERE r.org_id = c.org_id AND r.conversation_id = c.id) < ${MAX_RUNS_PER_CONVERSATION}
      )
    ORDER BY m.occurred_at
    LIMIT ${limit}
  `);
  return result.rows.map((row) => ({
    conversationId: row.conversation_id,
    contactId: row.contact_id,
    messageId: row.message_id,
    live: row.live === true,
  }));
}

const defaultClassifier: Classifier = (current, history, options) =>
  classificarMensagem(current, history, options.roster ?? [], options.perguntasFeitas ?? 0, null, options);

async function triageOne(orgId: string, candidate: Candidate, options: OpcoesClassificacao, classify: Classifier): Promise<boolean> {
  const runs = schema.supportAiRuns;
  // A linha "running" é a trava: outro processo que chegue junto bate no índice único e desiste.
  const claimed = await withOrgTx(orgId, async (tx) => {
    const [run] = await tx
      .insert(runs)
      .values({ orgId, conversationId: candidate.conversationId, triggerMessageId: candidate.messageId, status: "running", model: options.modelo, promptVersion: TRIAGE_PROMPT_VERSION })
      .onConflictDoNothing()
      .returning({ id: runs.id });
    if (!run) return null;
    const input = await loadTurnInput(tx, orgId, candidate);
    const knowledge = await retrieveApprovedKnowledge(tx, orgId, input.current);
    return { runId: run.id, input, knowledge };
  });
  if (!claimed) return false;

  const started = Date.now();
  const result = await classify(claimed.input.current, claimed.input.history, {
    ...options,
    knowledge: claimed.knowledge,
  });
  const fallback = result.classificacao.fallback?.motivo ?? null;
  await withOrgTx(orgId, (tx) =>
    tx
      .update(runs)
      .set({
        status: fallback === "erro_api" || fallback === "sem_api_key" ? "failed" : "done",
        result: { ...suggestionFields(result), mode: "sombra" },
        fallbackReason: fallback,
        model: result.modelo,
        inputTokens: result.tokensEntrada,
        outputTokens: result.tokensSaida,
        latencyMs: Date.now() - started,
        finishedAt: new Date(),
      })
      .where(and(eq(runs.orgId, orgId), eq(runs.id, claimed.runId))),
  );
  return true;
}

export async function runSupportTriageCycle(input: { now?: Date; limit?: number; classify?: Classifier } = {}): Promise<{ triaged: number }> {
  if (supportAiMode() !== "shadow") return { triaged: 0 };
  const config = getAiConfig();
  if (!config.apiKey && !input.classify) return { triaged: 0 };
  const options: OpcoesClassificacao = { apiKey: config.apiKey, modelo: config.model };
  const cutoff = new Date((input.now ?? new Date()).getTime() - debounceMs());
  const organizations = await db.select({ id: schema.organization.id }).from(schema.organization).orderBy(asc(schema.organization.id));
  let triaged = 0;
  for (const { id: orgId } of organizations) {
    const candidates = await withOrgTx(orgId, (tx) => findCandidates(tx, orgId, cutoff, input.limit ?? 5));
    for (const candidate of candidates) {
      const classify = input.classify ?? defaultClassifier;
      try {
        // Rodada do teste do agente conversa de verdade; o resto só grava a leitura.
        const done = candidate.live
          ? await runAgentTurn(orgId, candidate, options, classify)
          : await triageOne(orgId, candidate, options, classify);
        if (done) triaged += 1;
      } catch (error) {
        const where = candidate.live ? "turno do agente" : "triagem em sombra";
        console.error(`[atendimento] ${where} falhou:`, error instanceof Error ? error.message : "erro desconhecido");
      }
    }
  }
  return { triaged };
}

export interface SupportAiSuggestion {
  sector: string;
  urgency: "baixa" | "media" | "alta";
  confidence: number;
  summary: string;
  question: string | null;
  directAnswer: string | null;
  sources: Array<{ id: string; title: string; version: number }>;
  fallbackReason: string | null;
  at: string;
}

/** A leitura mais recente de cada conversa, para a fila e a tela. */
export async function loadLatestSuggestions(tx: OrgTx, orgId: string, conversationIds: readonly string[]): Promise<Map<string, SupportAiSuggestion>> {
  if (conversationIds.length === 0) return new Map();
  const runs = schema.supportAiRuns;
  const rows = await tx
    .selectDistinctOn([runs.conversationId], { conversationId: runs.conversationId, result: runs.result, fallbackReason: runs.fallbackReason, finishedAt: runs.finishedAt })
    .from(runs)
    // Turno do agente que não chamou a IA (pergunta de assunto, teto) não tem leitura para mostrar.
    .where(and(eq(runs.orgId, orgId), inArray(runs.conversationId, [...conversationIds]), eq(runs.status, "done"), sql`(${runs.result} ->> 'sector') IS NOT NULL`))
    .orderBy(runs.conversationId, desc(runs.createdAt));
  const map = new Map<string, SupportAiSuggestion>();
  for (const row of rows) {
    const result = (row.result ?? {}) as Record<string, unknown>;
    map.set(row.conversationId, {
      sector: typeof result.sector === "string" ? result.sector : "outro",
      urgency: result.urgency === "alta" || result.urgency === "baixa" ? result.urgency : "media",
      confidence: typeof result.confidence === "number" ? result.confidence : 0,
      summary: typeof result.summary === "string" ? result.summary : "",
      question: typeof result.question === "string" ? result.question : null,
      directAnswer: typeof result.directAnswer === "string" ? result.directAnswer : null,
      sources: Array.isArray(result.sources)
        ? result.sources.flatMap((source) => {
            if (!source || typeof source !== "object") return [];
            const candidate = source as Record<string, unknown>;
            return typeof candidate.id === "string" &&
              typeof candidate.title === "string" &&
              typeof candidate.version === "number"
              ? [{ id: candidate.id, title: candidate.title, version: candidate.version }]
              : [];
          })
        : [],
      fallbackReason: row.fallbackReason,
      at: (row.finishedAt ?? new Date()).toISOString(),
    });
  }
  return map;
}
