import { describe, expect, it } from "vitest";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import {
  informativeDraftPayloadSchema,
  informativeExtractionSchema,
} from "./informative-schema";

const extraction = {
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
      title: "Controlar Fator R",
      description: "Acompanhar faturamento e folha.",
      assignees: ["Camila Schütz"],
      priority: 3,
      difficulty: 3,
      dueDate: null,
      sourceSection: "FISCAL – Att. CAMILA – CONTROLAR O FATOR R",
    },
  ],
  ignoredNotes: [],
  warnings: [],
};

describe("informativeExtractionSchema", () => {
  it("aceita uma extração estruturada válida", () => {
    expect(informativeExtractionSchema.parse(extraction).tasks).toHaveLength(1);
  });

  it("é conversível para o formato estruturado da API", () => {
    expect(() => zodOutputFormat(informativeExtractionSchema)).not.toThrow();
  });

  it("recusa prioridade e prazo inventados fora do contrato", () => {
    expect(() =>
      informativeExtractionSchema.parse({
        ...extraction,
        tasks: [{ ...extraction.tasks[0], priority: 4, dueDate: "amanhã" }],
      }),
    ).toThrow();
  });
});

describe("informativeDraftPayloadSchema", () => {
  it("exige IDs e CNPJ normalizado no rascunho confirmado pelo servidor", () => {
    const payload = informativeDraftPayloadSchema.parse({
      ...extraction,
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
