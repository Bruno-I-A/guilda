import "server-only";

import { and, eq } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import type { ClanDuty } from "@/domain/clan-duties";

export interface ClanDutyHolder {
  duty: ClanDuty;
  userId: string;
  userName: string | null;
}

/**
 * Quem responde por cada atribuição do clã.
 *
 * O INNER JOIN com `member` é a mesma trava do broadcast do Telegram: a FK
 * composta já derruba a atribuição quando a pessoa sai do clã, mas quem sai da
 * ORGANIZAÇÃO inteira pode deixar o vínculo de clã para trás por outro caminho.
 * Enumerar sem provar o vínculo é o que faz um ex-integrante voltar a receber
 * missão.
 */
export async function loadClanDuties(
  tx: OrgTx,
  orgId: string,
  clanId: string,
): Promise<ClanDutyHolder[]> {
  const rows = await tx
    .select({
      duty: schema.clanMemberDuties.duty,
      userId: schema.clanMemberDuties.userId,
      userName: schema.user.name,
    })
    .from(schema.clanMemberDuties)
    .innerJoin(
      schema.member,
      and(
        eq(schema.member.organizationId, schema.clanMemberDuties.orgId),
        eq(schema.member.userId, schema.clanMemberDuties.userId),
      ),
    )
    .innerJoin(schema.user, eq(schema.user.id, schema.clanMemberDuties.userId))
    .where(
      and(
        eq(schema.clanMemberDuties.orgId, orgId),
        eq(schema.clanMemberDuties.clanId, clanId),
      ),
    );
  return rows.map((row) => ({
    duty: row.duty,
    userId: row.userId,
    userName: row.userName ?? null,
  }));
}

/**
 * Responsável por uma atribuição, ou `null` quando ninguém foi designado.
 *
 * `null` é estado normal, não erro: organização recém-criada não tem nenhuma
 * atribuição, e o chamador precisa degradar (o Fluxo volta para a fila aberta)
 * em vez de travar.
 */
export async function findClanDutyHolder(
  tx: OrgTx,
  orgId: string,
  clanId: string,
  duty: ClanDuty,
): Promise<ClanDutyHolder | null> {
  const duties = await loadClanDuties(tx, orgId, clanId);
  return duties.find((entry) => entry.duty === duty) ?? null;
}

/** A pessoa é a responsável designada por esta atribuição neste clã? */
export async function holdsClanDuty(
  tx: OrgTx,
  orgId: string,
  clanId: string,
  userId: string,
  duty: ClanDuty,
): Promise<boolean> {
  const holder = await findClanDutyHolder(tx, orgId, clanId, duty);
  return holder?.userId === userId;
}
