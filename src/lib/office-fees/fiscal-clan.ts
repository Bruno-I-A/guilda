import "server-only";

import type { OrgTx } from "@/db/org-tx";
import { loadClanScopedFacts } from "@/lib/clans/facts";
import { lockActiveClansForMembershipRead } from "@/lib/clans/locks";
import { FISCAL_CLAN_SLUG } from "@/lib/clans/rules";

/** Carrega o clã pedido e os fatos de quem age; null se não for o Fiscal. */
export async function requireFiscalClan(
  tx: OrgTx,
  input: {
    orgId: string;
    clanId: string;
    userId: string;
    role: Parameters<typeof loadClanScopedFacts>[4];
  },
) {
  await lockActiveClansForMembershipRead(tx, input.orgId);
  const loaded = await loadClanScopedFacts(tx, input.orgId, input.clanId, input.userId, input.role);
  if (!loaded.clan || loaded.clan.slug !== FISCAL_CLAN_SLUG) return null;
  return loaded;
}
