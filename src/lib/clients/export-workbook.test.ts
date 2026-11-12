import { readSheet } from "read-excel-file/node";
import { expect, test } from "vitest";

import { CLIENT_EXPORT_COLUMNS, type ExportClient } from "./export-rows";
import { buildClientsWorkbook } from "./export-workbook";

const empresa: ExportClient = {
  name: "Oficina Roda Viva Ltda",
  tradeName: null,
  cnpj: "05352532100240",
  taxRegime: "presumido",
  active: true,
  cadastralSituation: "ATIVA",
  openedAt: "2010-01-05",
  legalNature: null,
  companySize: null,
  shareCapital: "1234567.89",
  headquartersType: null,
  cnaeCode: "0161003",
  cnaeDescription: "Serviço de preparação de terreno",
  secondaryCnaes: [],
  address: null,
  operationalEmail: null,
  operationalPhone: null,
  revenueEmail: null,
  revenuePhones: [],
  qsa: [],
  dominioCode: "007",
  createdAt: new Date("2026-09-01T15:00:00Z"),
  fiscalOwnerName: null,
};

test("a planilha abre e devolve o que foi escrito, sem perder zero à esquerda", async () => {
  const buffer = await buildClientsWorkbook([empresa]);
  const rows = await readSheet(buffer);

  expect(rows[0]).toEqual(CLIENT_EXPORT_COLUMNS.map((column) => column.header));
  const linha = rows[1];
  const coluna = (header: string) =>
    linha[CLIENT_EXPORT_COLUMNS.findIndex((column) => column.header === header)];

  expect(coluna("Razão social")).toBe("Oficina Roda Viva Ltda");
  expect(coluna("CNPJ / CPF")).toBe("05.352.532/1002-40");
  expect(coluna("CNAE principal")).toBe("0161003");
  expect(coluna("Código na Domínio")).toBe("007");
  expect(coluna("Capital social")).toBe(1234567.89);
  expect(coluna("Data de abertura")).toBe("05/01/2010");
});
