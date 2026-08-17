import { describe, expect, it } from "vitest";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import {
  informativeDraftPayloadSchema,
  informativeExtractionSchema,
} from "./informative-schema";

const extraction = {
  isMissionRequest: true,
  kind: "new_client" as const,
  company: {
    systemCode: "1124",
    legalName: "PICCOLI AGRO SERVIÇOS LTDA",
    cnpj: "68.100.490/0001-31",
    taxRegime: "simples" as const,
    city: "Getúlio Vargas",
    contact: "Felipe",
    summary: "Novo cliente sujeito ao Fator R.",
  },
  tasks: [
    {
      category: "general" as const,
      title: "Controlar Fator R",
      description: "Acompanhar faturamento e folha.",
      sector: "FISCAL",
      assignees: ["Camila Schütz"],
      priority: 3,
      difficulty: 3,
      dueDate: null,
      closingYear: null,
      sourceSection: "FISCAL – Att. CAMILA – CONTROLAR O FATOR R",
    },
  ],
  ignoredNotes: [],
  warnings: [],
  missingFields: [],
};

const CLAN_ID = "123e4567-e89b-12d3-a456-426614174000";

const draftBase = {
  ...extraction,
  sourceFormat: "informative" as const,
  company: {
    ...extraction.company,
    normalizedCnpj: "68100490000131",
    clientId: null,
    createClient: true,
  },
  observations: [],
  unresolvedAssignees: [],
};

function draftTask(overrides: Record<string, unknown>) {
  const [task] = extraction.tasks;
  return {
    category: task.category,
    title: task.title,
    description: task.description,
    priority: task.priority,
    difficulty: task.difficulty,
    dueDate: task.dueDate,
    closingYear: task.closingYear,
    sourceSection: task.sourceSection,
    sector: task.sector,
    suggestions: [],
    ...overrides,
  };
}

describe("informativeExtractionSchema", () => {
  it("aceita uma extração estruturada válida", () => {
    expect(informativeExtractionSchema.parse(extraction).tasks).toHaveLength(1);
  });

  it("é conversível para o formato estruturado da API", () => {
    expect(() => zodOutputFormat(informativeExtractionSchema)).not.toThrow();
  });

  it("devolve o setor como texto, sem escolher o destino", () => {
    const parsed = informativeExtractionSchema.parse({
      ...extraction,
      tasks: [{ ...extraction.tasks[0], sector: "COBRANÇA / HONORÁRIO" }],
    });
    expect(parsed.tasks[0]?.sector).toBe("COBRANÇA / HONORÁRIO");
    expect(parsed.tasks[0]).not.toHaveProperty("clanName");
  });

  it("representa conversa comum sem inventar uma missão", () => {
    const result = informativeExtractionSchema.parse({
      isMissionRequest: false,
      kind: null,
      company: {
        systemCode: null,
        legalName: null,
        cnpj: null,
        taxRegime: null,
        city: null,
        contact: null,
        summary: null,
      },
      tasks: [],
      ignoredNotes: [],
      warnings: [],
      missingFields: [],
    });
    expect(result.isMissionRequest).toBe(false);
  });

  it("permite à IA indicar os dados essenciais ausentes", () => {
    const result = informativeExtractionSchema.parse({
      ...extraction,
      kind: null,
      tasks: [],
      missingFields: ["actions", "responsible"],
    });
    expect(result.missingFields).toEqual(["actions", "responsible"]);
  });

  it("recusa prioridade e prazo inventados fora do contrato", () => {
    expect(() =>
      informativeExtractionSchema.parse({
        ...extraction,
        tasks: [{ ...extraction.tasks[0], priority: 4, dueDate: "amanhã" }],
      }),
    ).toThrow();
  });

  it("aceita baixa de cliente e sinaliza ação ainda sem responsável", () => {
    const closure = informativeExtractionSchema.parse({
      ...extraction,
      kind: "client_closure",
      tasks: [
        {
          ...extraction.tasks[0],
          title: "Coletar assinatura no protocolo",
          assignees: [],
        },
      ],
    });
    expect(closure.kind).toBe("client_closure");
    expect(closure.tasks[0]?.assignees).toEqual([]);
  });

  it("aceita linha sem setor identificado", () => {
    const parsed = informativeExtractionSchema.parse({
      ...extraction,
      tasks: [{ ...extraction.tasks[0], sector: null, assignees: [] }],
    });
    expect(parsed.tasks[0]?.sector).toBeNull();
  });

  it("classifica uma data parcial como período, sem fechar o ano", () => {
    const closing = informativeExtractionSchema.parse({
      ...extraction,
      kind: "general_task",
      company: {
        ...extraction.company,
        legalName: "SCHARFF CONTABILIDADE LTDA",
      },
      tasks: [
        {
          ...extraction.tasks[0],
          category: "closing_period",
          title: "Fechar o balanço",
          dueDate: "2026-07-31",
          closingYear: null,
          assignees: ["Bruno"],
        },
      ],
    });
    expect(closing.kind).toBe("general_task");
    expect(closing.tasks[0]).toMatchObject({
      category: "closing_period",
      dueDate: "2026-07-31",
      closingYear: null,
    });
  });

  it("reserva o fechamento anual para o exercício inteiro explícito", () => {
    const annual = informativeExtractionSchema.parse({
      ...extraction,
      kind: "general_task",
      tasks: [
        {
          ...extraction.tasks[0],
          category: "annual_closing",
          title: "Encerrar o exercício inteiro",
          closingYear: 2025,
          assignees: ["Bruno"],
        },
      ],
    });
    expect(annual.tasks[0]).toMatchObject({
      category: "annual_closing",
      closingYear: 2025,
    });
  });

  it("permite solicitar a data ausente de um período", () => {
    const incomplete = informativeExtractionSchema.parse({
      ...extraction,
      kind: "general_task",
      tasks: [],
      missingFields: ["due_date"],
    });
    expect(incomplete.missingFields).toEqual(["due_date"]);
  });
});

describe("informativeDraftPayloadSchema", () => {
  it("exige IDs e CNPJ normalizado no rascunho resolvido pelo servidor", () => {
    const payload = informativeDraftPayloadSchema.parse({
      ...draftBase,
      tasks: [
        draftTask({
          assignmentType: "individual",
          assigneeId: "user-1",
          assigneeName: "Camila Schütz",
          clanId: CLAN_ID,
          clanName: "Fiscal",
        }),
      ],
    });
    expect(payload.company.createClient).toBe(true);
    expect(payload.tasks[0]).toMatchObject({
      assignmentType: "individual",
      assigneeId: "user-1",
      clanName: "Fiscal",
    });
  });

  it("guarda a sugestão do informativo na missão de clã, sem atribuir", () => {
    const payload = informativeDraftPayloadSchema.parse({
      ...draftBase,
      tasks: [
        draftTask({
          assignmentType: "clan",
          assigneeId: null,
          assigneeName: null,
          clanId: CLAN_ID,
          clanName: "Fiscal",
          suggestions: [
            { rawName: "Camila", userId: "user-1", name: "Camila Schütz" },
            { rawName: "Eduarda", userId: null, name: null },
          ],
        }),
      ],
    });
    expect(payload.tasks[0]).toMatchObject({
      assignmentType: "clan",
      assigneeId: null,
    });
    expect(payload.tasks[0]?.suggestions).toHaveLength(2);
  });

  it("representa a missão pendente de decisão humana", () => {
    const payload = informativeDraftPayloadSchema.parse({
      ...draftBase,
      tasks: [
        draftTask({
          assignmentType: "pending",
          assigneeId: null,
          assigneeName: null,
          clanId: null,
          clanName: null,
          sector: null,
          reason: "Sem setor de clã e sem pessoa indicada. Escolha o destino.",
        }),
      ],
    });
    expect(payload.tasks[0]?.assignmentType).toBe("pending");
  });

  it("recusa missão pendente que já traga um clã escolhido", () => {
    expect(() =>
      informativeDraftPayloadSchema.parse({
        ...draftBase,
        tasks: [
          draftTask({
            assignmentType: "pending",
            assigneeId: null,
            assigneeName: null,
            clanId: CLAN_ID,
            clanName: "Fiscal",
            reason: "qualquer",
          }),
        ],
      }),
    ).toThrow();
  });

  it("guarda as observações que não viram missão", () => {
    const payload = informativeDraftPayloadSchema.parse({
      ...draftBase,
      observations: ["Camila responde por todos os informativos da empresa."],
      tasks: [],
    });
    expect(payload.observations).toHaveLength(1);
  });

  it("recusa rascunho no formato anterior, sem discriminador", () => {
    expect(() =>
      informativeDraftPayloadSchema.parse({
        ...draftBase,
        tasks: [
          draftTask({
            assigneeId: "user-1",
            assigneeName: "Camila Schütz",
            clanId: CLAN_ID,
            clanName: "Fiscal",
          }),
        ],
      }),
    ).toThrow();
  });
});
