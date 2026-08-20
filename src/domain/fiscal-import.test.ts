import { describe, expect, test } from "vitest";

import {
  fiscalImportSourceRowTotal,
  hasDuplicateFiscalImportTargets,
  normalizeCompanyName,
  normalizeFiscalObservation,
  parseFiscalApplicability,
  parseFiscalDelivery,
  parseFiscalImportRow,
  parseFiscalSpreadsheetRows,
  reconcileCompanyName,
} from "./fiscal-import";

describe("aplicação do lote fiscal", () => {
  test("bloqueia duas linhas destinadas à mesma empresa", () => {
    expect(hasDuplicateFiscalImportTargets(["a", "b", "a"])).toBe(true);
    expect(hasDuplicateFiscalImportTargets(["a", "b"])).toBe(false);
  });

  test("inclui linhas rejeitadas no total do relatório", () => {
    expect(fiscalImportSourceRowTotal(8, 2)).toBe(10);
    expect(fiscalImportSourceRowTotal(8, 0)).toBe(8);
  });
});

describe("normalização de nomes para conciliação fiscal", () => {
  test("remove acentos, caixa, pontuação e espaços sem esconder o texto-base", () => {
    expect(normalizeCompanyName("  CLÍNICA   D'ÁVILA & Filhos, LTDA. ")).toEqual({
      canonical: "clinica d avila e filhos ltda",
      core: "clinica avila filhos",
      tokens: ["clinica", "d", "avila", "e", "filhos", "ltda"],
      coreTokens: ["clinica", "avila", "filhos"],
    });
  });

  test("remove tipos societários apenas quando aparecem no final", () => {
    expect(normalizeCompanyName("Agrotech ME LTDA").core).toBe("agrotech");
    expect(normalizeCompanyName("Agrotech S/A").core).toBe("agrotech");
    expect(normalizeCompanyName("Agrotech Sociedade Limitada").core).toBe(
      "agrotech",
    );
    expect(normalizeCompanyName("SA Transportes").core).toBe("sa transportes");
  });

  test("não elimina uma palavra empresarial genérica do nome", () => {
    expect(normalizeCompanyName("Soluções LTDA").core).toBe("solucoes");
  });
});

describe("conciliação por nome", () => {
  const clients = [
    { id: "agrotech", name: "AGROTECH SERVIÇOS LTDA" },
    { id: "almeida", name: "ALMEIDA ANDRADE MEDICINA LTDA" },
    { id: "gremio", name: "GRÊMIO FOOT-BALL PORTO ALEGRENSE" },
    { id: "f-lago", name: "F. LAGO COMÉRCIO ME" },
  ] as const;

  test("faz match exato inequívoco ignorando acento e pontuação", () => {
    const result = reconcileCompanyName(
      "Gremio Foot-Ball Porto Alegrense",
      clients,
    );
    expect(result.status).toBe("exact");
    expect(result.exactMatch?.clientId).toBe("gremio");
    expect(result.exactMatch?.reasons[0]?.code).toBe("exact_name");
  });

  test("trata diferença de tipo societário como nome-base exato", () => {
    const result = reconcileCompanyName("Almeida Andrade Medicina", clients);
    expect(result.status).toBe("exact");
    expect(result.exactMatch?.clientId).toBe("almeida");
    expect(result.exactMatch?.reasons[0]?.code).toBe("exact_core_name");
  });

  test("sugere nome próximo com pontuação determinística e razões legíveis", () => {
    const first = reconcileCompanyName("Agrotec Servico", clients);
    const second = reconcileCompanyName("Agrotec Servico", clients);
    expect(first.status).toBe("suggested");
    expect(first.suggestions[0]?.clientId).toBe("agrotech");
    expect(first.suggestions[0]?.score).toBe(second.suggestions[0]?.score);
    expect(first.suggestions[0]?.reasons.length).toBeGreaterThan(0);
    expect(first.exactMatch).toBeNull();
  });

  test("tolera divisão de palavras causada pela planilha", () => {
    const result = reconcileCompanyName("GREMIO FOOTBALL PORTO ALEGRENSE", clients);
    expect(result.suggestions[0]?.clientId).toBe("gremio");
    expect(result.suggestions[0]?.reasons.map((reason) => reason.code)).toContain(
      "same_compact_name",
    );
  });

  test("prioriza alias conhecido sobre semelhança do nome oficial", () => {
    const result = reconcileCompanyName("Tribuna", [
      { id: "generic", name: "Tribuna Consultoria LTDA" },
      {
        id: "jornal",
        name: "Empresa Jornal de Audiovisual LTDA",
        aliases: ["Tribuna"],
      },
    ]);
    expect(result.status).toBe("exact");
    expect(result.exactMatch?.clientId).toBe("jornal");
    expect(result.exactMatch?.matchedAlias).toBe("Tribuna");
    expect(result.exactMatch?.reasons[0]?.code).toBe("exact_alias");
  });

  test("não escolhe quando dois cadastros têm o mesmo nome normalizado", () => {
    const result = reconcileCompanyName("Clínica Vida LTDA", [
      { id: "1", name: "Clinica Vida Ltda" },
      { id: "2", name: "CLÍNICA VIDA LTDA." },
    ]);
    expect(result.status).toBe("ambiguous");
    expect(result.exactMatch).toBeNull();
    expect(result.suggestions.map((item) => item.clientId)).toEqual(["1", "2"]);
  });

  test("não considera exato quando nome oficial colide com alias de outro cadastro", () => {
    const result = reconcileCompanyName("Alvorada", [
      { id: "official", name: "Alvorada" },
      { id: "alias", name: "Mercado do Sol", aliases: ["Alvorada"] },
    ]);
    expect(result.status).toBe("ambiguous");
    expect(result.exactMatch).toBeNull();
    expect(result.suggestions.map((item) => item.clientId)).toEqual([
      "official",
      "alias",
    ]);
  });

  test("marca como ambíguas sugestões próximas", () => {
    const result = reconcileCompanyName("Clínica Sorriso", [
      { id: "norte", name: "Clínica Sorriso Norte LTDA" },
      { id: "sul", name: "Clínica Sorriso Sul LTDA" },
    ]);
    expect(result.status).toBe("ambiguous");
    expect(result.suggestions).toHaveLength(2);
  });

  test("ordena por score e desempata de forma estável por nome e id", () => {
    const result = reconcileCompanyName(
      "Clinica Sorriso",
      [
        { id: "z", name: "Clínica Sorriso Sul" },
        { id: "b", name: "Clínica Sorriso Norte" },
        { id: "a", name: "Clínica Sorriso Norte" },
      ],
      { ambiguityGap: 0.5 },
    );
    expect(result.suggestions.map((suggestion) => suggestion.clientId)).toEqual([
      "z",
      "a",
      "b",
    ]);
  });

  test("não oferece candidato abaixo do limiar nem cria correspondência", () => {
    const result = reconcileCompanyName("Padaria Aurora", clients);
    expect(result.status).toBe("unmatched");
    expect(result.exactMatch).toBeNull();
    expect(result.suggestions).toEqual([]);
    expect(result.explanation).toContain("sem criar empresa automaticamente");
  });

  test("nome vazio fica pendente", () => {
    expect(reconcileCompanyName("  ", clients).status).toBe("unmatched");
  });

  test("nome genérico de uma palavra não vira exato só pelo sufixo", () => {
    const result = reconcileCompanyName("Serviços", [
      { id: "1", name: "Serviços LTDA" },
    ]);
    expect(result.exactMatch).toBeNull();
  });
});

describe("normalização das colunas do controle fiscal", () => {
  test.each([
    ["SIM", "yes"],
    [" sim ", "yes"],
    [true, "yes"],
    ["NÃO", "no"],
    ["nao", "no"],
    [false, "no"],
    ["X", "not_applicable"],
    ["Não se aplica", "not_applicable"],
    ["", null],
    [null, null],
  ])("interpreta %j como %s", (input, expected) => {
    expect(parseFiscalApplicability(input)).toMatchObject({
      value: expected,
      recognized: true,
    });
  });

  test("preserva valor desconhecido e exige revisão", () => {
    expect(parseFiscalApplicability("TALVEZ")).toEqual({
      value: null,
      raw: "TALVEZ",
      recognized: false,
    });
  });

  test.each([
    ["ONVIO", "onvio"],
    ["via e-mail", "email"],
    ["MALOTE", "malote"],
    ["retirada presencial", "in_person"],
    ["portal da prefeitura", "portal"],
    ["WhatsApp", "whatsapp"],
    ["impresso", "printed"],
  ])("reconhece entrega %s", (input, expected) => {
    expect(parseFiscalDelivery(input)).toMatchObject({
      kind: expected,
      recognized: true,
    });
  });

  test("preserva pessoa ou combinação própria como entrega personalizada", () => {
    expect(parseFiscalDelivery("IMP/CAROL")).toEqual({
      kind: "custom",
      detail: "IMP/CAROL",
      recognized: false,
    });
  });

  test("limpa espaços e linhas vazias das observações sem mudar conteúdo", () => {
    expect(
      normalizeFiscalObservation("  FATOR R - Faturamento 15.000,00  \r\n \r\n até julho "),
    ).toBe("FATOR R - Faturamento 15.000,00\naté julho");
  });

  test("prepara linha completa e aponta somente campos a revisar", () => {
    const parsed = parseFiscalImportRow({
      companyName: "  ANA PAULA GOUVEIA  ",
      movements: "NÃO",
      incoming: "talvez",
      outgoing: "X",
      guide: "x",
      delivery: "Cati",
      nfs: "SIM",
      observations: "  Controlar Fator R. ",
    });

    expect(parsed.companyName).toBe("ANA PAULA GOUVEIA");
    expect(parsed.normalizedCompanyName.core).toBe("ana paula gouveia");
    expect(parsed.movements.value).toBe("no");
    expect(parsed.outgoing.value).toBe("not_applicable");
    expect(parsed.nfs.value).toBe("yes");
    expect(parsed.delivery).toMatchObject({ kind: "custom", detail: "Cati" });
    expect(parsed.observations).toBe("Controlar Fator R.");
    expect(parsed.issues.map((issue) => issue.field)).toEqual([
      "incoming",
      "delivery",
    ]);
  });

  test("linha sem empresa recebe erro explícito", () => {
    const parsed = parseFiscalImportRow({ companyName: "" });
    expect(parsed.issues[0]).toMatchObject({ field: "companyName" });
  });
});

describe("leitura das linhas da planilha fiscal", () => {
  test("encontra cabeçalho depois de títulos e aceita acentos e variações", () => {
    const result = parseFiscalSpreadsheetRows([
      ["CONTROLE DO DEPARTAMENTO FISCAL"],
      [],
      ["Competência agosto/2026"],
      [
        "RAZÃO SOCIAL",
        "MOVIMENTAÇÃO",
        "ENTRADAS",
        "SAÍDAS",
        "GUIAS",
        "FORMA DE ENTREGA",
        "NFSE",
        "OBSERVAÇÃO GERAL",
      ],
      ["Clínica Vida", "NÃO", "SIM", "X", "X", "ONVIO", "X", "Fator R"],
    ]);

    expect(result.headerRowNumber).toBe(4);
    expect(result.columns).toEqual({
      companyName: 0,
      movements: 1,
      incoming: 2,
      outgoing: 3,
      guide: 4,
      delivery: 5,
      nfs: 6,
      observations: 7,
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      rowNumber: 5,
      status: "ready",
      rawData: ["Clínica Vida", "NÃO", "SIM", "X", "X", "ONVIO", "X", "Fator R"],
      parsed: {
        companyName: "Clínica Vida",
        observations: "Fator R",
      },
    });
    expect(result.skippedRows.map((row) => row.reason)).toEqual([
      "before_header",
      "blank",
      "before_header",
      "header",
    ]);
    expect(result.errors).toEqual([]);
  });

  test("mantém linha com valor personalizado para revisão", () => {
    const result = parseFiscalSpreadsheetRows([
      ["EMPRESAS", "MOVIMENTOS", "ENTRADA", "SAÍDA", "ENTREGA"],
      ["Ana Paula", "?", "NÃO", "X", "Cati"],
    ]);
    expect(result.rows[0]?.status).toBe("review");
    expect(result.rows[0]?.parsed.issues.map((issue) => issue.field)).toEqual([
      "movements",
      "delivery",
    ]);
    expect(result.missingColumns).toEqual(["guide", "nfs", "observations"]);
  });

  test("separa vazios, cabeçalhos repetidos, totais e linhas sem empresa", () => {
    const header = [
      "EMPRESA",
      "MOVIMENTOS",
      "ENTRADA",
      "SAIDA",
      "GUIA",
      "ENTREGA",
      "NFS",
      "OBS",
    ];
    const result = parseFiscalSpreadsheetRows([
      header,
      [],
      header,
      [null, "SIM", null, null, null, null, null, "Sem nome"],
      ["TOTAL"],
    ]);
    expect(result.rows).toEqual([]);
    expect(result.rejectedRows).toHaveLength(1);
    expect(result.rejectedRows[0]).toMatchObject({
      rowNumber: 4,
      reason: "missing_company_name",
      rawData: [null, "SIM", null, null, null, null, null, "Sem nome"],
    });
    expect(result.skippedRows.map((row) => row.reason)).toEqual([
      "header",
      "blank",
      "repeated_header",
      "summary",
    ]);
  });

  test("rejeita linhas não vazias quando não localiza cabeçalho", () => {
    const result = parseFiscalSpreadsheetRows([
      ["Relatório informal"],
      ["Ana Paula", "NÃO"],
      [],
    ]);
    expect(result.headerRowNumber).toBeNull();
    expect(result.rows).toEqual([]);
    expect(result.rejectedRows.map((row) => row.rowNumber)).toEqual([1, 2]);
    expect(result.skippedRows).toEqual([
      { rowNumber: 3, rawData: [], reason: "blank" },
    ]);
    expect(result.errors[0]).toContain("Cabeçalho não encontrado");
  });
});
