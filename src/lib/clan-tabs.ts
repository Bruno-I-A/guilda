import {
  CONTABILIDADE_CLAN_SLUG,
  FISCAL_CLAN_SLUG,
  SOCIETARIO_CLAN_SLUG,
} from "@/lib/clans/rules";

/**
 * As seções de um clã.
 *
 * Missões e Integrantes existem em todo clã. As demais são específicas porque
 * o trabalho tem forma diferente em cada área: o Fiscal se organiza por
 * CARTEIRA (empresa sob responsabilidade de alguém) e a Contabilidade por
 * FECHAMENTO (o ano de cada empresa). Enfiar as duas em todo clã encheria a
 * navegação de aba morta.
 */
export const CLAN_TABS = [
  { key: "missions", label: "Missões" },
  { key: "members", label: "Integrantes" },
  { key: "commitments", label: "Distribuição de lucros" },
  { key: "portfolio", label: "Carteira" },
  { key: "mei", label: "MEI" },
  { key: "installments", label: "Parcelamentos" },
  { key: "fees", label: "Honorários" },
  { key: "closings", label: "Fechamentos" },
  { key: "flow", label: "Fluxo" },
] as const;

export type ClanTab = (typeof CLAN_TABS)[number]["key"];

/**
 * Uma frase por aba: o que a pessoa encontra ali. Aparece sob a navegação do
 * clã e nos atalhos do dashboard — mesma fonte, para não divergir.
 */
export const CLAN_TAB_DESCRIPTIONS: Record<ClanTab, string> = {
  missions: "A mesa do clã: quem está com o quê e a fila de missões sem dono.",
  members: "Quem integra o clã e a carga de cada pessoa.",
  commitments: "Planejamento das distribuições de lucros das empresas.",
  portfolio: "Carteira de empresas e fichas fiscais sob responsabilidade do clã.",
  mei: "Declarações anuais das empresas MEI.",
  installments: "Controle dos parcelamentos em andamento.",
  fees: "Controle mensal de honorários.",
  closings: "Fechamentos contábeis de cada empresa.",
  flow: "Aberturas, alterações e baixas: do pedido do cliente ao Informativo.",
};

/** Aba → clã dono dela. Aba ausente desta tabela existe em todo clã. */
const TAB_OWNER_SLUG: Partial<Record<ClanTab, string>> = {
  commitments: CONTABILIDADE_CLAN_SLUG,
  portfolio: FISCAL_CLAN_SLUG,
  mei: FISCAL_CLAN_SLUG,
  installments: FISCAL_CLAN_SLUG,
  fees: FISCAL_CLAN_SLUG,
  closings: CONTABILIDADE_CLAN_SLUG,
  flow: SOCIETARIO_CLAN_SLUG,
};

/**
 * Aba que existe em todo clã (a mesa) versus a aba própria da área. A
 * navegação separa as duas para a pessoa achar de cara onde vive o trabalho
 * específico do seu clã — no Societário, o Fluxo; no Fiscal, a Carteira.
 */
export function isSharedClanTab(tab: ClanTab): boolean {
  return !TAB_OWNER_SLUG[tab];
}

export function clanHasPortfolio(clanSlug: string): boolean {
  return clanSlug === FISCAL_CLAN_SLUG;
}

export function clanHasClosings(clanSlug: string): boolean {
  return clanSlug === CONTABILIDADE_CLAN_SLUG;
}

export function clanHasCompanyFlow(clanSlug: string): boolean {
  return clanSlug === SOCIETARIO_CLAN_SLUG;
}

/** Link direto para uma aba do clã — usado por missões que apontam para lá. */
export function clanTabHref(clanId: string, tab: ClanTab): string {
  return `/clans/${clanId}?tab=${tab}`;
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
