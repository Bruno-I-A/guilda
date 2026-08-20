import "server-only";

import { and, asc, eq } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import {
  deriveOfficeFeeStatus,
  initialOfficeFeeSteps,
} from "@/domain/office-fee-control";
import { lockActiveClansForMembershipRead } from "@/lib/clans/locks";

type OfficeFeeProfile = typeof schema.officeFeeProfiles.$inferSelect;

export function officeFeeProfileSnapshot(
  profile: OfficeFeeProfile,
): schema.OfficeFeeProfileSnapshot {
  return {
    version: profile.version,
    billingMethod: profile.billingMethod,
    chargesAdditionalInstallment: profile.chargesAdditionalInstallment,
    monthlyFee: profile.monthlyFee,
    permanentNotes: profile.permanentNotes,
  };
}

export interface MaterializeOfficeFeeControlResult {
  created: number;
  existing: number;
}

/**
 * Abre uma linha somente para empresas que têm honorário cadastrado. Dados de
 * cobrança e responsável ficam congelados para que uma mudança futura não
 * altere competências já fechadas.
 */
export async function materializeOfficeFeeControl(
  tx: OrgTx,
  input: {
    orgId: string;
    actorId: string;
    periodYear: number;
    periodMonth: number;
  },
): Promise<MaterializeOfficeFeeControlResult> {
  await lockActiveClansForMembershipRead(tx, input.orgId);
  const rows = await tx
    .select({
      clientId: schema.clients.id,
      clientName: schema.clients.name,
      clientCnpj: schema.clients.cnpj,
      responsibleUserId: schema.fiscalPortfolios.userId,
      profile: schema.officeFeeProfiles,
    })
    .from(schema.officeFeeProfiles)
    .innerJoin(
      schema.clients,
      and(
        eq(schema.clients.orgId, schema.officeFeeProfiles.orgId),
        eq(schema.clients.id, schema.officeFeeProfiles.clientId),
      ),
    )
    .leftJoin(
      schema.fiscalPortfolios,
      and(
        eq(schema.fiscalPortfolios.orgId, schema.clients.orgId),
        eq(schema.fiscalPortfolios.clientId, schema.clients.id),
      ),
    )
    .where(
      and(
        eq(schema.officeFeeProfiles.orgId, input.orgId),
        eq(schema.clients.active, true),
      ),
    )
    .orderBy(asc(schema.clients.id))
    .for("update", { of: schema.clients });

  let created = 0;
  let existing = 0;
  for (const row of rows) {
    const steps = initialOfficeFeeSteps(row.profile.chargesAdditionalInstallment);
    const status = deriveOfficeFeeStatus(steps);
    const [inserted] = await tx
      .insert(schema.officeFeeControlPeriods)
      .values({
        orgId: input.orgId,
        clientId: row.clientId,
        periodYear: input.periodYear,
        periodMonth: input.periodMonth,
        clientNameSnapshot: row.clientName,
        clientCnpjSnapshot: row.clientCnpj,
        profileId: row.profile.id,
        profileVersion: row.profile.version,
        profileSnapshot: officeFeeProfileSnapshot(row.profile),
        responsibleUserId: row.responsibleUserId,
        invoiceStatus: steps.invoice,
        additionalInstallmentStatus: steps.additional_installment,
        collectionStatus: steps.collection,
        status,
        completedBy: status === "completed" ? input.actorId : null,
        completedAt: status === "completed" ? new Date() : null,
        createdBy: input.actorId,
        updatedBy: input.actorId,
      })
      .onConflictDoNothing({
        target: [
          schema.officeFeeControlPeriods.orgId,
          schema.officeFeeControlPeriods.clientId,
          schema.officeFeeControlPeriods.periodYear,
          schema.officeFeeControlPeriods.periodMonth,
        ],
      })
      .returning({ id: schema.officeFeeControlPeriods.id });
    if (!inserted) {
      existing += 1;
      continue;
    }
    created += 1;
    await tx.insert(schema.officeFeeControlEvents).values({
      orgId: input.orgId,
      controlPeriodId: inserted.id,
      clientId: row.clientId,
      eventType: "created",
      newValue: { periodYear: input.periodYear, periodMonth: input.periodMonth },
      actorId: input.actorId,
    });
  }
  return { created, existing };
}
