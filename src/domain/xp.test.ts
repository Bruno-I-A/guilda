import { describe, expect, test } from "vitest";

import { calculateTaskXp } from "./xp";

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
