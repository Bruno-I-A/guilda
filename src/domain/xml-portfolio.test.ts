import { describe, expect, test } from "vitest";

import { groupXmlCompaniesByPortfolio } from "./xml-portfolio";

const members = [
  { userId: "cati", name: "Catielle Scharff" },
  { userId: "eder", name: "Éder Heineck Moravski" },
];

describe("divisão do XML pela Carteira Fiscal", () => {
  test("agrupa pelas mesmas pessoas cadastradas na carteira", () => {
    const groups = groupXmlCompaniesByPortfolio(members, [
      { clientId: "1", name: "Alfa", portfolioUserId: "eder" },
      { clientId: "2", name: "Gama", portfolioUserId: "cati" },
      { clientId: "3", name: "Beta", portfolioUserId: "cati" },
    ]);

    expect(groups.map((group) => [group.name, group.companies.length])).toEqual([
      ["Catielle Scharff", 2],
      ["Éder Heineck Moravski", 1],
    ]);
    expect(groups[0]?.companies.map((company) => company.name)).toEqual([
      "Beta",
      "Gama",
    ]);
  });

  test("sem carteira e responsável fora do clã ficam juntos para redistribuição", () => {
    const groups = groupXmlCompaniesByPortfolio(members, [
      { clientId: "1", name: "Alfa", portfolioUserId: null },
      { clientId: "2", name: "Beta", portfolioUserId: "quem-saiu" },
      { clientId: "3", name: "Gama", portfolioUserId: "cati" },
    ]);

    expect(groups[0]).toMatchObject({
      userId: null,
      name: "Sem responsável",
      companies: [{ clientId: "1" }, { clientId: "2" }],
    });
  });
});
