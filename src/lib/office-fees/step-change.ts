import "server-only";

import { and, eq } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import type { FiscalControlStatus, FiscalStepStatus } from "@/domain/fiscal-control";
import { deriveOfficeFeeStatus, type OfficeFeeStage } from "@/domain/office-fee-control";

export const OFFICE_FEE_STAGE_COLUMNS = {
  invoice: "invoiceStatus",
  additional_installment: "additionalInstallmentStatus",
  collection: "collectionStatus",
} as const;

function stepUpdate(stage: OfficeFeeStage, status: FiscalStepStatus) {
  if (stage === "invoice") return { invoiceStatus: status };
  if (stage === "additional_installment") return { additionalInstallmentStatus: status };
  return { collectionStatus: status };
}

/**
 * Muda uma etapa do controle mensal de honorários, recalcula a situação e
 * grava o histórico. Usada pelo clique na etapa e pelo serviço fiscal (nota
 * emitida marca "Nota" como feita; cancelada, reabre). Etapa "não se aplica"
 * nunca muda por aqui. Devolve a situação resultante (null: controle sumiu).
 */
export async function applyOfficeFeeStepChange(
  tx: OrgTx,
  input: {
    orgId: string;
    controlPeriodId: string;
    stage: OfficeFeeStage;
    stepStatus: FiscalStepStatus;
    actorId: string;
  },
): Promise<FiscalControlStatus | null> {
  const t = schema.officeFeeControlPeriods;
  const [control] = await tx
    .select()
    .from(t)
    .where(and(eq(t.orgId, input.orgId), eq(t.id, input.controlPeriodId)))
    .for("update");
  if (!control) return null;
  const previous = control[OFFICE_FEE_STAGE_COLUMNS[input.stage]];
  if (previous === input.stepStatus || previous === "not_applicable" || input.stepStatus === "not_applicable") {
    return control.status;
  }
  const steps: Record<OfficeFeeStage, FiscalStepStatus> = {
    invoice: control.invoiceStatus,
    additional_installment: control.additionalInstallmentStatus,
    collection: control.collectionStatus,
  };
  steps[input.stage] = input.stepStatus;
  const nextStatus = deriveOfficeFeeStatus(steps);
  const now = new Date();
  const completion =
    nextStatus === "completed"
      ? {
          completedBy: control.status === "completed" ? control.completedBy : input.actorId,
          completedAt: control.status === "completed" ? control.completedAt : now,
        }
      : { completedBy: null, completedAt: null };
  await tx
    .update(t)
    .set({ ...stepUpdate(input.stage, input.stepStatus), status: nextStatus, ...completion, updatedBy: input.actorId, updatedAt: now })
    .where(and(eq(t.orgId, input.orgId), eq(t.id, control.id)));
  await tx.insert(schema.officeFeeControlEvents).values({
    orgId: input.orgId,
    controlPeriodId: control.id,
    clientId: control.clientId,
    eventType: "step_updated",
    stage: input.stage,
    previousValue: { status: previous },
    newValue: { status: input.stepStatus },
    actorId: input.actorId,
  });
  if (nextStatus !== control.status) {
    await tx.insert(schema.officeFeeControlEvents).values({
      orgId: input.orgId,
      controlPeriodId: control.id,
      clientId: control.clientId,
      eventType:
        nextStatus === "completed" ? "completed" : control.status === "completed" ? "reopened" : "status_updated",
      previousValue: { status: control.status },
      newValue: { status: nextStatus },
      actorId: input.actorId,
    });
  }
  return nextStatus;
}
