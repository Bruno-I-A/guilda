import { describe, expect, it } from "vitest";

import { informativeOutputFormat, normalizeInformativeExtraction } from "./informative-output";
import { informativeExtractionSchema } from "./informative-schema";

/** Como a resposta veio na produção: texto vazio onde o esquema pede ao menos uma letra. */
const rawFromModel = {
  isMissionRequest: true,
  kind: "general_task",
  company: { systemCode: "", legalName: "", cnpj: "", taxRegime: null, city: "", contact: "", summary: "" },
  tasks: [
    { category: "general", title: "Comprar um chopp para o Bruno", description: "", priority: 3, difficulty: 1, dueDate: "", closingYear: null, sourceSection: "", sector: "", assignees: ["Camila", ""] },
    { category: "general", title: "  ", description: "x", priority: 2, difficulty: 2, dueDate: null, closingYear: null, sourceSection: "x", sector: null, assignees: [] },
  ],
  ignoredNotes: [""],
  warnings: ["", "  "],
  missingFields: [],
  fiscalNote: { text: "", assignee: "" },
  commitments: [{ sector: "", title: "", cadence: "monthly", notes: "" }],
};

describe("resposta da IA do Informativo", () => {
  it("a resposta crua da produção não passava no esquema estrito", () => {
    expect(informativeExtractionSchema.safeParse(rawFromModel).success).toBe(false);
  });

  it("limpa vazios: descrição e trecho herdam o título, item vazio sai, missão sem título sai", () => {
    const parsed = informativeExtractionSchema.parse(normalizeInformativeExtraction(rawFromModel));
    expect(parsed.tasks).toHaveLength(1);
    expect(parsed.tasks[0]).toMatchObject({
      title: "Comprar um chopp para o Bruno",
      description: "Comprar um chopp para o Bruno",
      sourceSection: "Comprar um chopp para o Bruno",
      sector: null,
      assignees: ["Camila"],
      dueDate: null,
    });
    expect(parsed.company).toMatchObject({ legalName: null, cnpj: null, summary: null });
    expect(parsed.ignoredNotes).toEqual([]);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.fiscalNote).toBeNull();
    expect(parsed.commitments).toEqual([]);
  });

  it("o formato enviado ao SDK usa a limpeza e explica o que não dá para salvar", () => {
    const format = informativeOutputFormat();
    expect(format.type).toBe("json_schema");
    expect(format.parse(JSON.stringify(rawFromModel)).tasks[0].title).toBe("Comprar um chopp para o Bruno");
    expect(() => format.parse("não é json")).toThrow("não é JSON");
    expect(() => format.parse(JSON.stringify({ ...rawFromModel, isMissionRequest: "talvez" }))).toThrow("formato inesperado");
  });
});
