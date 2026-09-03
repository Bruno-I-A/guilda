import { describe, expect, it } from "vitest";

import {
  parseQuickMission,
  quickMissionMentionAtCursor,
  resolveQuickDueDate,
  suggestQuickMissionTargets,
  type QuickMissionContext,
} from "./quick-mission";

// Quinta-feira, 3 de setembro de 2026, no fuso local do teste.
const NOW = new Date(2026, 8, 3, 15, 0, 0);

const CTX: QuickMissionContext = {
  now: NOW,
  members: [
    { userId: "u-bruno", name: "Bruno Klain" },
    { userId: "u-bruna", name: "Bruna Souza" },
    { userId: "u-camila", name: "Camila Ávila" },
    { userId: "u-ze", name: "José Carlos Ávila", resolutionError: "Sem vínculo com um clã ativo." },
  ],
  clans: [
    { id: "c-fiscal", name: "Fiscal" },
    { id: "c-rh", name: "RH" },
  ],
};

describe("parseQuickMission", () => {
  it("sem atalho, a linha inteira é o título e a missão é para quem digita", () => {
    const parsed = parseQuickMission("Conferir DAS de agosto", CTX);
    expect(parsed).toEqual({
      title: "Conferir DAS de agosto",
      target: { kind: "self" },
      priority: 2,
      difficulty: 2,
      dueDate: null,
      issues: [],
    });
  });

  it("lê os quatro atalhos e deixa só o título limpo", () => {
    const parsed = parseQuickMission("Conferir DAS de agosto @Camila !alta ~sexta #4", CTX);
    expect(parsed.title).toBe("Conferir DAS de agosto");
    expect(parsed.target).toEqual({ kind: "person", userId: "u-camila", name: "Camila Ávila" });
    expect(parsed.priority).toBe(3);
    expect(parsed.difficulty).toBe(4);
    expect(parsed.dueDate).toBe("2026-09-04");
    expect(parsed.issues).toEqual([]);
  });

  it("atalho no meio da frase também sai do título", () => {
    const parsed = parseQuickMission("Ligar @Camila sobre o balancete !baixa de agosto", CTX);
    expect(parsed.title).toBe("Ligar sobre o balancete de agosto");
    expect(parsed.priority).toBe(1);
  });

  it("nome completo com acento e espaço é reconhecido inteiro", () => {
    const parsed = parseQuickMission("Revisar folha @Camila Avila, urgente", CTX);
    expect(parsed.target).toEqual({ kind: "person", userId: "u-camila", name: "Camila Ávila" });
    expect(parsed.title).toBe("Revisar folha, urgente");
  });

  it("@clã manda a missão para o clã", () => {
    const parsed = parseQuickMission("Parametrizar empresa nova @fiscal", CTX);
    expect(parsed.target).toEqual({ kind: "clan", clanId: "c-fiscal", name: "Fiscal" });
  });

  it("primeiro nome ambíguo vira aviso, não chute", () => {
    const parsed = parseQuickMission("Cobrar retorno @Bru", CTX);
    expect(parsed.target).toEqual({ kind: "self" });
    expect(parsed.issues).toHaveLength(1);
    expect(parsed.issues[0].token).toBe("@Bru");
    expect(parsed.issues[0].message).toContain("Bruno Klain");
    expect(parsed.issues[0].message).toContain("Bruna Souza");
  });

  it("primeiro nome único resolve", () => {
    const parsed = parseQuickMission("Cobrar retorno @bruno", CTX);
    expect(parsed.target).toEqual({ kind: "person", userId: "u-bruno", name: "Bruno Klain" });
  });

  it("nome desconhecido e pessoa sem clã viram avisos", () => {
    const unknown = parseQuickMission("Algo @Fulano", CTX);
    expect(unknown.issues[0].message).toContain("Fulano");

    const blocked = parseQuickMission("Algo @José Carlos Ávila", CTX);
    expect(blocked.target).toEqual({ kind: "self" });
    expect(blocked.issues[0].message).toContain("Sem vínculo");
  });

  it("atalho inválido vira aviso e o resto continua valendo", () => {
    const parsed = parseQuickMission("Título !altíssima #9 ~ontem", CTX);
    expect(parsed.title).toBe("Título");
    expect(parsed.priority).toBe(2);
    expect(parsed.difficulty).toBe(2);
    expect(parsed.dueDate).toBeNull();
    expect(parsed.issues.map((issue) => issue.token)).toEqual(["!altíssima", "#9", "~ontem"]);
  });

  it("marcador colado numa palavra não é atalho", () => {
    const parsed = parseQuickMission("Enviar e-mail para joao@empresa.com #1", CTX);
    expect(parsed.title).toBe("Enviar e-mail para joao@empresa.com");
    expect(parsed.difficulty).toBe(1);
    expect(parsed.issues).toEqual([]);
  });
});

describe("resolveQuickDueDate", () => {
  it("hoje, amanhã e dia da semana (próxima ocorrência, incluindo hoje)", () => {
    expect(resolveQuickDueDate("hoje", NOW)).toBe("2026-09-03");
    expect(resolveQuickDueDate("amanhã", NOW)).toBe("2026-09-04");
    expect(resolveQuickDueDate("quinta", NOW)).toBe("2026-09-03");
    expect(resolveQuickDueDate("sex", NOW)).toBe("2026-09-04");
    expect(resolveQuickDueDate("segunda-feira", NOW)).toBe("2026-09-07");
    expect(resolveQuickDueDate("quarta", NOW)).toBe("2026-09-09");
  });

  it("dias relativos", () => {
    expect(resolveQuickDueDate("+3", NOW)).toBe("2026-09-06");
    expect(resolveQuickDueDate("10d", NOW)).toBe("2026-09-13");
  });

  it("data brasileira: sem ano assume o próximo futuro", () => {
    expect(resolveQuickDueDate("15/09", NOW)).toBe("2026-09-15");
    expect(resolveQuickDueDate("01/02", NOW)).toBe("2027-02-01");
    expect(resolveQuickDueDate("3/9", NOW)).toBe("2026-09-03");
    expect(resolveQuickDueDate("15/09/2027", NOW)).toBe("2027-09-15");
    expect(resolveQuickDueDate("15/09/27", NOW)).toBe("2027-09-15");
    expect(resolveQuickDueDate("2026-12-25", NOW)).toBe("2026-12-25");
  });

  it("data inexistente e lixo devolvem null", () => {
    expect(resolveQuickDueDate("31/02", NOW)).toBeNull();
    expect(resolveQuickDueDate("2026-02-30", NOW)).toBeNull();
    expect(resolveQuickDueDate("ontem", NOW)).toBeNull();
    expect(resolveQuickDueDate("", NOW)).toBeNull();
  });
});

describe("quickMissionMentionAtCursor", () => {
  it("encontra o @ em digitação e ignora e-mail", () => {
    expect(quickMissionMentionAtCursor("Fazer algo @Cam", 15)).toEqual({ start: 11, query: "Cam" });
    expect(quickMissionMentionAtCursor("Fazer algo @Bruno K", 19)).toEqual({ start: 11, query: "Bruno K" });
    expect(quickMissionMentionAtCursor("joao@empresa", 12)).toBeNull();
    expect(quickMissionMentionAtCursor("Fazer algo @Cam !alta", 21)).toBeNull();
  });
});

describe("suggestQuickMissionTargets", () => {
  it("sugere pessoas aptas e clãs pelo prefixo, sem quem não pode receber missão", () => {
    const all = suggestQuickMissionTargets("", CTX);
    expect(all.map((target) => (target.kind === "self" ? "você" : target.name))).toEqual([
      "Bruno Klain",
      "Bruna Souza",
      "Camila Ávila",
      "Fiscal",
      "RH",
    ]);
    expect(suggestQuickMissionTargets("f", CTX)).toEqual([
      { kind: "clan", clanId: "c-fiscal", name: "Fiscal" },
    ]);
    expect(suggestQuickMissionTargets("ávi", CTX)).toEqual([
      { kind: "person", userId: "u-camila", name: "Camila Ávila" },
    ]);
  });
});
