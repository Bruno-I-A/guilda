import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import {
  deriveFiscalControlStatus,
  initialFiscalStepStatus,
} from "@/domain/fiscal-control";
import { lockActiveClansForMembershipRead } from "@/lib/clans/locks";

type FiscalProfile = typeof schema.fiscalClientProfiles.$inferSelect;

export function fiscalProfileSnapshot(
  profile: FiscalProfile,
): schema.FiscalClientProfileSnapshot {
  return {
    version: profile.version,
    movementsApplicability: profile.movementsApplicability,
    incomingApplicability: profile.incomingApplicability,
    outgoingApplicability: profile.outgoingApplicability,
    guideApplicability: profile.guideApplicability,
    nfsApplicability: profile.nfsApplicability,
    deliveryChannel: profile.deliveryChannel,
    factorRApplicability: profile.factorRApplicability,
    revenueReference: profile.revenueReference,
    permanentNotes: profile.permanentNotes,
  };
}

async function ensureFiscalProfile(
  tx: OrgTx,
  input: { orgId: string; clientId: string; actorId: string },
): Promise<FiscalProfile> {
  const [existing] = await tx
    .select()
    .from(schema.fiscalClientProfiles)
    .where(
      and(
        eq(schema.fiscalClientProfiles.orgId, input.orgId),
        eq(schema.fiscalClientProfiles.clientId, input.clientId),
      ),
    )
    .limit(1);
  if (existing) return existing;

  const [created] = await tx
    .insert(schema.fiscalClientProfiles)
    .values({
      orgId: input.orgId,
      clientId: input.clientId,
      createdBy: input.actorId,
      updatedBy: input.actorId,
    })
    .onConflictDoNothing({
      target: [
        schema.fiscalClientProfiles.orgId,
        schema.fiscalClientProfiles.clientId,
      ],
    })
    .returning();

  const profile =
    created ??
    (
      await tx
        .select()
        .from(schema.fiscalClientProfiles)
        .where(
          and(
            eq(schema.fiscalClientProfiles.orgId, input.orgId),
            eq(schema.fiscalClientProfiles.clientId, input.clientId),
          ),
        )
        .limit(1)
    )[0];
  if (!profile) throw new Error("Não foi possível preparar a Ficha Fiscal.");

  if (created) {
    await tx.insert(schema.fiscalClientProfileEvents).values({
      orgId: input.orgId,
      profileId: created.id,
      clientId: input.clientId,
      eventType: "created",
      version: created.version,
      snapshot: fiscalProfileSnapshot(created),
      changedFields: [],
      actorId: input.actorId,
    });
  }
  return profile;
}

export interface MaterializeFiscalControlResult {
  created: number;
  existing: number;
  campaignConflicts: number;
}

/**
 * Abre a competência para todas as empresas ativas, inclusive as ainda sem
 * responsável. Perfil, regime e carteira ficam congelados na nova linha.
 */
export async function materializeFiscalControl(
  tx: OrgTx,
  input: {
    orgId: string;
    actorId: string;
    periodYear: number;
    periodMonth: number;
    campaignId?: string | null;
  },
): Promise<MaterializeFiscalControlResult> {
  await lockActiveClansForMembershipRead(tx, input.orgId);
  const rows = await tx
    .select({
      clientId: schema.clients.id,
      taxRegime: schema.clients.taxRegime,
      responsibleUserId: schema.fiscalPortfolios.userId,
    })
    .from(schema.clients)
    .leftJoin(
      schema.fiscalPortfolios,
      and(
        eq(schema.fiscalPortfolios.orgId, schema.clients.orgId),
        eq(schema.fiscalPortfolios.clientId, schema.clients.id),
      ),
    )
    .where(
      and(
        eq(schema.clients.orgId, input.orgId),
        eq(schema.clients.active, true),
      ),
    )
    .orderBy(asc(schema.clients.id))
    .for("update", { of: schema.clients });

  let createdCount = 0;
  let existingCount = 0;
  let campaignConflicts = 0;
  for (const row of rows) {
    const profile = await ensureFiscalProfile(tx, {
      orgId: input.orgId,
      clientId: row.clientId,
      actorId: input.actorId,
    });
    const snapshot = fiscalProfileSnapshot(profile);
    const movementsStatus = initialFiscalStepStatus(
      profile.movementsApplicability,
    );
    const incomingStatus = initialFiscalStepStatus(
      profile.incomingApplicability,
    );
    const outgoingStatus = initialFiscalStepStatus(
      profile.outgoingApplicability,
    );
    const guideStatus = initialFiscalStepStatus(profile.guideApplicability);
    const nfsStatus = initialFiscalStepStatus(profile.nfsApplicability);
    const deliveryStatus = profile.deliveryChannel
      ? "pending" as const
      : "not_applicable" as const;
    const status = deriveFiscalControlStatus([
      movementsStatus,
      incomingStatus,
      outgoingStatus,
      guideStatus,
      nfsStatus,
      deliveryStatus,
    ]);
    const completedAt = status === "completed" ? new Date() : null;
    const [created] = await tx
      .insert(schema.fiscalControlPeriods)
      .values({
        orgId: input.orgId,
        clientId: row.clientId,
        periodYear: input.periodYear,
        periodMonth: input.periodMonth,
        profileId: profile.id,
        profileVersion: profile.version,
        profileSnapshot: snapshot,
        responsibleUserId: row.responsibleUserId,
        taxRegimeSnapshot: row.taxRegime,
        campaignId: input.campaignId ?? null,
        movementsStatus,
        incomingStatus,
        outgoingStatus,
        guideStatus,
        nfsStatus,
        deliveryStatus,
        status,
        completedBy: status === "completed" ? input.actorId : null,
        completedAt,
        createdBy: input.actorId,
        updatedBy: input.actorId,
      })
      .onConflictDoNothing({
        target: [
          schema.fiscalControlPeriods.orgId,
          schema.fiscalControlPeriods.clientId,
          schema.fiscalControlPeriods.periodYear,
          schema.fiscalControlPeriods.periodMonth,
        ],
      })
      .returning({ id: schema.fiscalControlPeriods.id });

    if (!created) {
      existingCount += 1;
      // Campanha criada depois do controle pode adotar a competência, sem
      // tocar nos snapshots operacionais.
      if (input.campaignId) {
        const [adopted] = await tx
          .update(schema.fiscalControlPeriods)
          .set({
            campaignId: input.campaignId,
            updatedBy: input.actorId,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.fiscalControlPeriods.orgId, input.orgId),
              eq(schema.fiscalControlPeriods.clientId, row.clientId),
              eq(schema.fiscalControlPeriods.periodYear, input.periodYear),
              eq(schema.fiscalControlPeriods.periodMonth, input.periodMonth),
              isNull(schema.fiscalControlPeriods.campaignId),
            ),
          )
          .returning({ id: schema.fiscalControlPeriods.id });
        if (adopted) {
          await tx.insert(schema.fiscalControlEvents).values({
            orgId: input.orgId,
            controlPeriodId: adopted.id,
            clientId: row.clientId,
            eventType: "campaign_linked",
            newValue: { campaignId: input.campaignId },
            actorId: input.actorId,
          });
        } else {
          const [current] = await tx
            .select({ campaignId: schema.fiscalControlPeriods.campaignId })
            .from(schema.fiscalControlPeriods)
            .where(
              and(
                eq(schema.fiscalControlPeriods.orgId, input.orgId),
                eq(schema.fiscalControlPeriods.clientId, row.clientId),
                eq(schema.fiscalControlPeriods.periodYear, input.periodYear),
                eq(schema.fiscalControlPeriods.periodMonth, input.periodMonth),
              ),
            )
            .limit(1);
          if (current?.campaignId !== input.campaignId) campaignConflicts += 1;
        }
      }
      continue;
    }

    createdCount += 1;
    await tx.insert(schema.fiscalControlEvents).values({
      orgId: input.orgId,
      controlPeriodId: created.id,
      clientId: row.clientId,
      eventType: "created",
      newValue: { periodYear: input.periodYear, periodMonth: input.periodMonth },
      actorId: input.actorId,
    });
  }

  return {
    created: createdCount,
    existing: existingCount,
    campaignConflicts,
  };
}
