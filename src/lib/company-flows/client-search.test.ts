import { describe, expect, it } from "vitest";

import { searchCompanyFlowClients } from "./client-search";

const clients = [
  { id: "1", name: "Comércio São José", cnpj: "12345678000190" },
  { id: "2", name: "Indústria Aurora", cnpj: "98765432000110" },
];

describe("searchCompanyFlowClients", () => {
  it("pesquisa empresas por nome sem depender de acentos", () => {
    expect(searchCompanyFlowClients(clients, "comercio sao")).toEqual([clients[0]]);
  });

  it("pesquisa pelo CNPJ com ou sem formatação", () => {
    expect(searchCompanyFlowClients(clients, "98.765.432")).toEqual([clients[1]]);
  });

  it("limita o resultado exibido no seletor", () => {
    expect(searchCompanyFlowClients(clients, "", 1)).toHaveLength(1);
  });
});
