import "server-only";

import { and, desc, eq } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { matchTestKeyword } from "@/domain/support-agent";
import { pickTurnAttachment, turnMessageText, type TurnAttachment } from "@/domain/support-attachment";

import type { OpcoesClassificacao, ResultadoClassificacao } from "./classificacao";
import type { MensagemHistoricoClassificacao } from "./contexto";

/**
 * O que a sombra e o teste do agente (2026-11-19) compartilham: o candidato, a
 * chamada à IA, a versão do prompt e a montagem do turno. Mora fora de
 * shadow.ts para o turno do agente não importar o ciclo que o chama.
 */

/** Bump quando o prompt mudar de verdade: a leitura antiga fica marcada com a versão dela. */
export const TRIAGE_PROMPT_VERSION = "guilda-2026-11-23-v5";

const HISTORY_LIMIT = 20;

/** `live`: conversa em rodada de teste (ai_active com ai_test_started_at). */
export type Candidate = { conversationId: string; contactId: string; messageId: string; live: boolean };

export type Classifier = (
  current: string,
  history: readonly MensagemHistoricoClassificacao[],
  options: OpcoesClassificacao,
) => Promise<ResultadoClassificacao>;

const AUTHOR: Record<string, MensagemHistoricoClassificacao["autor"]> = { customer: "cliente", ai: "ia", attendant: "atendente", system: "ia" };

/**
 * O turno atual são as mensagens do cliente desde a última fala da equipe; o
 * resto do contato vira histórico, marcado como ciclo anterior quando é de
 * outra conversa ou de antes da rodada de teste. Na rodada, a palavra-chave sai
 * do texto. Mídia entra como rótulo com a legenda e o nome do arquivo; o arquivo
 * em si só vai à IA no teste do agente (`attachment`, baixado em
 * agent/attachment.ts), nunca na sombra.
 */
export async function loadTurnInput(
  tx: OrgTx,
  orgId: string,
  candidate: Candidate,
  round: { startedAt: Date; keyword: string | null } | null = null,
): Promise<{ current: string; history: MensagemHistoricoClassificacao[]; attachment: TurnAttachment | null }> {
  const m = schema.supportMessages;
  const recent = await tx
    .select({ id: m.id, conversationId: m.conversationId, actor: m.actor, text: m.text, messageType: m.messageType, content: m.content, occurredAt: m.occurredAt })
    .from(m)
    .innerJoin(schema.supportConversations, and(eq(schema.supportConversations.orgId, m.orgId), eq(schema.supportConversations.id, m.conversationId)))
    .where(and(eq(m.orgId, orgId), eq(schema.supportConversations.contactId, candidate.contactId)))
    .orderBy(desc(m.occurredAt))
    .limit(HISTORY_LIMIT + 10);
  const ordered = recent.reverse();
  const inRound = (message: (typeof ordered)[number]) =>
    message.conversationId === candidate.conversationId && (!round || message.occurredAt >= round.startedAt);
  let split = ordered.length;
  while (split > 0 && ordered[split - 1].actor === "customer" && inRound(ordered[split - 1])) split -= 1;
  const turn = ordered.slice(split);
  const current = turn
    .map((message) =>
      round && message.text !== null ? matchTestKeyword(turnMessageText(message), round.keyword).rest : turnMessageText(message),
    )
    .filter((text) => text.trim() !== "")
    .join("\n");
  const history: MensagemHistoricoClassificacao[] = ordered
    .slice(0, split)
    .slice(-HISTORY_LIMIT)
    .map((message) => ({
      autor: AUTHOR[message.actor] ?? "cliente",
      conteudo: turnMessageText(message),
      ciclo: inRound(message) ? "atual" : "anterior",
    }));
  return { current, history, attachment: round ? pickTurnAttachment(turn) : null };
}

/** O que a tela mostra como "Leitura da IA": igual na sombra e no teste. */
export function suggestionFields(result: ResultadoClassificacao): Record<string, unknown> {
  return {
    sector: result.classificacao.setor_sugerido,
    urgency: result.classificacao.urgencia,
    confidence: result.classificacao.confianca,
    summary: result.classificacao.resumo,
    question: result.perguntaEsclarecimento,
    directAnswer: result.respostaDireta,
    sources: result.fontesConhecimento,
  };
}
