import { describe, expect, test } from "vitest";

import {
  calculateTaskXp,
  LEVEL_SOFT_CAP,
  levelFromXp,
  levelProgress,
  MAX_LEVEL,
  xpForLevel,
} from "./xp";

/** A curva anterior ao patamar, para provar o que mudou e o que não mudou. */
const legacyXpForLevel = (level: number) =>
  Math.floor(100 * Math.pow(level, 1.5));
const legacyLevelFromXp = (totalXp: number) => {
  if (totalXp <= 0) return 0;
  let level = 0;
  while (legacyXpForLevel(level + 1) <= totalXp) level++;
  return level;
};

describe("calculateTaskXp — xp_value = difficulty * 20 + (priority - 1) * 10", () => {
  test("dificuldade mínima e prioridade baixa valem 20 XP", () => {
    expect(calculateTaskXp(1, 1)).toBe(20);
  });

  test("dificuldade máxima e prioridade alta valem 120 XP", () => {
    expect(calculateTaskXp(5, 3)).toBe(120);
  });

  test("valores padrão (dificuldade 2, prioridade média) valem 50 XP", () => {
    expect(calculateTaskXp(2, 2)).toBe(50);
  });

  test("prioridade baixa não adiciona bônus", () => {
    expect(calculateTaskXp(3, 1)).toBe(60);
  });

  test("prioridade alta adiciona 20 de bônus", () => {
    expect(calculateTaskXp(1, 3)).toBe(40);
  });

  test("rejeita dificuldade fora da faixa 1–5", () => {
    expect(() => calculateTaskXp(0, 2)).toThrow(RangeError);
    expect(() => calculateTaskXp(6, 2)).toThrow(RangeError);
  });

  test("rejeita prioridade fora da faixa 1–3", () => {
    expect(() => calculateTaskXp(2, 0)).toThrow(RangeError);
    expect(() => calculateTaskXp(2, 4)).toThrow(RangeError);
  });

  test("rejeita valores não inteiros", () => {
    expect(() => calculateTaskXp(2.5, 2)).toThrow(RangeError);
    expect(() => calculateTaskXp(2, 1.5)).toThrow(RangeError);
  });
});

describe("xpForLevel — XP total necessário: floor(100 * n^1.5)", () => {
  test("nível 0 começa em 0 XP", () => {
    expect(xpForLevel(0)).toBe(0);
  });

  test("níveis 1 a 5 nas bordas exatas da fórmula", () => {
    expect(xpForLevel(1)).toBe(100);
    expect(xpForLevel(2)).toBe(282);
    expect(xpForLevel(3)).toBe(519);
    expect(xpForLevel(4)).toBe(800);
    expect(xpForLevel(5)).toBe(1118);
  });

  test("rejeita nível negativo ou não inteiro", () => {
    expect(() => xpForLevel(-1)).toThrow(RangeError);
    expect(() => xpForLevel(1.5)).toThrow(RangeError);
  });
});

describe("levelFromXp — bordas", () => {
  test("0 XP é nível 0", () => {
    expect(levelFromXp(0)).toBe(0);
  });

  test("99 XP ainda é nível 0; 100 XP vira nível 1", () => {
    expect(levelFromXp(99)).toBe(0);
    expect(levelFromXp(100)).toBe(1);
    expect(levelFromXp(101)).toBe(1);
  });

  test("borda do nível 2 (282 XP)", () => {
    expect(levelFromXp(281)).toBe(1);
    expect(levelFromXp(282)).toBe(2);
  });

  test("bordas dos níveis 3, 4 e 5", () => {
    expect(levelFromXp(518)).toBe(2);
    expect(levelFromXp(519)).toBe(3);
    expect(levelFromXp(799)).toBe(3);
    expect(levelFromXp(800)).toBe(4);
    expect(levelFromXp(1117)).toBe(4);
    expect(levelFromXp(1118)).toBe(5);
  });

  test("XP negativo (reversões) e não-finito clampam para nível 0", () => {
    expect(levelFromXp(-50)).toBe(0);
    expect(levelFromXp(Number.NaN)).toBe(0);
  });

  test("consistência com xpForLevel em níveis altos", () => {
    for (const n of [10, 25, 60, 99]) {
      expect(levelFromXp(xpForLevel(n))).toBe(n);
      expect(levelFromXp(xpForLevel(n) - 1)).toBe(n - 1);
    }
  });

  test("é monotônica não-decrescente", () => {
    let previous = 0;
    for (let xp = 0; xp <= 2000; xp += 37) {
      const level = levelFromXp(xp);
      expect(level).toBeGreaterThanOrEqual(previous);
      previous = level;
    }
  });
});

describe("xpForLevel — patamar acima do nível 25", () => {
  test("até o patamar a curva é a original, degrau por degrau", () => {
    for (let level = 0; level <= LEVEL_SOFT_CAP; level++) {
      expect(xpForLevel(level)).toBe(legacyXpForLevel(level));
    }
  });

  test("a emenda não tem salto: o degrau cresce, não pula", () => {
    const before = xpForLevel(LEVEL_SOFT_CAP) - xpForLevel(LEVEL_SOFT_CAP - 1);
    const at = xpForLevel(LEVEL_SOFT_CAP + 1) - xpForLevel(LEVEL_SOFT_CAP);
    const after = xpForLevel(LEVEL_SOFT_CAP + 2) - xpForLevel(LEVEL_SOFT_CAP + 1);
    expect(before).toBe(743);
    expect(at).toBe(757);
    expect(after).toBe(847);
  });

  test("acima do patamar cada nível custa estritamente mais que o anterior", () => {
    for (let level = LEVEL_SOFT_CAP; level < 60; level++) {
      const step = xpForLevel(level + 1) - xpForLevel(level);
      const previousStep = xpForLevel(level) - xpForLevel(level - 1);
      expect(step).toBeGreaterThan(previousStep);
    }
  });

  test("o nível alto vira conquista: 40→41 custa muito mais que 20→21", () => {
    const early = xpForLevel(21) - xpForLevel(20);
    const late = xpForLevel(41) - xpForLevel(40);
    expect(early).toBe(679); // ~14 missões de 50 XP
    expect(late).toBeGreaterThan(early * 5); // ~83 missões
    // A curva antiga cobrava só 954 XP aqui — 19 missões, e o nível 40 não
    // significava nada de diferente do 20.
    expect(legacyXpForLevel(41) - legacyXpForLevel(40)).toBe(954);
  });

  test("nível 100 sai de 100 mil XP para um número inalcançável", () => {
    expect(legacyXpForLevel(100)).toBe(100_000);
    expect(xpForLevel(100)).toBeGreaterThan(10_000_000);
  });

  test("é monotônica e cabe em inteiro seguro mesmo em níveis absurdos", () => {
    let previous = -1;
    for (let level = 0; level <= 400; level++) {
      const value = xpForLevel(level);
      expect(Number.isSafeInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });
});

describe("levelFromXp — o patamar não mexe no nível de ninguém hoje", () => {
  test("abaixo de 14.029 XP o nível é idêntico ao da curva antiga", () => {
    // 14.029 é o primeiro XP em que as duas curvas discordam (~281 missões
    // de 50 XP). É a garantia de que a mudança não rebaixa ninguém que já
    // está na Guilda: abaixo disso, nem para cima nem para baixo.
    for (let xp = 0; xp < 14_029; xp++) {
      expect(levelFromXp(xp)).toBe(legacyLevelFromXp(xp));
    }
    expect(levelFromXp(14_029)).toBe(26);
    expect(legacyLevelFromXp(14_029)).toBe(27);
  });

  test("acima do patamar o nível fica menor, nunca maior", () => {
    for (const xp of [15_000, 20_000, 25_200, 50_400, 100_800]) {
      expect(levelFromXp(xp)).toBeLessThan(legacyLevelFromXp(xp));
    }
    expect(levelFromXp(100_800)).toBe(48);
    expect(legacyLevelFromXp(100_800)).toBe(100);
  });

  test("termina no teto mesmo com XP fora de qualquer faixa real", () => {
    // Sem o teto o laço não pararia: acima do nível ~281 a curva satura em
    // MAX_SAFE_INTEGER e todo nível seguinte passaria na condição.
    expect(levelFromXp(Number.MAX_SAFE_INTEGER)).toBe(MAX_LEVEL);
  });
});

describe("levelProgress — barra de progresso para o próximo nível", () => {
  test("na borda exata do nível o progresso é 0%", () => {
    const p = levelProgress(282);
    expect(p.level).toBe(2);
    expect(p.currentLevelXp).toBe(282);
    expect(p.nextLevelXp).toBe(519);
    expect(p.ratio).toBe(0);
  });

  test("no meio do caminho o progresso fica entre 0 e 1", () => {
    const p = levelProgress(400);
    expect(p.level).toBe(2);
    expect(p.ratio).toBeGreaterThan(0.4);
    expect(p.ratio).toBeLessThan(0.6);
  });

  test("com 0 XP mostra progresso até o nível 1", () => {
    const p = levelProgress(0);
    expect(p.level).toBe(0);
    expect(p.nextLevelXp).toBe(100);
    expect(p.ratio).toBe(0);
  });
});
