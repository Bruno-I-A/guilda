import { describe, expect, test } from "vitest";

import { niceScale } from "./chart-scale";

describe("escala do eixo", () => {
  test("o zero entra mesmo quando todos os valores são positivos", () => {
    const escala = niceScale([3000, 5000]);
    expect(escala.min).toBe(0);
    expect(escala.ticks[0]).toBe(0);
    expect(escala.max).toBeGreaterThanOrEqual(5000);
  });

  test("valores negativos e positivos: passos redondos dos dois lados do zero", () => {
    expect(niceScale([-1200, 5000])).toEqual({
      min: -2000,
      max: 6000,
      ticks: [-2000, 0, 2000, 4000, 6000],
    });
  });

  test("só negativos: o zero fica no topo", () => {
    const escala = niceScale([-26169.21, -8875.37]);
    expect(escala.max).toBe(0);
    expect(escala.ticks.at(-1)).toBe(0);
    expect(escala.min).toBeLessThanOrEqual(-26169.21);
  });

  test("tudo zero não divide por zero", () => {
    expect(niceScale([0, 0]).ticks.length).toBeGreaterThan(1);
  });

  test("valores grandes continuam com poucas marcas", () => {
    const escala = niceScale([880000, 120000]);
    expect(escala.ticks.length).toBeLessThanOrEqual(6);
    expect(escala.max).toBeGreaterThanOrEqual(880000);
  });
});
