import "server-only";

import { createHash } from "node:crypto";

import { and, asc, desc, eq, gte, ne } from "drizzle-orm";

import { withOrgTx, type OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { companyDisplayName } from "@/domain/company-display-name";
import { enqueueMemberSupportHandoffNotifications } from "@/lib/whatsapp/member-notifications";

import type { OpcoesClassificacao, ResultadoClassificacao } from "../triage/classificacao";
import { retrieveApprovedKnowledge } from "../triage/knowledge";
import { loadTurnInput, suggestionFields, TRIAGE_PROMPT_VERSION, type Candidate, type Classifier } from "../triage/turn-input";
import {
  AI_FAILURE_REASONS,
  askedQuestion,
  decideAfterClassifying,
  decideBeforeClassifying,
  roundFacts,
  type AgentDecision,
  type AgentRunRecord,
} from "./decision";
import { loadRoutingRoster, resolveHandoffRecipients } from "./routing";
import { loadAgentSettings } from "./settings";

/**
 * Um turno do teste do agente (2026-11-19): a IA lê a rodada, decide pelas
 * regras de decision.ts e a fala vai à fila de saída. Só a conversa aberta pela
 * palavra-chave chega aqui; o worker de saída confere a rodada de novo.
 */

const c = schema.supportConversations;
const m = schema.supportMessages;
const runs = schema.supportAiRuns;

function agentRecord(result: Record<string, unknown> | null): AgentRunRecord | null {
  const agent = result?.agent;
  if (!agent || typeof agent !== "object") return null;
  const value = agent as Record<string, unknown>;
  return typeof value.kind === "string"
    ? { kind: value.kind, asked: value.asked === true, discarded: typeof value.discarded === "string" ? value.discarded : null }
    : null;
}

/**
 * Grava a decisão com a conversa travada. Confere de novo o que pode ter mudado
 * enquanto a IA lia: interruptor, pessoa no comando, rodada reiniciada,
 * mensagem nova do cliente. Devolve o motivo do descarte, ou null.
 */
async function applyAgentDecision(
  tx: OrgTx,
  input: { orgId: string; candidate: Candidate; runId: string; startedAt: Date; decision: AgentDecision; now: Date },
): Promise<string | null> {
  const where = and(eq(c.orgId, input.orgId), eq(c.id, input.candidate.conversationId));
  const [row] = await tx
    .select({ status: c.status, startedAt: c.aiTestStartedAt, channelId: c.channelId, contactId: c.contactId })
    .from(c)
    .where(where)
    .for("update");
  if (!row) return "conversa_sumiu";
  if (!(await loadAgentSettings(tx, input.orgId)).testEnabled) return "teste_desligado";
  if (row.status !== "ai_active") return "pessoa_assumiu";
  if (row.startedAt?.getTime() !== input.startedAt.getTime()) return "rodada_reiniciada";
  const [latest] = await tx
    .select({ id: m.id })
    .from(m)
    .where(and(eq(m.orgId, input.orgId), eq(m.conversationId, input.candidate.conversationId), eq(m.actor, "customer")))
    .orderBy(desc(m.occurredAt))
    .limit(1);
  if (latest?.id !== input.candidate.messageId) return "nova_mensagem";
  if (input.decision.kind === "wait") return null;

  const [contact] = await tx
    .select({
      whatsappId: schema.supportContacts.whatsappId,
      displayName: schema.supportContacts.displayName,
      phone: schema.supportContacts.phoneE164,
      clientId: schema.supportContacts.clientId,
      clientName: schema.clients.name,
    })
    .from(schema.supportContacts)
    .leftJoin(schema.clients, and(eq(schema.clients.orgId, schema.supportContacts.orgId), eq(schema.clients.id, schema.supportContacts.clientId)))
    .where(and(eq(schema.supportContacts.orgId, input.orgId), eq(schema.supportContacts.id, row.contactId)));
  if (!contact) return "contato_sumiu";
  const [message] = await tx
    .insert(m)
    .values({
      orgId: input.orgId,
      channelId: row.channelId,
      conversationId: input.candidate.conversationId,
      direction: "outbound",
      actor: "ai",
      source: "guilda_ai",
      messageType: "text",
      text: input.decision.text,
      occurredAt: input.now,
    })
    .returning({ id: m.id });
  await tx.insert(schema.supportMessageEvents).values({
    orgId: input.orgId,
    messageId: message.id,
    eventType: "queued",
    providerEventKey: createHash("sha256").update(`agent\0${input.runId}`, "utf8").digest("hex"),
    occurredAt: input.now,
  });
  // O destino sai do contato, nunca da IA; agentRound é o que o worker confere antes da Meta.
  await tx.insert(schema.supportOutbox).values({
    orgId: input.orgId,
    channelId: row.channelId,
    messageId: message.id,
    payload: { to: contact.whatsappId, text: input.decision.text, agentRound: input.startedAt.toISOString() },
  });

  if (input.decision.kind === "handoff") {
    // Dentro do clã, uma pessoa: a do assunto, a da Carteira ou o líder (routing.ts).
    const choice = input.decision.clanId
      ? await resolveHandoffRecipients(tx, {
          orgId: input.orgId,
          clanId: input.decision.clanId,
          suggested: input.decision.suggestedAttendant,
          clientId: contact.clientId,
        })
      : null;
    await tx
      .update(c)
      .set({
        status: "needs_human",
        assignedClanId: input.decision.clanId,
        assignedUserId: choice?.assigneeUserId ?? null,
        ...(input.decision.summary ? { summary: input.decision.summary } : {}),
        aiPausedAt: input.now,
        aiPauseReason: "ai_handoff",
        lastMessageAt: input.now,
        updatedAt: input.now,
      })
      .where(where);
    const target = [input.decision.clanName ?? "a equipe", choice?.label].filter(Boolean).join(" · ");
    await tx.insert(schema.supportConversationEvents).values({
      orgId: input.orgId,
      conversationId: input.candidate.conversationId,
      eventType: "assigned",
      source: "guilda_ai",
      detail: {
        actorLabel: "IA",
        note: `encaminhou para ${target}`,
        clanId: input.decision.clanId,
        userId: choice?.assigneeUserId ?? null,
        sector: input.decision.sector,
        reason: input.decision.reason,
      },
    });
    // Só quem foi escolhido fica sabendo no WhatsApp pessoal, na mesma transação do encaminhamento.
    if (choice && input.decision.clanName) {
      await enqueueMemberSupportHandoffNotifications(tx, {
        orgId: input.orgId,
        userIds: choice.notifyUserIds,
        conversationId: input.candidate.conversationId,
        roundKey: input.startedAt.toISOString(),
        clanName: input.decision.clanName,
        contactName: contact.clientName ? companyDisplayName(contact.clientName) : (contact.displayName ?? contact.phone ?? contact.whatsappId),
        summary: input.decision.summary,
      });
    }
  } else {
    await tx.update(c).set({ lastMessageAt: input.now, updatedAt: input.now }).where(where);
  }
  return null;
}

/** A linha "running" é a trava contra ler o mesmo turno duas vezes, como na sombra. */
export async function runAgentTurn(
  orgId: string,
  candidate: Candidate,
  options: OpcoesClassificacao,
  classify: Classifier,
): Promise<boolean> {
  const claimed = await withOrgTx(orgId, async (tx) => {
    const [conversation] = await tx
      .select({ startedAt: c.aiTestStartedAt })
      .from(c)
      .where(and(eq(c.orgId, orgId), eq(c.id, candidate.conversationId)));
    const startedAt = conversation?.startedAt;
    if (!startedAt) return null;
    const [run] = await tx
      .insert(runs)
      .values({
        orgId,
        conversationId: candidate.conversationId,
        triggerMessageId: candidate.messageId,
        status: "running",
        model: options.modelo,
        promptVersion: TRIAGE_PROMPT_VERSION,
      })
      .onConflictDoNothing()
      .returning({ id: runs.id });
    if (!run) return null;
    // As leituras da rodada são as disparadas por mensagem dela: mesmo relógio da mensagem.
    const previous = await tx
      .select({ result: runs.result })
      .from(runs)
      .innerJoin(m, and(eq(m.orgId, runs.orgId), eq(m.id, runs.triggerMessageId)))
      .where(
        and(
          eq(runs.orgId, orgId),
          eq(runs.conversationId, candidate.conversationId),
          gte(m.occurredAt, startedAt),
          ne(runs.id, run.id),
        ),
      )
      .orderBy(asc(runs.createdAt));
    const settings = await loadAgentSettings(tx, orgId);
    const input = await loadTurnInput(tx, orgId, candidate, { startedAt, keyword: settings.testKeyword });
    const clans = await tx
      .select({ id: schema.clans.id, name: schema.clans.name, slug: schema.clans.slug })
      .from(schema.clans)
      .where(and(eq(schema.clans.orgId, orgId), eq(schema.clans.active, true)));
    const knowledge = await retrieveApprovedKnowledge(tx, orgId, input.current);
    const roster = await loadRoutingRoster(tx, orgId);
    const records = previous.map((row) => agentRecord(row.result)).filter((record): record is AgentRunRecord => record !== null);
    return { runId: run.id, startedAt, facts: roundFacts(records), runsInRound: previous.length, input, clans, knowledge, roster };
  });
  if (!claimed) return false;

  const started = Date.now();
  const now = new Date();
  let result: ResultadoClassificacao | null = null;
  let decision = decideBeforeClassifying({
    current: claimed.input.current,
    facts: claimed.facts,
    runsInRound: claimed.runsInRound,
    clans: claimed.clans,
    now,
  });
  if (!decision) {
    result = await classify(claimed.input.current, claimed.input.history, {
      ...options,
      knowledge: claimed.knowledge,
      modo: "conversa",
      perguntasFeitas: claimed.facts.questionsAsked,
      roster: claimed.roster,
    });
    decision = decideAfterClassifying({ result, facts: claimed.facts, clans: claimed.clans, now });
  }
  const final = decision;
  const fallback = result?.classificacao.fallback?.motivo ?? null;
  await withOrgTx(orgId, async (tx) => {
    const discarded = await applyAgentDecision(tx, {
      orgId,
      candidate,
      runId: claimed.runId,
      startedAt: claimed.startedAt,
      decision: final,
      now: new Date(),
    });
    await tx
      .update(runs)
      .set({
        status: fallback && AI_FAILURE_REASONS.has(fallback) ? "failed" : "done",
        result: {
          ...(result ? suggestionFields(result) : {}),
          mode: "conversa",
          agent: { kind: final.kind, asked: askedQuestion(final), discarded },
        },
        fallbackReason: fallback,
        model: result?.modelo ?? options.modelo,
        inputTokens: result?.tokensEntrada ?? 0,
        outputTokens: result?.tokensSaida ?? 0,
        latencyMs: Date.now() - started,
        finishedAt: new Date(),
      })
      .where(and(eq(runs.orgId, orgId), eq(runs.id, claimed.runId)));
  });
  return true;
}
