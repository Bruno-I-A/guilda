import "server-only";

import { and, eq } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";

import { ensureFiscalProfile, fiscalProfileSnapshot } from "./materialize";

export type NfseIssuerChange = "updated" | "unchanged" | "missing" | "mei";

/**
 * Marca na Ficha Fiscal se a empresa emite NFS-e (o "É de serviço? Sim · Não"
 * da aba XML das notas). Mesma versão e mesmo histórico da Ficha; cria a
 * Ficha se ela ainda não existe. MEI fica de fora, como na Ficha.
 */
export async function setNfseIssuer(
  tx: OrgTx,
  input: { orgId: string; clientId: string; actorId: string; issues: boolean },
): Promise<NfseIssuerChange> {
  const [client] = await tx
    .select({ id: schema.clients.id, taxRegime: schema.clients.taxRegime })
    .from(schema.clients)
    .where(and(eq(schema.clients.orgId, input.orgId), eq(schema.clients.id, input.clientId)))
    .for("update");
  if (!client) return "missing";
  if (client.taxRegime === "mei") return "mei";

  const value = input.issues ? "required" : "not_required";
  const profile = await ensureFiscalProfile(tx, { orgId: input.orgId, clientId: client.id, actorId: input.actorId });
  if (profile.nfseIssuerApplicability === value) return "unchanged";

  const p = schema.fiscalClientProfiles;
  const [updated] = await tx
    .update(p)
    .set({ nfseIssuerApplicability: value, version: profile.version + 1, updatedBy: input.actorId, updatedAt: new Date() })
    .where(and(eq(p.orgId, input.orgId), eq(p.id, profile.id)))
    .returning();
  await tx.insert(schema.fiscalClientProfileEvents).values({
    orgId: input.orgId,
    profileId: updated.id,
    clientId: updated.clientId,
    eventType: "updated",
    version: updated.version,
    snapshot: fiscalProfileSnapshot(updated),
    changedFields: ["nfseIssuerApplicability"],
    actorId: input.actorId,
  });
  return "updated";
}
