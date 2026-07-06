import { describe, expect, it } from "vitest";

import {
  constellationNodes,
  starField,
  VIEW_H,
  VIEW_W,
  WINDOW_AHEAD,
} from "./constellation";
import { xpForLevel } from "@/domain/xp";

describe("constellationNodes", () => {
  it("no nível 0 mostra a janela 0..6 (sem níveis negativos)", () => {
    const data = constellationNodes(0);
    expect(data.level).toBe(0);
    expect(data.nodes).toHaveLength(WINDOW_AHEAD + 1);
    expect(data.nodes[0].level).toBe(0);
    expect(data.nodes[0].current).toBe(true);
    expect(data.nodes[0].reached).toBe(true);
    expect(data.nodes.slice(1).every((n) => !n.reached)).toBe(true);
  });

  it("com janela cheia tem 11 nós e o atual no índice 4", () => {
    const totalXp = xpForLevel(7); // exatamente o piso do nível 7
    const data = constellationNodes(totalXp);
    expect(data.level).toBe(7);
    expect(data.nodes).toHaveLength(11);
    expect(data.nodes[4].current).toBe(true);
    expect(data.nodes[4].level).toBe(7);
    expect(data.nodes[3].reached).toBe(true);
    expect(data.nodes[5].reached).toBe(false);
  });

  it("posições ficam dentro do viewBox para uma faixa ampla de XP", () => {
    for (const xp of [0, 50, 100, 500, 1852, 10_000, 250_000]) {
      for (const node of constellationNodes(xp).nodes) {
        expect(node.x).toBeGreaterThanOrEqual(0);
        expect(node.x).toBeLessThanOrEqual(VIEW_W);
        expect(node.y).toBeGreaterThanOrEqual(0);
        expect(node.y).toBeLessThanOrEqual(VIEW_H);
      }
    }
  });

  it("xpRequired é estritamente crescente ao longo dos nós", () => {
    const { nodes } = constellationNodes(5000);
    for (let i = 1; i < nodes.length; i++) {
      expect(nodes[i].xpRequired).toBeGreaterThan(nodes[i - 1].xpRequired);
    }
  });

  it("mesma entrada produz sempre o mesmo layout (determinístico)", () => {
    expect(constellationNodes(777)).toEqual(constellationNodes(777));
  });

  it("XP negativo (reversões) clampa para o nível 0 sem quebrar", () => {
    const data = constellationNodes(-50);
    expect(data.level).toBe(0);
    expect(data.nodes[0].current).toBe(true);
  });
});

describe("starField", () => {
  it("gera o céu determinístico dentro do viewBox", () => {
    const stars = starField();
    expect(stars).toHaveLength(40);
    expect(starField()).toEqual(stars);
    for (const s of stars) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(VIEW_W);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThanOrEqual(VIEW_H);
    }
  });
});
