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

describe("informativeExtractionSchema", () => {
  it("aceita uma extração estruturada válida", () => {
    expect(informativeExtractionSchema.parse(extraction).tasks).toHaveLength(1);
  });

  it("é conversível para o formato estruturado da API", () => {
    expect(() => zodOutputFormat(informativeExtractionSchema)).not.toThrow();
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
  it("exige IDs e CNPJ normalizado no rascunho confirmado pelo servidor", () => {
    const payload = informativeDraftPayloadSchema.parse({
      ...extraction,
      sourceFormat: "informative",
      company: {
        ...extraction.company,
        normalizedCnpj: "68100490000131",
        clientId: null,
        createClient: true,
      },
      tasks: extraction.tasks.map((task) => ({
        title: task.title,
        description: task.description,
        priority: task.priority,
        difficulty: task.difficulty,
        dueDate: task.dueDate,
        category: task.category,
        closingYear: task.closingYear,
        sourceSection: task.sourceSection,
        assigneeId: "user-1",
        assigneeName: "Camila Schütz",
      })),
      unresolvedAssignees: [],
    });
    expect(payload.company.createClient).toBe(true);
    expect(payload.tasks[0]?.assigneeId).toBe("user-1");
  });
});
