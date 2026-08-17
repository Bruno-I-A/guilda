import { describe, expect, test } from "vitest";

import {
  extractObservationLines,
  isActionLine,
  looksLikeInfinitive,
  stripLineDecorations,
} from "./informative-text";

describe("verbo no infinitivo", () => {
  test.each([
    "parametrizar",
    "configurar",
    "cadastrar",
    "abrir",
    "solicitar",
    "habilitar",
    "criar",
    "arquivar",
    "finalizar",
    "confeccionar",
    "escanear",
    "mover",
  ])("%s é verbo", (word) => expect(looksLikeInfinitive(word)).toBe(true));

  test.each(["setor", "valor", "particular", "lugar", "Camila", "Rafa", "obs"])(
    "%s não é verbo",
    (word) => expect(looksLikeInfinitive(word)).toBe(false),
  );
});

describe("linha de ação x combinado", () => {
  test.each([
    "Fiscal - Camila - parametrizar faturamento médio de 15.000,00/mês",
    "RH - cadastrar o pró-labore de 5.000,00 a partir da competência 07/2026",
    "Certificado digital - Bruno - solicitar o certificado digital do cliente",
    "Automação - Fabi - habilitar o cliente no Onvio",
  ])("é ação: %s", (line) => expect(isActionLine(line)).toBe(true));

  test.each([
    "Camila responde por todos os informativos da empresa.",
    "Rafa e Bruno acompanham a contabilidade.",
    "Distribuição de lucros trimestral.",
  ])("é combinado: %s", (line) => expect(isActionLine(line)).toBe(false));

  test("o prazo depois da ação não esconde o verbo", () => {
    expect(
      isActionLine(
        "Financeiro - Camila - cadastrar a cobrança no Domínio - prazo 05/09/2026",
      ),
    ).toBe(true);
  });

  test("numeração e negrito do WhatsApp não atrapalham", () => {
    expect(stripLineDecorations("1.1 – *FISCAL")).toBe("FISCAL");
    expect(isActionLine("*8.0 – ARQUIVO – Eduarda – arquivar os documentos*")).toBe(
      true,
    );
  });
});

/** Informativo real da PICCOLI AGRO reescrito no formato recomendado. */
const PICCOLI = `INFORMATIVO — NOVO CLIENTE

Código: 1124
Razão social: PICCOLI AGRO SERVIÇOS LTDA
CNPJ: 68.100.490/0001-31
Abertura: 16/07/2026
Enquadramento: Simples Nacional

AÇÕES
Fiscal - Camila - parametrizar faturamento médio de 15.000,00/mês a partir de 08/2026
Fiscal - Eduarda - configurar a emissão de nota mensal
RH - cadastrar o pró-labore de 5.000,00 a partir da competência 07/2026
Contabilidade - abrir a contabilidade com distribuição de lucros trimestral
Financeiro - Camila - cadastrar a cobrança no Domínio
Certificado digital - Bruno - solicitar o certificado digital do cliente
Automação - Fabi - habilitar o cliente no Onvio
Servidor - Bruno - criar a pasta da empresa com as subpastas padrão
Arquivo - Eduarda - arquivar os documentos impressos em pasta suspensa

OBSERVAÇÕES
Camila responde por todos os informativos da empresa.
Rafa e Bruno acompanham a contabilidade.`;

describe("bloco de observações do informativo real", () => {
  test("recolhe os combinados e nenhuma ação", () => {
    const observations = extractObservationLines(PICCOLI);
    expect(observations).toEqual([
      "Camila responde por todos os informativos da empresa.",
      "Rafa e Bruno acompanham a contabilidade.",
    ]);
  });

  test("dados cadastrais do cabeçalho não entram nas observações", () => {
    const observations = extractObservationLines(PICCOLI);
    expect(observations.join("\n")).not.toContain("CNPJ");
    expect(observations.join("\n")).not.toContain("Enquadramento");
  });

  test("linha sem verbo dentro de AÇÕES cai nas observações", () => {
    const observations = extractObservationLines(
      "AÇÕES\nFiscal - Camila - parametrizar o Fator R\nCamila responde pelos informativos.",
    );
    expect(observations).toEqual(["Camila responde pelos informativos."]);
  });

  test("sem cabeçalho conhecido não chuta nada", () => {
    expect(
      extractObservationLines("Fiscal - Camila - parametrizar o Fator R"),
    ).toEqual([]);
  });
});
