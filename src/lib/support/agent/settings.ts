import "server-only";

import { and, eq, isNotNull } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { normalizeTestKeyword } from "@/domain/support-agent";
import { err, type ActionResult } from "@/lib/action-context";

/** Teste do agente (2026-11-19): interruptor e palavra-chave por organização. */
export type AgentSettings = { testEnabled: boolean; testKeyword: string | null };

const s = schema.supportAgentSettings;
const c = schema.supportConversations;

export async function loadAgentSettings(tx: OrgTx, orgId: string): Promise<AgentSettings> {
  const [row] = await tx
    .select({ testEnabled: s.testEnabled, testKeyword: s.testKeyword })
    .from(s)
    .where(eq(s.orgId, orgId))
    .limit(1);
  return row ?? { testEnabled: false, testKeyword: null };
}

/**
 * Só admin chega aqui (a action confere). Desligar é o freio: a rodada aberta
 * vai para uma pessoa, e o worker de saída segura o que já estava na fila.
 */
export async function saveAgentTestSettings(
  tx: OrgTx,
  input: { orgId: string; userId: string; enabled: boolean; keyword: string; now: Date },
): Promise<ActionResult<{ closedRounds: number }>> {
  const typed = input.keyword.trim();
  const keyword = typed ? normalizeTestKeyword(typed) : null;
  if (typed && !keyword) return err("Use uma palavra só, de 3 a 40 letras ou números, sem espaço.");
  if (input.enabled && !keyword) return err("Informe a palavra-chave para ligar o teste.");
  const values = { testEnabled: input.enabled, testKeyword: keyword, updatedBy: input.userId, updatedAt: input.now };
  await tx.insert(s).values({ orgId: input.orgId, ...values }).onConflictDoUpdate({ target: s.orgId, set: values });
  if (input.enabled) return { ok: true, data: { closedRounds: 0 } };

  const closed = await tx
    .update(c)
    .set({ status: "needs_human", aiPausedAt: input.now, aiPauseReason: "test_disabled", updatedAt: input.now })
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
        detail: { reason: "test_disabled" },
      })),
    );
  }
  return { ok: true, data: { closedRounds: closed.length } };
}

/**
 * Abre (ou reinicia) a rodada: a IA volta a conduzir do zero, sem clã nem
 * pessoa. Mandar a palavra de novo depois do encaminhamento recomeça o teste.
 */
export async function startTestRound(tx: OrgTx, input: { orgId: string; conversationId: string; at: Date }): Promise<void> {
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
    detail: { reason: "test_keyword" },
  });
}
