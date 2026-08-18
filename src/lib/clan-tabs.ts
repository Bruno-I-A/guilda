import { FISCAL_CLAN_SLUG } from "@/lib/clans/rules";

/**
 * As seções de um clã. A Carteira só existe no Fiscal — é lá que o trabalho
 * é organizado por empresa sob responsabilidade de alguém; os demais clãs
 * trabalham por fechamento ou por informativo.
 */
export const CLAN_TABS = [
  { key: "missions", label: "Missões" },
  { key: "members", label: "Integrantes" },
  { key: "campaigns", label: "Campanhas" },
  { key: "portfolio", label: "Carteira" },
] as const;

export type ClanTab = (typeof CLAN_TABS)[number]["key"];

export function clanHasPortfolio(clanSlug: string): boolean {
  return clanSlug === FISCAL_CLAN_SLUG;
}

export function clanTabsFor(clanSlug: string) {
  return CLAN_TABS.filter(
    (tab) => tab.key !== "portfolio" || clanHasPortfolio(clanSlug),
  );
}

/**
 * Aba pedida na URL, validada contra o que este clã oferece. Valor
 * desconhecido — ou `?tab=portfolio` num clã sem carteira — cai em Missões,
 * que é o uso diário.
 */
export function parseClanTab(
  value: string | undefined,
  clanSlug: string,
): ClanTab {
  const available = clanTabsFor(clanSlug);
  return available.some((tab) => tab.key === value)
    ? (value as ClanTab)
    : "missions";
}
