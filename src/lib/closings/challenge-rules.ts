import "server-only";

import { eq, sql } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { DEFAULT_CHALLENGE_RULES, type ChallengeRules } from "@/domain/closing-challenge";

/** Regras da organização; sem linha salva, valem os padrões do domínio. */
export async function loadChallengeRules(tx: OrgTx, orgId: string): Promise<ChallengeRules> {
  const [row] = await tx
    .select({
      timeLimitMinutes: schema.closingChallengeSettings.timeLimitMinutes,
      baseXp: schema.closingChallengeSettings.baseXp,
      bonusXp: schema.closingChallengeSettings.bonusXp,
      dailyPaidCap: schema.closingChallengeSettings.dailyPaidCap,
    })
    .from(schema.closingChallengeSettings)
    .where(eq(schema.closingChallengeSettings.orgId, orgId));
  return row ?? DEFAULT_CHALLENGE_RULES;
}

/**
 * Meia-noite de hoje em São Paulo, como timestamptz: o "hoje" do teto e do
 * placar. Calculado no banco para não depender do fuso do servidor da app.
 */
export const START_OF_TODAY_SP = sql`(date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')`;
