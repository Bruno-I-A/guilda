import "server-only";

import { and, eq } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";

/**
 * Apaga o cadastro de honorário (e, no avulso, o próprio tomador) com as
 * linhas do Mês a mês. Só sem nota: nota emitida ou na fila é documento
 * fiscal, e a cascata a levaria junto.
 */
export async function deleteOfficeFeePayer(
  tx: OrgTx,
  input: { orgId: string; clientId: string | null; takerId: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const profiles = schema.officeFeeProfiles;
  const byPayer = input.clientId ? eq(profiles.clientId, input.clientId) : eq(profiles.takerId, input.takerId!);
  const [profile] = await tx
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(eq(profiles.orgId, input.orgId), byPayer))
    .for("update");
  if (!profile) return { ok: false, error: "Cadastro de honorário não encontrado." };
  const invoices = schema.nfseInvoices;
  const [invoice] = await tx
    .select({ id: invoices.id })
    .from(invoices)
    .where(and(
      eq(invoices.orgId, input.orgId),
      input.clientId ? eq(invoices.clientId, input.clientId) : eq(invoices.takerId, input.takerId!),
    ))
    .limit(1);
  if (invoice) {
    return {
      ok: false,
      error: input.takerId
        ? "Este tomador já tem nota na Guilda e não pode ser apagado. Desmarque “Ativo” para parar de emitir."
        : "Esta empresa já tem nota na Guilda e o cadastro não pode ser apagado.",
    };
  }
  const controls = schema.officeFeeControlPeriods;
  await tx.delete(controls).where(and(eq(controls.orgId, input.orgId), eq(controls.profileId, profile.id)));
  await tx.delete(profiles).where(and(eq(profiles.orgId, input.orgId), eq(profiles.id, profile.id)));
  if (input.takerId) {
    await tx
      .delete(schema.officeFeeTakers)
      .where(and(eq(schema.officeFeeTakers.orgId, input.orgId), eq(schema.officeFeeTakers.id, input.takerId)));
  }
  return { ok: true };
}
