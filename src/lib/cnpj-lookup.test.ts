import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  lookupCnpj,
  mapBrasilApiResponse,
  mapCnpjWsResponse,
  mapReceitaWsResponse,
} from "./cnpj-lookup";

function rawResponse(overrides: Record<string, unknown> = {}) {
  return {
    razao_social: "EMPRESA DE CONTABILIDADE LTDA",
    nome_fantasia: "CONTABILIDADE TESTE",
    data_inicio_atividade: "2015-05-20",
    cnae_fiscal: 6920601,
    cnae_fiscal_descricao: "Atividades de contabilidade",
    cnaes_secundarios: [
      { codigo: 6201501, descricao: "Desenvolvimento de programas de computador" },
    ],
    opcao_pelo_simples: true,
    opcao_pelo_mei: false,
    descricao_situacao_cadastral: "ATIVA",
    data_situacao_cadastral: "2015-05-20",
    porte: "MICRO EMPRESA",
    natureza_juridica: "Sociedade Empresária Limitada",
    capital_social: 10000,
    descricao_identificador_matriz_filial: "MATRIZ",
    email: "contato@empresa.com.br",
    ddd_telefone_1: "54999998888",
    ddd_telefone_2: "5433332222",
    logradouro: "RUA TESTE",
    numero: "123",
    complemento: "SALA 1",
    bairro: "CENTRO",
    municipio: "PASSO FUNDO",
    uf: "RS",
    cep: "99000000",
    qsa: [
      {
        nome_socio: "MARIA TESTE",
        cnpj_cpf_do_socio: "***123456**",
        qualificacao_socio: "Sócio-Administrador",
        data_entrada_sociedade: "2015-05-20",
        percentual_capital_social: "60,5",
      },
    ],
    regime_tributario: [
      { ano: 2025, forma_de_tributacao: "SIMPLES NACIONAL" },
    ],
    ...overrides,
  };
}

describe("mapBrasilApiResponse", () => {
  test("mapeia uma resposta completa", () => {
    const data = mapBrasilApiResponse(rawResponse());
    expect(data).toEqual({
      legalName: "EMPRESA DE CONTABILIDADE LTDA",
      tradeName: "CONTABILIDADE TESTE",
      cnaeCode: "6920601",
      cnaeDescription: "Atividades de contabilidade",
      secondaryCnaes: [
        { code: "6201501", description: "Desenvolvimento de programas de computador" },
      ],
      openedAt: "2015-05-20",
      isSimplesOptant: true,
      isMeiOptant: false,
      cadastralSituation: "ATIVA",
      cadastralSituationDate: "2015-05-20",
      companySize: "MICRO EMPRESA",
      legalNature: "Sociedade Empresária Limitada",
      shareCapital: "10000.00",
      headquartersType: "MATRIZ",
      email: "contato@empresa.com.br",
      phones: ["54999998888", "5433332222"],
      address: {
        street: "RUA TESTE",
        number: "123",
        complement: "SALA 1",
        district: "CENTRO",
        city: "PASSO FUNDO",
        state: "RS",
        zipCode: "99000000",
      },
      qsa: [
        {
          name: "MARIA TESTE",
          document: "***123456**",
          qualification: "Sócio-Administrador",
          joinedAt: "2015-05-20",
          participation: "60,5%",
        },
      ],
      taxRegimes: [{ year: 2025, form: "SIMPLES NACIONAL" }],
    });
  });

  test("sem atividades secundárias vira array vazio, não null", () => {
    const data = mapBrasilApiResponse(rawResponse({ cnaes_secundarios: [] }));
    expect(data?.secondaryCnaes).toEqual([]);
  });

  test("participação societária ausente permanece explícita como não informada", () => {
    const data = mapBrasilApiResponse(rawResponse({
      qsa: [{ nome_socio: "MARIA TESTE", qualificacao_socio: "Sócio-Administrador" }],
    }));
    expect(data?.qsa[0]?.participation).toBeNull();
  });

  test("opcao_pelo_simples ausente (não booleano) vira null, nunca false por acidente", () => {
    const data = mapBrasilApiResponse(rawResponse({ opcao_pelo_simples: null }));
    expect(data?.isSimplesOptant).toBeNull();
  });

  test("opcao_pelo_simples false é preservado (não confundir com ausente)", () => {
    const data = mapBrasilApiResponse(rawResponse({ opcao_pelo_simples: false }));
    expect(data?.isSimplesOptant).toBe(false);
  });

  test("situação baixada é repassada sem julgamento — quem decide é a tela", () => {
    const data = mapBrasilApiResponse(
      rawResponse({ descricao_situacao_cadastral: "BAIXADA" }),
    );
    expect(data?.cadastralSituation).toBe("BAIXADA");
  });

  test("data com timestamp é truncada para YYYY-MM-DD", () => {
    const data = mapBrasilApiResponse(
      rawResponse({ data_inicio_atividade: "2015-05-20T00:00:00.000Z" }),
    );
    expect(data?.openedAt).toBe("2015-05-20");
  });

  test("data ausente ou em formato inesperado vira null, não quebra", () => {
    expect(mapBrasilApiResponse(rawResponse({ data_inicio_atividade: null }))?.openedAt).toBeNull();
    expect(
      mapBrasilApiResponse(rawResponse({ data_inicio_atividade: "não é data" }))?.openedAt,
    ).toBeNull();
  });

  test("cnae_fiscal numérico vira string", () => {
    const data = mapBrasilApiResponse(rawResponse({ cnae_fiscal: 6920601 }));
    expect(data?.cnaeCode).toBe("6920601");
  });

  test("razão social ausente invalida a resposta inteira", () => {
    expect(mapBrasilApiResponse(rawResponse({ razao_social: null }))).toBeNull();
    expect(mapBrasilApiResponse(rawResponse({ razao_social: "" }))).toBeNull();
  });

  test("entrada que não é objeto retorna null", () => {
    expect(mapBrasilApiResponse(null)).toBeNull();
    expect(mapBrasilApiResponse("texto")).toBeNull();
    expect(mapBrasilApiResponse(undefined)).toBeNull();
  });

  test("item de atividade secundária sem código ou descrição é descartado", () => {
    const data = mapBrasilApiResponse(
      rawResponse({
        cnaes_secundarios: [
          { codigo: 6201501, descricao: "Válida" },
          { codigo: null, descricao: "Sem código" },
          { codigo: 1234567, descricao: "" },
        ],
      }),
    );
    expect(data?.secondaryCnaes).toEqual([{ code: "6201501", description: "Válida" }]);
  });
});

describe("fontes alternativas", () => {
  test("mapeia uma empresa retornada pelo CNPJ.ws", () => {
    const data = mapCnpjWsResponse({
      razao_social: "EMPRESA NOVA LTDA",
      capital_social: "15000.00",
      porte: { descricao: "MICRO EMPRESA" },
      natureza_juridica: { descricao: "Sociedade Empresária Limitada" },
      simples: { simples: "Sim", mei: "Não" },
      socios: [{
        nome: "JOÃO TESTE",
        cpf_cnpj_socio: "***123456**",
        data_entrada: "2026-08-27",
        qualificacao_socio: { descricao: "Sócio-Administrador" },
      }],
      estabelecimento: {
        nome_fantasia: "EMPRESA NOVA",
        data_inicio_atividade: "2026-08-27",
        situacao_cadastral: "Ativa",
        data_situacao_cadastral: "2026-08-27",
        tipo: "Matriz",
        email: "contato@empresa.test",
        ddd1: "54",
        telefone1: "999998888",
        tipo_logradouro: "Rua",
        logradouro: "Teste",
        numero: "100",
        bairro: "Centro",
        cep: "99000000",
        cidade: { nome: "Passo Fundo" },
        estado: { sigla: "RS" },
        atividade_principal: { id: "69.20-6-01", descricao: "Contabilidade" },
        atividades_secundarias: [{ id: "62.01-5-01", descricao: "Software" }],
      },
    });

    expect(data).toMatchObject({
      legalName: "EMPRESA NOVA LTDA",
      tradeName: "EMPRESA NOVA",
      cnaeCode: "6920601",
      openedAt: "2026-08-27",
      isSimplesOptant: true,
      isMeiOptant: false,
      phones: ["54999998888"],
      secondaryCnaes: [{ code: "6201501", description: "Software" }],
      address: { city: "Passo Fundo", state: "RS" },
    });
    expect(data?.qsa[0]?.name).toBe("JOÃO TESTE");
  });

  test("mapeia datas brasileiras e dados da ReceitaWS", () => {
    const data = mapReceitaWsResponse({
      status: "OK",
      nome: "EMPRESA NOVA LTDA",
      fantasia: "EMPRESA NOVA",
      abertura: "27/08/2026",
      situacao: "ATIVA",
      data_situacao: "27/08/2026",
      atividade_principal: [{ code: "69.20-6-01", text: "Contabilidade" }],
      atividades_secundarias: [],
      simples: { optante: true },
      simei: { optante: false },
      telefone: "(54) 99999-8888 / (54) 3333-2222",
      qsa: [{ nome: "JOÃO TESTE", qual: "Sócio-Administrador" }],
    });

    expect(data).toMatchObject({
      legalName: "EMPRESA NOVA LTDA",
      openedAt: "2026-08-27",
      cnaeCode: "6920601",
      isSimplesOptant: true,
      isMeiOptant: false,
      phones: ["54999998888", "5433332222"],
    });
  });
});

describe("lookupCnpj", () => {
  test("usa a próxima fonte quando a primeira ainda não possui o CNPJ", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("Not Found", { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: "OK",
        nome: "EMPRESA RECENTE LTDA",
        abertura: "27/08/2026",
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await lookupCnpj("68860648000171");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.legalName).toBe("EMPRESA RECENTE LTDA");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  test("distingue o limite temporário de uma falha definitiva", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("Too Many Requests", { status: 429 }),
    ));

    await expect(lookupCnpj("11222333000181")).resolves.toEqual({
      ok: false,
      reason: "rate_limited",
    });
    vi.unstubAllGlobals();
  });

  test("reconhece a mitigação antiabuso da Vercel", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("Forbidden", {
        status: 403,
        headers: { "x-vercel-mitigated": "deny" },
      }),
    ));

    await expect(lookupCnpj("11222333000181")).resolves.toEqual({
      ok: false,
      reason: "rate_limited",
    });
    vi.unstubAllGlobals();
  });
});
