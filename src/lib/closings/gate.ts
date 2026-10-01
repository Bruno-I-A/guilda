import "server-only";

import type { OrgTx } from "@/db/org-tx";
import {
  canDeleteClanClosing,
  canManageClanClosings,
  type ClosingActorFacts,
} from "@/domain/guild-permissions";
import { err } from "@/lib/action-context";
import { isActiveClanMember, loadClanScopedFacts } from "@/lib/clans/facts";
import { lockActiveClansForMembershipRead } from "@/lib/clans/locks";
import { CONTABILIDADE_CLAN_SLUG } from "@/lib/clans/rules";

/**
 * Gates de autorização dos Fechamentos — compartilhados pelas ações da aba e
 * pelas do Desafio do dado (arquivo "use server" só pode exportar ações, por
 * isso moram aqui). Toda decisão sai de `canManageClanClosings` /
 * `canDeleteClanClosing`, com os fatos (papel na organização, liderança e
 * vínculo ativo com ESTE clã) carregados do banco. A interface nunca informa
 * quem é da Contabilidade — a aba só existir no clã certo é navegação, não
 * autorização.
 */

export type ClosingMemberContext = {
  orgId: string;
  userId: string;
  role: Parameters<typeof loadClanScopedFacts>[4];
};

/**
 * Prova que o clã informado é a Contabilidade e devolve os fatos de
 * autorização. O mutex de leitura de vínculo é o mesmo das demais mesas:
 * fecha a janela entre validar a participação e gravar.
 */
export async function requireClosingActor(
  tx: OrgTx,
  ctx: ClosingMemberContext,
  clanId: string,
): Promise<{ ok: true; facts: ClosingActorFacts } | { ok: false; error: string }> {
  await lockActiveClansForMembershipRead(tx, ctx.orgId);
  const { clan, facts } = await loadClanScopedFacts(
    tx,
    ctx.orgId,
    clanId,
    ctx.userId,
    ctx.role,
  );
  if (!clan) return err("Clã não encontrado.");
  if (clan.slug !== CONTABILIDADE_CLAN_SLUG) {
    return err("Os fechamentos pertencem ao clã Contabilidade.");
  }
  const activeMember = await isActiveClanMember(
    tx,
    ctx.orgId,
    clan.id,
    ctx.userId,
  );
  return { ok: true, facts: { ...facts, isActiveClanMember: activeMember } };
}

const NAO_AUTORIZADO =
  "Apenas quem integra a Contabilidade, sua liderança ou um admin pode alterar fechamentos.";

/** Gate da rotina diária — usado por tudo, menos o que é da liderança. */
export async function requireClosingManager(
  tx: OrgTx,
  ctx: ClosingMemberContext,
  clanId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const gate = await requireClosingActor(tx, ctx, clanId);
  if (!gate.ok) return gate;
  if (!canManageClanClosings(gate.facts)) return err(NAO_AUTORIZADO);
  return { ok: true };
}

/** Gate da liderança: liberar desafio de outra pessoa, mudar as regras. */
export async function requireClosingLeadership(
  tx: OrgTx,
  ctx: ClosingMemberContext,
  clanId: string,
  message: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const gate = await requireClosingActor(tx, ctx, clanId);
  if (!gate.ok) return gate;
  if (!canDeleteClanClosing(gate.facts)) return err(message);
  return { ok: true };
}
