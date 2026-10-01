import { describe, expect, test } from "vitest";

import {
  DRAW_LANDING_DELAY_MS,
  DRAW_ROLL_DELAYS_MS,
  isClosingDrawEligible,
  pickClosingDraw,
} from "./closing-draw";

const intocada = { yearClosed: false, periodCount: 0, observationCount: 0 };

describe("quem entra no sorteio", () => {
  test("empresa que ninguém tocou no ano entra", () => {
    expect(isClosingDrawEligible(intocada)).toBe(true);
  });

  test("período só pendente já tira do sorteio — alguém começou", () => {
    expect(isClosingDrawEligible({ ...intocada, periodCount: 1 })).toBe(false);
  });

  test("observação tira do sorteio, mesmo resolvida", () => {
    expect(isClosingDrawEligible({ ...intocada, observationCount: 1 })).toBe(false);
  });

  test("ano encerrado sem período lançado não entra", () => {
    expect(isClosingDrawEligible({ ...intocada, yearClosed: true })).toBe(false);
  });
});

describe("a escolha", () => {
  const pool = [{ id: "a" }, { id: "b" }, { id: "c" }];

  test("segue o número sorteado do começo ao fim da lista", () => {
    expect(pickClosingDraw(pool, null, () => 0)?.id).toBe("a");
    expect(pickClosingDraw(pool, null, () => 0.5)?.id).toBe("b");
    expect(pickClosingDraw(pool, null, () => 0.9999)?.id).toBe("c");
  });

  test("rolar de novo nunca repete a última quando há alternativa", () => {
    for (const r of [0, 0.34, 0.5, 0.67, 0.9999]) {
      expect(pickClosingDraw(pool, "b", () => r)?.id).not.toBe("b");
    }
  });

  test("com uma empresa só, ela volta mesmo sendo a última", () => {
    expect(pickClosingDraw([{ id: "a" }], "a", () => 0.7)?.id).toBe("a");
  });

  test("sem empresa no sorteio, não há escolha", () => {
    expect(pickClosingDraw([], null, () => 0.3)).toBeNull();
  });

  test("número fora do contrato não estoura a lista", () => {
    expect(pickClosingDraw(pool, null, () => 1)?.id).toBe("c");
    expect(pickClosingDraw(pool, null, () => -0.2)?.id).toBe("a");
  });
});

describe("ritmo da rolagem", () => {
  test("desacelera: cada troca demora pelo menos o mesmo que a anterior", () => {
    for (let i = 1; i < DRAW_ROLL_DELAYS_MS.length; i += 1) {
      expect(DRAW_ROLL_DELAYS_MS[i]).toBeGreaterThanOrEqual(DRAW_ROLL_DELAYS_MS[i - 1]);
    }
  });

  test("dura perto de um segundo, sem virar espera", () => {
    const total =
      DRAW_ROLL_DELAYS_MS.reduce((soma, atraso) => soma + atraso, 0) + DRAW_LANDING_DELAY_MS;
    expect(total).toBeGreaterThanOrEqual(900);
    expect(total).toBeLessThanOrEqual(1600);
  });
});
