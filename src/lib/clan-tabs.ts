import {
  CONTABILIDADE_CLAN_SLUG,
  FISCAL_CLAN_SLUG,
} from "@/lib/clans/rules";

/**
 * As seções de um clã.
 *
 * Missões, Integrantes e Campanhas existem em todo clã. As demais são
 * específicas porque o trabalho tem forma
 * diferente em cada área: o Fiscal se organiza por CARTEIRA (empresa sob
 * responsabilidade de alguém) e a Contabilidade por FECHAMENTO (o ano de cada
 * empresa). Enfiar as duas em todo clã encheria a navegação de aba morta.
 */
export const CLAN_TABS = [
  { key: "missions", label: "Missões" },
  { key: "members", label: "Integrantes" },
  { key: "campaigns", label: "Campanhas" },
  { key: "commitments", label: "Distribuição de lucros" },
  { key: "portfolio", label: "Carteira" },
  { key: "closings", label: "Fechamentos" },
] as const;

export type ClanTab = (typeof CLAN_TABS)[number]["key"];

/** Aba → clã dono dela. Aba ausente desta tabela existe em todo clã. */
const TAB_OWNER_SLUG: Partial<Record<ClanTab, string>> = {
  commitments: CONTABILIDADE_CLAN_SLUG,
  portfolio: FISCAL_CLAN_SLUG,
  closings: CONTABILIDADE_CLAN_SLUG,
};

export function clanHasPortfolio(clanSlug: string): boolean {
  return clanSlug === FISCAL_CLAN_SLUG;
}

export function clanHasClosings(clanSlug: string): boolean {
  return clanSlug === CONTABILIDADE_CLAN_SLUG;
}

export function clanTabsFor(clanSlug: string) {
  return CLAN_TABS.filter((tab) => {
    const owner = TAB_OWNER_SLUG[tab.key];
    return !owner || owner === clanSlug;
  });
}

/**
 * Aba pedida na URL, validada contra o que este clã oferece. Valor
 * desconhecido — ou `?tab=carteira` num clã sem carteira — cai em Missões,
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
