import "server-only";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { withOrgTx, type OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { messageLabel } from "@/domain/support-inbox";
import { getAiConfig } from "@/lib/ai/config";

import { classificarMensagem, type OpcoesClassificacao, type ResultadoClassificacao } from "./classificacao";
import type { MensagemHistoricoClassificacao } from "./contexto";

/**
 * Modo sombra da triagem (decisão de 2026-11-09): a IA lê cada conversa nova e
 * grava o que faria — setor, urgência, resumo, pergunta ou resposta —, mas NADA
 * vai ao cliente. A equipe compara com o que ela mesma fez antes de qualquer
 * resposta automática. Desligado por padrão: as mensagens dos clientes só vão
 * à Anthropic com SUPPORT_AI_MODE=shadow.
 */

export type SupportAiMode = "off" | "shadow";

export function supportAiMode(): SupportAiMode {
  return process.env.SUPPORT_AI_MODE?.trim() === "shadow" ? "shadow" : "off";
}

/** Bump quando o prompt mudar de verdade: a leitura antiga fica marcada com a versão dela. */
export const TRIAGE_PROMPT_VERSION = "scharff-2026-08-04";

/** Espera o cliente terminar de escrever: várias mensagens seguidas viram um turno só. */
function debounceMs(): number {
  const seconds = Number(process.env.SUPPORT_TRIAGE_DEBOUNCE_SECONDS);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 20_000;
}

/** Teto de leituras por conversa: o custo não cresce com cliente que escreve muito. */
const MAX_RUNS_PER_CONVERSATION = 6;
const HISTORY_LIMIT = 20;

type Candidate = { conversationId: string; contactId: string; messageId: string };

async function findCandidates(tx: OrgTx, orgId: string, cutoff: Date, limit: number): Promise<Candidate[]> {
  const result = await tx.execute<{ conversation_id: string; contact_id: string; message_id: string }>(sql`
    SELECT c.id AS conversation_id, c.contact_id, m.id AS message_id
    FROM support_conversations c
    JOIN LATERAL (
      SELECT id, actor, occurred_at FROM support_messages
      WHERE org_id = c.org_id AND conversation_id = c.id
      ORDER BY occurred_at DESC LIMIT 1
    ) m ON true
    WHERE c.org_id = ${orgId}
      AND c.resolved_at IS NULL
      AND c.assigned_user_id IS NULL
      AND m.actor = 'customer'
      AND m.occurred_at < ${cutoff.toISOString()}::timestamptz
      AND NOT EXISTS (SELECT 1 FROM support_ai_runs r WHERE r.org_id = c.org_id AND r.trigger_message_id = m.id)
      AND (SELECT count(*) FROM support_ai_runs r WHERE r.org_id = c.org_id AND r.conversation_id = c.id) < ${MAX_RUNS_PER_CONVERSATION}
    ORDER BY m.occurred_at
    LIMIT ${limit}
  `);
  return result.rows.map((row) => ({ conversationId: row.conversation_id, contactId: row.contact_id, messageId: row.message_id }));
}

const AUTHOR: Record<string, MensagemHistoricoClassificacao["autor"]> = { customer: "cliente", ai: "ia", attendant: "atendente", system: "ia" };

/**
 * O turno atual são as mensagens do cliente desde a última fala da equipe; o
 * resto do contato vira histórico, marcado como ciclo anterior quando é de
 * outra conversa. Mídia entra só como rótulo ("Documento"): o arquivo não sai.
 */
async function loadInput(tx: OrgTx, orgId: string, candidate: Candidate) {
  const m = schema.supportMessages;
  const recent = await tx
    .select({ conversationId: m.conversationId, actor: m.actor, text: m.text, messageType: m.messageType, occurredAt: m.occurredAt })
    .from(m)
    .innerJoin(schema.supportConversations, and(eq(schema.supportConversations.orgId, m.orgId), eq(schema.supportConversations.id, m.conversationId)))
    .where(and(eq(m.orgId, orgId), eq(schema.supportConversations.contactId, candidate.contactId)))
    .orderBy(desc(m.occurredAt))
    .limit(HISTORY_LIMIT + 10);
  const ordered = recent.reverse();
  let split = ordered.length;
  while (split > 0 && ordered[split - 1].actor === "customer" && ordered[split - 1].conversationId === candidate.conversationId) split -= 1;
  const current = ordered.slice(split).map(messageLabel).join("\n");
  const history: MensagemHistoricoClassificacao[] = ordered.slice(0, split).slice(-HISTORY_LIMIT).map((message) => ({
    autor: AUTHOR[message.actor] ?? "cliente",
    conteudo: messageLabel(message),
    ciclo: message.conversationId === candidate.conversationId ? "atual" : "anterior",
  }));
  return { current, history };
}

export type Classifier = (current: string, history: readonly MensagemHistoricoClassificacao[], options: OpcoesClassificacao) => Promise<ResultadoClassificacao>;

const defaultClassifier: Classifier = (current, history, options) => classificarMensagem(current, history, [], 0, null, options);

async function triageOne(orgId: string, candidate: Candidate, options: OpcoesClassificacao, classify: Classifier): Promise<boolean> {
  const runs = schema.supportAiRuns;
  // A linha "running" é a trava: outro processo que chegue junto bate no índice único e desiste.
  const claimed = await withOrgTx(orgId, async (tx) => {
    const [run] = await tx
      .insert(runs)
      .values({ orgId, conversationId: candidate.conversationId, triggerMessageId: candidate.messageId, status: "running", model: options.modelo, promptVersion: TRIAGE_PROMPT_VERSION })
      .onConflictDoNothing()
      .returning({ id: runs.id });
    return run ? { runId: run.id, input: await loadInput(tx, orgId, candidate) } : null;
  });
  if (!claimed) return false;

  const started = Date.now();
  const result = await classify(claimed.input.current, claimed.input.history, options);
  const fallback = result.classificacao.fallback?.motivo ?? null;
  await withOrgTx(orgId, (tx) =>
    tx
      .update(runs)
      .set({
        status: fallback === "erro_api" || fallback === "sem_api_key" ? "failed" : "done",
        result: {
          sector: result.classificacao.setor_sugerido,
          urgency: result.classificacao.urgencia,
          confidence: result.classificacao.confianca,
          summary: result.classificacao.resumo,
          question: result.perguntaEsclarecimento,
          directAnswer: result.respostaDireta,
        },
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
      try {
        if (await triageOne(orgId, candidate, options, input.classify ?? defaultClassifier)) triaged += 1;
      } catch (error) {
        console.error("[atendimento] triagem em sombra falhou:", error instanceof Error ? error.message : "erro desconhecido");
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
    .where(and(eq(runs.orgId, orgId), inArray(runs.conversationId, [...conversationIds]), eq(runs.status, "done")))
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
      fallbackReason: row.fallbackReason,
      at: (row.finishedAt ?? new Date()).toISOString(),
    });
  }
  return map;
}
