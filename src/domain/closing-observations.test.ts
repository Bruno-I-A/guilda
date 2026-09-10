import { describe, expect, test } from "vitest";

import {
  observationBadge,
  observationState,
  parseObservationScope,
  suggestedMissionTitle,
  summarizeObservations,
} from "./closing-observations";

const EM = new Date("2026-09-10T12:00:00Z");

describe("estado da observação", () => {
  test("sem missão e sem resolução, está em aberto", () => {
    expect(observationState({ taskId: null, resolvedAt: null })).toBe("open");
  });

  test("com missão gerada, virou trabalho de alguém", () => {
    expect(observationState({ taskId: "t-1", resolvedAt: null })).toBe("assigned");
  });

  test("resolvida vence a missão em aberto", () => {
    // A missão pode ter sido cancelada, ou o assunto resolvido por fora:
    // quem cuida do fechamento dá a palavra final.
    expect(observationState({ taskId: "t-1", resolvedAt: EM })).toBe("resolved");
  });
});

describe("selo do card da empresa", () => {
  test("sem observação, não há selo", () => {
    expect(observationBadge(summarizeObservations([]))).toBeNull();
  });

  test("o que está em aberto manda, mesmo com outras encaminhadas", () => {
    const badge = observationBadge(
      summarizeObservations([
        { taskId: null, resolvedAt: null },
        { taskId: "t-1", resolvedAt: null },
        { taskId: null, resolvedAt: EM },
      ]),
    );
    expect(badge).toEqual({ label: "1 observação em aberto", tone: "attention" });
  });

  test("tudo encaminhado deixa de pedir atenção", () => {
    const badge = observationBadge(
      summarizeObservations([
        { taskId: "t-1", resolvedAt: null },
        { taskId: "t-2", resolvedAt: null },
      ]),
    );
    expect(badge).toEqual({ label: "2 viraram missão", tone: "idle" });
  });

  test("tudo resolvido some do radar sem sumir da tela", () => {
    const badge = observationBadge(
      summarizeObservations([{ taskId: null, resolvedAt: EM }]),
    );
    expect(badge).toEqual({ label: "observações resolvidas", tone: "idle" });
  });

  test("plural de uma em aberto", () => {
    const badge = observationBadge(
      summarizeObservations([
        { taskId: null, resolvedAt: null },
        { taskId: null, resolvedAt: null },
      ]),
    );
    expect(badge?.label).toBe("2 observações em aberto");
  });
});

describe("resumo", () => {
  test("conta cada estado uma vez só", () => {
    expect(
      summarizeObservations([
        { taskId: null, resolvedAt: null },
        { taskId: "t-1", resolvedAt: null },
        { taskId: "t-2", resolvedAt: EM },
        { taskId: null, resolvedAt: EM },
      ]),
    ).toEqual({ total: 4, open: 1, assigned: 1, resolved: 2, pending: 1 });
  });
});

describe("título sugerido para a missão", () => {
  test("junta o recado com a empresa", () => {
    expect(
      suggestedMissionTitle({
        body: "Tem rubricas para configurar em 30/08",
        clientName: "ADELAIDE CAZZONATO",
      }),
    ).toBe("Tem rubricas para configurar em 30/08 — ADELAIDE CAZZONATO");
  });

  test("usa só a primeira frase de um texto longo", () => {
    expect(
      suggestedMissionTitle({
        body: "Configurar rubricas. Depois conferir o balancete e avisar o cliente.",
        clientName: "Empresa X",
      }),
    ).toBe("Configurar rubricas — Empresa X");
  });

  test("respeita o limite da coluna, preservando o nome da empresa", () => {
    const titulo = suggestedMissionTitle({
      body: "a".repeat(400),
      clientName: "Empresa Y",
      maxLength: 60,
    });
    expect(titulo.length).toBeLessThanOrEqual(60);
    expect(titulo.endsWith("— Empresa Y")).toBe(true);
  });

  test("normaliza espaços e quebras de linha", () => {
    expect(
      suggestedMissionTitle({ body: "  Ajustar\n\n  plano de contas  ", clientName: "Z" }),
    ).toBe("Ajustar plano de contas — Z");
  });
});

describe("escopo vindo da URL ou do formulário", () => {
  test("aceita os três conhecidos", () => {
    expect(parseObservationScope("defis")).toBe("defis");
    expect(parseObservationScope("closing")).toBe("closing");
    expect(parseObservationScope("year")).toBe("year");
  });

  test("qualquer outra coisa cai no ano", () => {
    expect(parseObservationScope("qualquer")).toBe("year");
    expect(parseObservationScope(undefined)).toBe("year");
  });
});
