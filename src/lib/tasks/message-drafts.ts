import "server-only";

import { and, eq } from "drizzle-orm";

import { type OrgTx, withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { resolveAssigneeClan } from "@/domain/clans";

import { activeClanMembershipsForUser } from "./assignee-clan";
import { createTaskRecord } from "./create";
import { parseMessageMissionPlan, type MessageMissionPlan } from "./message-draft-plan";

/** Data sem hora vira meio-dia UTC, como no formulário: não muda de dia com o fuso. */
function dueDateOf(value: string | null): Date | null {
  return value ? new Date(`${value}T12:00:00Z`) : null;
}

/** A prévia vale meia hora, como a do Informativo. */
const DRAFT_TTL_MS = 30 * 60 * 1000;

/**
 * Grava a prévia da missão avulsa pedida por mensagem e cancela a anterior
 * ainda aberta da mesma pessoa: uma prévia por vez evita confirmar a errada.
 */
export async function saveMessageMissionDraftTx(
  tx: OrgTx,
  input: { orgId: string; userId: string; connectionId: string; sourceText: string; plan: MessageMissionPlan; now?: Date },
): Promise<{ id: string }> {
  const now = input.now ?? new Date();
  await tx.update(schema.memberMissionDrafts)
    .set({ status: "cancelled", decidedAt: now })
    .where(and(
      eq(schema.memberMissionDrafts.orgId, input.orgId),
      eq(schema.memberMissionDrafts.requestedBy, input.userId),
      eq(schema.memberMissionDrafts.status, "pending"),
    ));
  const [created] = await tx.insert(schema.memberMissionDrafts).values({
    orgId: input.orgId,
    requestedBy: input.userId,
    connectionId: input.connectionId,
    sourceText: input.sourceText.slice(0, 12_000),
    payload: input.plan,
    expiresAt: new Date(now.getTime() + DRAFT_TTL_MS),
  }).returning({ id: schema.memberMissionDrafts.id });
  return created;
}

class DraftRefused extends Error {}

/**
 * Confirma ou cancela. Confirmar cria as missões com a mesma régua do
 * formulário (`createTask`): pessoa da organização com o clã tirado dos
 * vínculos dela, ou clã ativo. Tudo ou nada: uma recusa desfaz as anteriores.
 */
export async function decideMessageMissionDraft(input: {
  orgId: string;
  userId: string;
  connectionId: string;
  draftId: string;
  decision: "confirm" | "cancel";
  now?: Date;
}): Promise<{ ok: boolean; message: string; taskIds: string[] }> {
  const now = input.now ?? new Date();
  try {
    return await withOrgTx(input.orgId, async (tx) => {
      const [row] = await tx.select().from(schema.memberMissionDrafts)
        .where(and(
          eq(schema.memberMissionDrafts.orgId, input.orgId),
          eq(schema.memberMissionDrafts.id, input.draftId),
          eq(schema.memberMissionDrafts.requestedBy, input.userId),
          eq(schema.memberMissionDrafts.connectionId, input.connectionId),
        ))
        .for("update");
      if (!row) return { ok: false, message: "Prévia não encontrada.", taskIds: [] };
      if (row.status === "confirmed") {
        return { ok: true, message: "Estas missões já foram criadas.", taskIds: Array.isArray(row.createdTaskIds) ? (row.createdTaskIds as string[]) : [] };
      }
      if (row.status === "cancelled") return { ok: input.decision === "cancel", message: "Esta prévia já foi cancelada.", taskIds: [] };
      if (input.decision === "cancel") {
        await tx.update(schema.memberMissionDrafts).set({ status: "cancelled", decidedAt: now }).where(eq(schema.memberMissionDrafts.id, row.id));
        return { ok: true, message: "Prévia cancelada. Nenhuma missão foi criada.", taskIds: [] };
      }
      if (row.expiresAt.getTime() <= now.getTime()) {
        return { ok: false, message: "A prévia venceu. Mande o pedido de novo.", taskIds: [] };
      }
      const plan = parseMessageMissionPlan(row.payload);
      if (!plan) return { ok: false, message: "A prévia está inválida. Mande o pedido de novo.", taskIds: [] };

      const taskIds: string[] = [];
      const names: string[] = [];
      for (const mission of plan.missions) {
        let assigneeId: string | null = null;
        let clanId: string;
        if (mission.assignment.type === "individual") {
          const [membership] = await tx.select({ userId: schema.member.userId }).from(schema.member)
            .where(and(eq(schema.member.organizationId, input.orgId), eq(schema.member.userId, mission.assignment.userId))).limit(1);
          if (!membership) throw new DraftRefused(`${mission.assignment.name} não é mais da Guilda.`);
          const resolution = resolveAssigneeClan(await activeClanMembershipsForUser(tx, input.orgId, mission.assignment.userId));
          if (!resolution.ok) throw new DraftRefused(`${mission.assignment.name}: ${resolution.reason}`);
          assigneeId = mission.assignment.userId;
          clanId = resolution.clanId;
        } else {
          const [clan] = await tx.select({ id: schema.clans.id }).from(schema.clans)
            .where(and(eq(schema.clans.orgId, input.orgId), eq(schema.clans.id, mission.assignment.clanId), eq(schema.clans.active, true))).limit(1);
          if (!clan) throw new DraftRefused(`O clã ${mission.assignment.name} não está mais ativo.`);
          clanId = clan.id;
        }
        const task = await createTaskRecord(tx, {
          orgId: input.orgId,
          creatorId: input.userId,
          assigneeId,
          clanId,
          clientId: plan.clientId,
          title: mission.title,
          description: mission.description,
          priority: mission.priority,
          difficulty: mission.difficulty,
          dueDate: dueDateOf(mission.dueDate),
        });
        taskIds.push(task.id);
        names.push(mission.assignment.type === "individual" ? `${mission.assignment.name}: ${mission.title}` : `Clã ${mission.assignment.name}: ${mission.title}`);
      }
      await tx.update(schema.memberMissionDrafts)
        .set({ status: "confirmed", decidedAt: now, createdTaskIds: taskIds })
        .where(eq(schema.memberMissionDrafts.id, row.id));
      return {
        ok: true,
        message: taskIds.length === 1 ? `Missão criada. ${names[0]}` : `${taskIds.length} missões criadas.\n${names.map((name) => `• ${name}`).join("\n")}`,
        taskIds,
      };
    });
  } catch (error) {
    if (error instanceof DraftRefused) return { ok: false, message: `Nada foi criado. ${error.message}`, taskIds: [] };
    throw error;
  }
}
