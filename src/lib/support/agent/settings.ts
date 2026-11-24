import "server-only";

import { and, eq, isNotNull } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { normalizeTestKeyword, type AgentMode } from "@/domain/support-agent";
import { err, type ActionResult } from "@/lib/action-context";

/**
 * Agente de IA por organização: modo (2026-11-23) e palavra-chave do teste
 * (2026-11-19). "Só teste" abre rodada só com a palavra; "Todos os clientes"
 * abre em toda conversa nova, e a palavra, se houver, ainda reinicia a rodada.
 */
export type AgentSettings = { mode: AgentMode; testKeyword: string | null };

const s = schema.supportAgentSettings;
const c = schema.supportConversations;

export async function loadAgentSettings(tx: OrgTx, orgId: string): Promise<AgentSettings> {
  const [row] = await tx
    .select({ mode: s.agentMode, testKeyword: s.testKeyword })
    .from(s)
    .where(eq(s.orgId, orgId))
    .limit(1);
  return row ?? { mode: "off", testKeyword: null };
}

/**
 * Só admin chega aqui (a action confere). Desligar é o freio: a rodada aberta
 * vai para uma pessoa, e o worker de saída segura o que já estava na fila.
 * Passar de "Todos" para "Só teste" deixa as rodadas abertas terminarem.
 */
export async function saveAgentSettings(
  tx: OrgTx,
  input: { orgId: string; userId: string; mode: AgentMode; keyword: string; now: Date },
): Promise<ActionResult<{ closedRounds: number }>> {
  const typed = input.keyword.trim();
  const keyword = typed ? normalizeTestKeyword(typed) : null;
  if (typed && !keyword) return err("Use uma palavra só, de 3 a 40 letras ou números, sem espaço.");
  if (input.mode === "test" && !keyword) return err("Informe a palavra-chave para ligar o teste.");
  const values = { agentMode: input.mode, testKeyword: keyword, updatedBy: input.userId, updatedAt: input.now };
  await tx.insert(s).values({ orgId: input.orgId, ...values }).onConflictDoUpdate({ target: s.orgId, set: values });
  if (input.mode !== "off") return { ok: true, data: { closedRounds: 0 } };

  const closed = await tx
    .update(c)
    .set({ status: "needs_human", aiPausedAt: input.now, aiPauseReason: "agent_disabled", updatedAt: input.now })
    .where(and(eq(c.orgId, input.orgId), eq(c.status, "ai_active"), isNotNull(c.aiTestStartedAt)))
    .returning({ id: c.id });
  if (closed.length > 0) {
    await tx.insert(schema.supportConversationEvents).values(
      closed.map(({ id }) => ({
        orgId: input.orgId,
        conversationId: id,
        eventType: "ai_paused" as const,
        actorUserId: input.userId,
        source: "system" as const,
        detail: { reason: "agent_disabled" },
      })),
    );
  }
  return { ok: true, data: { closedRounds: closed.length } };
}

/**
 * Abre (ou reinicia) a rodada: a IA volta a conduzir do zero, sem clã nem
 * pessoa. Abre pela palavra-chave ou, com o agente para todos, pela conversa nova.
 */
export async function startAgentRound(
  tx: OrgTx,
  input: { orgId: string; conversationId: string; at: Date; reason: "test_keyword" | "agent_live" },
): Promise<void> {
  await tx
    .update(c)
    .set({
      status: "ai_active",
      aiTestStartedAt: input.at,
      aiPausedAt: null,
      aiPauseReason: null,
      assignedUserId: null,
      assignedClanId: null,
      updatedAt: new Date(),
    })
    .where(and(eq(c.orgId, input.orgId), eq(c.id, input.conversationId)));
  await tx.insert(schema.supportConversationEvents).values({
    orgId: input.orgId,
    conversationId: input.conversationId,
    eventType: "ai_resumed",
    source: "cloud_api",
    detail: { reason: input.reason },
  });
}
