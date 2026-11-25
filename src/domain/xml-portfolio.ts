export interface XmlPortfolioMember {
  userId: string;
  name: string;
}

export interface XmlPortfolioCompany {
  clientId: string;
  name: string;
  portfolioUserId: string | null;
}

export interface XmlPortfolioGroup<TCompany extends XmlPortfolioCompany> {
  key: string;
  userId: string | null;
  name: string;
  companies: TCompany[];
}

/**
 * Replica no XML a divisão da Carteira Fiscal. Responsável que não participa
 * mais do clã deixa de ser carteira válida e volta para "Sem responsável",
 * igual à tela onde a distribuição é administrada.
 */
export function groupXmlCompaniesByPortfolio<
  TCompany extends XmlPortfolioCompany,
>(
  members: readonly XmlPortfolioMember[],
  companies: readonly TCompany[],
): XmlPortfolioGroup<TCompany>[] {
  const sortCompanies = (items: readonly TCompany[]) =>
    [...items].sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
  const memberById = new Map(members.map((member) => [member.userId, member]));
  const assigned = new Map<string, TCompany[]>();
  const unassigned: TCompany[] = [];

  for (const company of companies) {
    if (!company.portfolioUserId || !memberById.has(company.portfolioUserId)) {
      unassigned.push(company);
      continue;
    }
    const current = assigned.get(company.portfolioUserId) ?? [];
    current.push(company);
    assigned.set(company.portfolioUserId, current);
  }

  const groups: XmlPortfolioGroup<TCompany>[] = members
    .filter((member) => assigned.has(member.userId))
    .map((member) => ({
      key: member.userId,
      userId: member.userId,
      name: member.name,
      companies: sortCompanies(assigned.get(member.userId) ?? []),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));

  return unassigned.length > 0
    ? [
        {
          key: "unassigned",
          userId: null,
          name: "Sem responsável",
          companies: sortCompanies(unassigned),
        },
        ...groups,
      ]
    : groups;
}
