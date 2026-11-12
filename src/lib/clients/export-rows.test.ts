import { describe, expect, test } from "vitest";

import {
  brazilianDate,
  CLIENT_EXPORT_COLUMNS,
  clientExportRow,
  SHARE_CAPITAL_COLUMN,
  type ExportClient,
} from "./export-rows";

function empresa(overrides: Partial<ExportClient> = {}): ExportClient {
  return {
    name: "Padaria Aurora Ltda",
    tradeName: "Padaria Aurora",
    cnpj: "84009016100028",
    taxRegime: "simples",
    active: true,
    cadastralSituation: "ATIVA",
    openedAt: "2015-03-09",
    legalNature: "206-2 - Sociedade Empresária Limitada",
    companySize: "Microempresa",
    shareCapital: "50000.00",
    headquartersType: "Matriz",
    cnaeCode: "1091102",
    cnaeDescription: "Fabricação de produtos de padaria",
    secondaryCnaes: [
      { code: "4721102", description: "Padaria e confeitaria" },
      { code: "5611201", description: "Restaurantes" },
    ],
    address: {
      street: "Rua das Flores",
      number: "120",
      complement: "Sala 2",
      district: "Centro",
      city: "Getúlio Vargas",
      state: "rs",
      zipCode: "99900000",
    },
    operationalEmail: "contato@aurora.com",
    operationalPhone: "(54) 3341-0000",
    revenueEmail: "fiscal@aurora.com",
    revenuePhones: ["(54) 3341-0000", " (54) 99999-0000 "],
    qsa: [
      { name: "Maria Aurora", document: "***123456**", qualification: "Sócio-Administrador", joinedAt: null, participation: null },
      { name: "João Aurora", document: null, qualification: null, joinedAt: null, participation: null },
    ],
    dominioCode: "125",
    createdAt: new Date("2026-08-20T02:30:00Z"),
    fiscalOwnerName: "Catiele",
    ...overrides,
  };
}

function coluna(row: ReturnType<typeof clientExportRow>, header: string) {
  return row[CLIENT_EXPORT_COLUMNS.findIndex((column) => column.header === header)];
}

describe("linha da empresa na planilha", () => {
  test("uma célula por coluna", () => {
    expect(clientExportRow(empresa())).toHaveLength(CLIENT_EXPORT_COLUMNS.length);
  });

  test("documentos, datas e CEP no formato brasileiro", () => {
    const row = clientExportRow(empresa());
    expect(coluna(row, "CNPJ / CPF")).toBe("84.009.016/1000-28");
    expect(coluna(row, "Data de abertura")).toBe("09/03/2015");
    expect(coluna(row, "CEP")).toBe("99900-000");
    expect(coluna(row, "UF")).toBe("RS");
  });

  test("a data de cadastro é o dia de São Paulo, não o de Greenwich", () => {
    // 02:30 UTC de 20/08 ainda é 19/08 em São Paulo.
    expect(coluna(clientExportRow(empresa()), "Cadastrada na Guilda em")).toBe("19/08/2026");
  });

  test("capital social sai como número, para o formato de moeda", () => {
    expect(clientExportRow(empresa())[SHARE_CAPITAL_COLUMN]).toBe(50000);
  });

  test("listas viram uma célula separada por ponto e vírgula", () => {
    const row = clientExportRow(empresa());
    expect(coluna(row, "CNAEs secundários")).toBe(
      "4721102 - Padaria e confeitaria; 5611201 - Restaurantes",
    );
    expect(coluna(row, "Telefones na Receita")).toBe("(54) 3341-0000; (54) 99999-0000");
  });

  test("sócios só com nome e qualificação — o documento fica de fora", () => {
    const socios = coluna(clientExportRow(empresa()), "Sócios");
    expect(socios).toBe("Maria Aurora (Sócio-Administrador); João Aurora");
    expect(String(socios)).not.toContain("123456");
  });

  test("regime e situação em português", () => {
    const row = clientExportRow(empresa({ taxRegime: "presumido", active: false }));
    expect(coluna(row, "Regime")).toBe("Lucro Presumido");
    expect(coluna(row, "Situação na Guilda")).toBe("Inativa");
  });

  test("empresa com cadastro mínimo não quebra: o que falta fica vazio", () => {
    const row = clientExportRow(
      empresa({
        tradeName: null,
        cnpj: null,
        openedAt: null,
        shareCapital: null,
        secondaryCnaes: null,
        address: null,
        revenuePhones: [],
        qsa: [],
        dominioCode: null,
        fiscalOwnerName: null,
      }),
    );
    expect(coluna(row, "CNPJ / CPF")).toBeNull();
    expect(coluna(row, "Logradouro")).toBeNull();
    expect(coluna(row, "Sócios")).toBeNull();
    expect(row[SHARE_CAPITAL_COLUMN]).toBeNull();
  });
});

describe("data brasileira", () => {
  test("converte a data ISO e deixa vazio o que não há", () => {
    expect(brazilianDate("2026-11-12")).toBe("12/11/2026");
    expect(brazilianDate(null)).toBeNull();
    expect(brazilianDate("  ")).toBeNull();
  });
});
