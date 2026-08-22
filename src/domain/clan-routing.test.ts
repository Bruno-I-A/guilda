import { describe, expect, test } from "vitest";

import {
  SECTOR_CLAN_SYNONYMS,
  normalizeSectorText,
  resolveSectorClan,
  routeInformativeTask,
  stripSectorDecorations,
  type AssigneeSuggestion,
  type InformativeRoutingRule,
  type RoutingClan,
} from "./clan-routing";

/** Clãs legados usados para provar a migração da configuração anterior. */
const CLANS: RoutingClan[] = [
  { id: "clan-fiscal", name: "Fiscal", slug: "fiscal" },
  { id: "clan-contabil", name: "Contabilidade", slug: "contabilidade" },
  { id: "clan-rh", name: "RH", slug: "rh" },
  { id: "clan-societario", name: "Societário", slug: "societario" },
  { id: "clan-financeiro", name: "Financeiro", slug: "financeiro" },
  {
    id: "clan-sucesso",
    name: "Sucesso do Cliente",
    slug: "sucesso-do-cliente",
  },
];

const DEFAULT_RULES: InformativeRoutingRule[] = Object.entries(
  SECTOR_CLAN_SYNONYMS,
).map(([sector, slug]) => {
  const clan = CLANS.find((candidate) => candidate.slug === slug);
  if (!clan) throw new Error(`clã padrão ausente no teste: ${slug}`);
  return {
    sector,
    normalizedSector: sector,
    clanId: clan.id,
    userId: null,
    userName: null,
  };
});

function known(rawName: string, userId: string): AssigneeSuggestion {
  return { rawName, userId, name: rawName };
}

function unknown(rawName: string): AssigneeSuggestion {
  return { rawName, userId: null, name: null };
}

describe("normalização do setor", () => {
  test("remove acento, caixa e pontuação", () => {
    expect(normalizeSectorText("PRÓ-LABORE")).toBe("pro labore");
    expect(normalizeSectorText("Certificado Digital")).toBe("certificado digital");
  });

  test("remove numeração e negrito do WhatsApp", () => {
    expect(stripSectorDecorations("5.0 – *COBRANÇA")).toBe("COBRANÇA");
    expect(stripSectorDecorations("1.1 - FISCAL")).toBe("FISCAL");
  });
});

describe("tabela de sinônimos setor→clã", () => {
  test.each([
    ["CONTABIL", "clan-contabil"],
    ["EMISSÃO DE NOTAS", "clan-sucesso"],
    ["CERTIFICADO DIGITAL", "clan-sucesso"],
    ["AUTOMAÇÕES", "clan-sucesso"],
    ["ARQUIVO", "clan-sucesso"],
    ["INFORMATIVOS", "clan-fiscal"],
    ["COBRANÇA", "clan-financeiro"],
    ["HONORÁRIO", "clan-financeiro"],
    ["PRÓ-LABORE", "clan-rh"],
    ["ABERTURA", "clan-societario"],
    ["ALTERAÇÃO", "clan-societario"],
    ["BAIXA", "clan-societario"],
  ])("%s roteia para o clã", (sector, clanId) => {
    expect(resolveSectorClan(sector, CLANS)?.id).toBe(clanId);
  });

  test("aceita o nome do próprio clã", () => {
    expect(resolveSectorClan("Societário", CLANS)?.id).toBe("clan-societario");
    expect(resolveSectorClan("rh", CLANS)?.id).toBe("clan-rh");
  });

  test.each([
    "SERVIDOR",
    "Administrativo",
  ])("%s permanece sem clã padrão", (sector) => {
    expect(resolveSectorClan(sector, CLANS)).toBeNull();
  });

  test("rótulo composto com segmentos do mesmo clã resolve", () => {
    expect(
      resolveSectorClan("FISCAL / EMISSÃO DE NOTAS / INFORMATIVOS", CLANS)?.id,
    ).toBe("clan-sucesso");
    expect(resolveSectorClan("COBRANÇA / HONORÁRIO", CLANS)?.id).toBe(
      "clan-financeiro",
    );
    expect(resolveSectorClan("RH — PRÓ-LABORE", CLANS)?.id).toBe("clan-rh");
  });

  test("segmentos que apontam para clãs diferentes não são adivinhados", () => {
    expect(resolveSectorClan("FISCAL / CONTABIL", CLANS)).toBeNull();
  });

  test("setor vazio ou ausente não resolve", () => {
    expect(resolveSectorClan(null, CLANS)).toBeNull();
    expect(resolveSectorClan("   ", CLANS)).toBeNull();
  });

  test("clã inativo fora da lista não é alcançável", () => {
    const semRh = CLANS.filter((clan) => clan.slug !== "rh");
    expect(resolveSectorClan("PRÓ-LABORE", semRh)).toBeNull();
  });
});

describe("regra de roteamento — as três linhas da tabela", () => {
  test("1. setor com clã: nasce do clã, sem responsável, mesmo com Att.", () => {
    const route = routeInformativeTask({
      sector: "FISCAL",
      suggestions: [known("Camila", "user-camila")],
      clans: CLANS,
    });
    expect(route).toEqual({ outcome: "clan", clan: CLANS[0] });
  });

  test("2. sem clã mas com nome reconhecido: missão individual", () => {
    const route = routeInformativeTask({
      sector: "SERVIDOR",
      suggestions: [known("Bruno", "user-bruno")],
      clans: CLANS,
    });
    expect(route.outcome).toBe("individual");
    if (route.outcome !== "individual") throw new Error("rota inesperada");
    expect(route.assignees.map((person) => person.userId)).toEqual(["user-bruno"]);
  });

  test("3. sem clã e sem nome: pendente de decisão humana", () => {
    const route = routeInformativeTask({
      sector: "WHATSAPP / BOAS-VINDAS",
      suggestions: [],
      clans: CLANS,
    });
    expect(route.outcome).toBe("pending");
  });

  test("nomes múltiplos sem clã geram uma missão por pessoa reconhecida", () => {
    const route = routeInformativeTask({
      sector: "ADMINISTRATIVO",
      suggestions: [known("Rafa", "user-rafa"), known("Bruno", "user-bruno")],
      clans: CLANS,
    });
    expect(route.outcome).toBe("individual");
    if (route.outcome !== "individual") throw new Error("rota inesperada");
    expect(route.assignees).toHaveLength(2);
  });

  test("a mesma pessoa citada duas vezes não duplica a missão", () => {
    const route = routeInformativeTask({
      sector: "SERVIDOR",
      suggestions: [known("Bruno", "user-bruno"), known("bruno", "user-bruno")],
      clans: CLANS,
    });
    expect(route.outcome).toBe("individual");
    if (route.outcome !== "individual") throw new Error("rota inesperada");
    expect(route.assignees).toHaveLength(1);
  });

  test("nome desconhecido sem clã fica pendente e preserva o nome citado", () => {
    const route = routeInformativeTask({
      sector: "WHATSAPP",
      suggestions: [unknown("Jurandir")],
      clans: CLANS,
    });
    expect(route.outcome).toBe("pending");
    if (route.outcome !== "pending") throw new Error("rota inesperada");
    expect(route.reason).toContain("Jurandir");
  });

  test("nome desconhecido junto de um reconhecido não bloqueia a missão", () => {
    const route = routeInformativeTask({
      sector: "ADMINISTRATIVO",
      suggestions: [unknown("Jurandir"), known("Eduarda", "user-eduarda")],
      clans: CLANS,
    });
    expect(route.outcome).toBe("individual");
    if (route.outcome !== "individual") throw new Error("rota inesperada");
    expect(route.assignees.map((person) => person.userId)).toEqual([
      "user-eduarda",
    ]);
  });
});

describe("roteamento configurável pela organização", () => {
  const atendimento: RoutingClan = {
    id: "clan-atendimento",
    name: "Atendimento",
    slug: "atendimento",
  };
  const rules: InformativeRoutingRule[] = [
    {
      sector: "Boas-vindas",
      normalizedSector: "boas vindas",
      clanId: atendimento.id,
      userId: null,
      userName: null,
    },
    {
      sector: "Certificado digital",
      normalizedSector: "certificado digital",
      clanId: atendimento.id,
      userId: "user-bruno",
      userName: "Bruno",
    },
  ];

  test("um novo clã recebe a parte cadastrada sem regra no código", () => {
    expect(
      routeInformativeTask({
        sector: "BOAS-VINDAS",
        suggestions: [],
        clans: [...CLANS, atendimento],
        rules,
      }),
    ).toEqual({ outcome: "clan", clan: atendimento });
  });

  test("uma parte configurada reconhece o complemento operacional do setor", () => {
    const automationRules: InformativeRoutingRule[] = [{
      sector: "Automação",
      normalizedSector: "automacao",
      clanId: atendimento.id,
      userId: null,
      userName: null,
    }];
    expect(
      routeInformativeTask({
        sector: "AUTOMAÇÃO FABI – ONVIO",
        suggestions: [],
        clans: [...CLANS, atendimento],
        rules: automationRules,
      }),
    ).toEqual({ outcome: "clan", clan: atendimento });
  });

  test("uma parte pode ir direto para pessoa no contexto do clã escolhido", () => {
    const route = routeInformativeTask({
      sector: "Certificado Digital",
      suggestions: [],
      clans: [...CLANS, atendimento],
      rules,
    });
    expect(route).toEqual({
      outcome: "individual",
      clan: atendimento,
      assignees: [
        {
          rawName: "Bruno",
          userId: "user-bruno",
          name: "Bruno",
        },
      ],
    });
  });

  test("lista configurada vazia não reaplica os destinos legados", () => {
    const route = routeInformativeTask({
      sector: "FISCAL",
      suggestions: [],
      clans: CLANS,
      rules: [],
    });
    expect(route.outcome).toBe("pending");
  });
});

/**
 * Informativo real da PICCOLI AGRO (2026-08-17), no formato antigo do
 * WhatsApp. Com Sucesso do Cliente, as rotinas de atendimento deixam de ser
 * atribuições avulsas e passam a uma fila operacional configurada.
 */
describe("informativo real da PICCOLI — formato antigo", () => {
  const PEOPLE: Record<string, string> = {
    Camila: "user-camila",
    Eduarda: "user-eduarda",
    Carol: "user-carol",
    Jenifer: "user-jenifer",
    Rafa: "user-rafa",
    Bruno: "user-bruno",
    Fabi: "user-fabi",
  };
  const suggest = (...names: string[]): AssigneeSuggestion[] =>
    names.map((name) =>
      PEOPLE[name] ? known(name, PEOPLE[name]) : unknown(name),
    );

  const LINES: Array<{
    sector: string;
    names: string[];
    expected: "clan" | "individual" | "pending";
    clanId?: string;
  }> = [
    {
      sector: "1.1 – *FISCAL / EMISSÃO DE NOTAS / INFORMATIVOS",
      names: ["Camila", "Eduarda"],
      expected: "clan",
      clanId: "clan-sucesso",
    },
    {
      sector: "2.0 - RH — PRÓ-LABORE",
      names: ["Carol", "Jenifer"],
      expected: "clan",
      clanId: "clan-rh",
    },
    {
      sector: "3.0 – CONTABIL",
      names: ["Rafa", "Bruno"],
      expected: "clan",
      clanId: "clan-contabil",
    },
    {
      sector: "5.0 – *COBRANÇA / HONORÁRIO",
      names: ["Camila"],
      expected: "clan",
      clanId: "clan-financeiro",
    },
    {
      sector: "1.2 – *FISCAL",
      names: ["Camila"],
      expected: "clan",
      clanId: "clan-fiscal",
    },
    {
      sector: "4.0 – CERTIFICADO DIGITAL",
      names: ["Bruno"],
      expected: "clan",
      clanId: "clan-sucesso",
    },
    {
      sector: "6.0 – AUTOMAÇÃO FABI – ONVIO",
      names: ["Fabi"],
      expected: "clan",
      clanId: "clan-sucesso",
    },
    {
      sector: "6.0 – AUTOMAÇÃO – VERI",
      names: ["Bruno"],
      expected: "clan",
      clanId: "clan-sucesso",
    },
    { sector: "7.0 - SERVIDOR", names: ["Bruno"], expected: "individual" },
    {
      sector: "8.0 – ARQUIVO",
      names: ["Eduarda"],
      expected: "clan",
      clanId: "clan-sucesso",
    },
    {
      sector: "9.0 – WHATSAPP / BOAS-VINDAS",
      names: [],
      expected: "pending",
    },
  ];

  test.each(LINES)("$sector → $expected", ({ sector, names, expected, clanId }) => {
    const route = routeInformativeTask({
      sector,
      suggestions: suggest(...names),
      clans: CLANS,
      rules: DEFAULT_RULES,
    });
    expect(route.outcome).toBe(expected);
    if (route.outcome === "clan" && clanId) {
      expect(route.clan.id).toBe(clanId);
    }
  });

  test("o informativo inteiro dá 9 de clã, 1 direta e 1 pendente", () => {
    const outcomes = LINES.map(
      ({ sector, names }) =>
        routeInformativeTask({
          sector,
          suggestions: suggest(...names),
          clans: CLANS,
          rules: DEFAULT_RULES,
        }).outcome,
    );
    expect(outcomes.filter((outcome) => outcome === "clan")).toHaveLength(9);
    expect(outcomes.filter((outcome) => outcome === "individual")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === "pending")).toHaveLength(1);
  });

  test("nenhuma linha do informativo é roteada para fora dos clãs padrão", () => {
    for (const { sector } of LINES) {
      const clan = resolveSectorClan(sector, CLANS, DEFAULT_RULES);
      if (clan) expect(CLANS).toContain(clan);
    }
  });
});

/** O mesmo informativo reescrito no formato recomendado pela spec. */
describe("informativo da PICCOLI — formato novo", () => {
  const PEOPLE: Record<string, string> = {
    Camila: "user-camila",
    Eduarda: "user-eduarda",
    Bruno: "user-bruno",
    Fabi: "user-fabi",
  };
  const LINES: Array<[string, string[], string]> = [
    ["Fiscal", ["Camila"], "clan"],
    ["Fiscal", ["Eduarda"], "clan"],
    ["RH", [], "clan"],
    ["Contabilidade", [], "clan"],
    ["Financeiro", ["Camila"], "clan"],
    ["Certificado digital", ["Bruno"], "clan"],
    ["Automação", ["Fabi"], "clan"],
    ["Automação", ["Bruno"], "clan"],
    ["Servidor", ["Bruno"], "individual"],
    ["Arquivo", ["Eduarda"], "clan"],
    ["Administrativo", ["Eduarda"], "individual"],
  ];

  test("9 para clã, 2 diretas e nenhuma pendente", () => {
    const outcomes = LINES.map(([sector, names]) =>
      routeInformativeTask({
        sector,
        suggestions: names.map((name) => known(name, PEOPLE[name])),
        clans: CLANS,
        rules: DEFAULT_RULES,
      }).outcome,
    );
    expect(outcomes.filter((outcome) => outcome === "clan")).toHaveLength(9);
    expect(outcomes.filter((outcome) => outcome === "individual")).toHaveLength(2);
    expect(outcomes.filter((outcome) => outcome === "pending")).toHaveLength(0);
  });
});
