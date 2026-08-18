import { describe, expect, test } from "vitest";

import {
  authorizePortfolioChange,
  summarizePortfolio,
} from "./fiscal-portfolio";

const ACTIVE_TARGET = { userId: "ana", isActiveClanMember: true } as const;

describe("autorização de mudança na carteira", () => {
  test("atribui empresa sem responsável a integrante ativo", () => {
    expect(
      authorizePortfolioChange({
        clientIsActive: true,
        currentHolderId: null,
        target: ACTIVE_TARGET,
      }),
    ).toEqual({ allowed: true });
  });

  test("repassa empresa de uma pessoa para outra", () => {
    expect(
      authorizePortfolioChange({
        clientIsActive: true,
        currentHolderId: "bruno",
        target: ACTIVE_TARGET,
      }),
    ).toEqual({ allowed: true });
  });

  test("quem não é integrante ativo do clã não recebe carteira", () => {
    const decision = authorizePortfolioChange({
      clientIsActive: true,
      currentHolderId: null,
      target: { userId: "ana", isActiveClanMember: false },
    });
    expect(decision.allowed).toBe(false);
  });

  test("empresa inativa não entra em carteira", () => {
    const decision = authorizePortfolioChange({
      clientIsActive: false,
      currentHolderId: null,
      target: ACTIVE_TARGET,
    });
    expect(decision.allowed).toBe(false);
  });

  test("empresa inativa PODE sair da carteira", () => {
    expect(
      authorizePortfolioChange({
        clientIsActive: false,
        currentHolderId: "bruno",
        target: null,
      }),
    ).toEqual({ allowed: true });
  });

  test("atribuir para quem já responde pela empresa é ruído", () => {
    const decision = authorizePortfolioChange({
      clientIsActive: true,
      currentHolderId: "ana",
      target: ACTIVE_TARGET,
    });
    expect(decision.allowed).toBe(false);
  });

  test("remover empresa que já está sem responsável não faz nada", () => {
    const decision = authorizePortfolioChange({
      clientIsActive: true,
      currentHolderId: null,
      target: null,
    });
    expect(decision.allowed).toBe(false);
  });
});

describe("resumo da carteira", () => {
  const members = [
    { userId: "ana", name: "Ana" },
    { userId: "bruno", name: "Bruno" },
    { userId: "carla", name: "Carla" },
  ];
  const rows = [
    { clientId: "c1", clientName: "Zeta ME", holderId: "ana" },
    { clientId: "c2", clientName: "Alfa LTDA", holderId: "ana" },
    { clientId: "c3", clientName: "Beta SA", holderId: "bruno" },
    { clientId: "c4", clientName: "Ômega EIRELI", holderId: null },
  ];

  test("agrupa por pessoa em ordem alfabética de empresa", () => {
    const { buckets } = summarizePortfolio(members, rows);
    expect(buckets[0].clients.map((client) => client.clientName)).toEqual([
      "Alfa LTDA",
      "Zeta ME",
    ]);
  });

  test("integrante sem empresa aparece com carteira vazia", () => {
    const { buckets } = summarizePortfolio(members, rows);
    const carla = buckets.find((bucket) => bucket.userId === "carla");
    expect(carla?.clients).toEqual([]);
  });

  test("empresas sem responsável ficam em bloco próprio", () => {
    const { orphans } = summarizePortfolio(members, rows);
    expect(orphans.map((client) => client.clientId)).toEqual(["c4"]);
  });

  test("média ignora as empresas sem responsável", () => {
    // 3 empresas atribuídas / 3 integrantes
    expect(summarizePortfolio(members, rows).averagePerMember).toBe(1);
  });

  test("clã sem integrante não divide por zero", () => {
    expect(summarizePortfolio([], rows).averagePerMember).toBe(0);
  });
});
