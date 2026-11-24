import { describe, expect, test } from "vitest";

import { agentDeliveryBlock, matchTestKeyword, normalizeTestKeyword } from "./support-agent";

describe("palavra-chave do teste do agente", () => {
  test("normaliza para uma palavra sem acento e recusa o resto", () => {
    expect(normalizeTestKeyword(" Batata ")).toBe("batata");
    expect(normalizeTestKeyword("Pão")).toBe("pao");
    expect(normalizeTestKeyword("teste2026")).toBe("teste2026");
    expect(normalizeTestKeyword("ab")).toBeNull();
    expect(normalizeTestKeyword("duas palavras")).toBeNull();
    expect(normalizeTestKeyword("")).toBeNull();
  });

  test("só abre quando é o primeiro termo e devolve o resto da mensagem", () => {
    expect(matchTestKeyword("batata", "batata")).toEqual({ matched: true, rest: "" });
    expect(matchTestKeyword("Batata, preciso da guia", "batata")).toEqual({ matched: true, rest: "preciso da guia" });
    expect(matchTestKeyword("  BATATÁ! oi", "batata")).toEqual({ matched: true, rest: "oi" });
    expect(matchTestKeyword("quero batata", "batata").matched).toBe(false);
    expect(matchTestKeyword("batatas", "batata").matched).toBe(false);
    expect(matchTestKeyword(null, "batata").matched).toBe(false);
    expect(matchTestKeyword("batata", null).matched).toBe(false);
  });
});

describe("trava de envio da IA", () => {
  const round = new Date("2026-11-19T14:00:00.000Z");
  const ok = { payloadRound: round.toISOString(), roundStartedAt: round, status: "ai_active", mode: "test" as const };

  test("libera a fala da rodada com o agente em teste ou para todos", () => {
    expect(agentDeliveryBlock(ok)).toBeNull();
    expect(agentDeliveryBlock({ ...ok, mode: "live" })).toBeNull();
    // O aviso de encaminhamento sai com a conversa já passada para a equipe.
    expect(agentDeliveryBlock({ ...ok, status: "needs_human" })).toBeNull();
  });

  test("segura com o agente desligado, fora da rodada ou com pessoa no comando", () => {
    expect(agentDeliveryBlock({ ...ok, mode: "off" })).toMatch(/desligado/);
    expect(agentDeliveryBlock({ ...ok, payloadRound: undefined })).toMatch(/fora da rodada/);
    expect(agentDeliveryBlock({ ...ok, roundStartedAt: new Date("2026-11-19T15:00:00Z") })).toMatch(/fora da rodada/);
    expect(agentDeliveryBlock({ ...ok, roundStartedAt: null })).toMatch(/fora da rodada/);
    expect(agentDeliveryBlock({ ...ok, status: "human_active" })).toMatch(/pessoa assumiu/);
  });
});
