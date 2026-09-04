import { describe, expect, it } from "vitest";

import { reconcileClosingYearXp } from "./closing-year-xp";
import { CLOSING_YEAR_XP } from "./xp";

const AWARD = CLOSING_YEAR_XP;

describe("reconcileClosingYearXp", () => {
  it("credita quem fecha o ano pela primeira vez", () => {
    expect(
      reconcileClosingYearXp({ holders: [], closedBy: "ana", award: AWARD }),
    ).toEqual([
      { userId: "ana", amount: AWARD, reason: "closing_year_closed" },
    ]);
  });

  it("estorna o crédito quando o ano é reaberto", () => {
    expect(
      reconcileClosingYearXp({
        holders: [{ userId: "ana", net: AWARD }],
        closedBy: null,
        award: AWARD,
      }),
    ).toEqual([
      { userId: "ana", amount: -AWARD, reason: "closing_year_reversal" },
    ]);
  });

  it("não lança nada quando quem reconclui é o mesmo dono", () => {
    expect(
      reconcileClosingYearXp({
        holders: [{ userId: "ana", net: AWARD }],
        closedBy: "ana",
        award: AWARD,
      }),
    ).toEqual([]);
  });

  it("estorna o dono anterior e credita o novo na mesma passada", () => {
    expect(
      reconcileClosingYearXp({
        holders: [{ userId: "ana", net: AWARD }],
        closedBy: "bruno",
        award: AWARD,
      }),
    ).toEqual([
      { userId: "ana", amount: -AWARD, reason: "closing_year_reversal" },
      { userId: "bruno", amount: AWARD, reason: "closing_year_closed" },
    ]);
  });

  it("repassa o XP quando a reabertura promove a missão substituta", () => {
    // Ana fechou, reabriu e o ano ficou com a conclusão do Bruno: o ledger já
    // tem o estorno da Ana, então só falta o crédito de quem assumiu.
    expect(
      reconcileClosingYearXp({
        holders: [
          { userId: "ana", net: 0 },
          { userId: "bruno", net: 0 },
        ],
        closedBy: "bruno",
        award: AWARD,
      }),
    ).toEqual([
      { userId: "bruno", amount: AWARD, reason: "closing_year_closed" },
    ]);
  });

  it("é idempotente: rodar de novo sobre o mesmo estado não lança nada", () => {
    const state = {
      holders: [
        { userId: "ana", net: 0 },
        { userId: "bruno", net: AWARD },
      ],
      closedBy: "bruno",
      award: AWARD,
    } as const;
    expect(reconcileClosingYearXp(state)).toEqual([]);
    expect(reconcileClosingYearXp(state)).toEqual([]);
  });

  it("não estorna de novo quem já teve o saldo zerado", () => {
    expect(
      reconcileClosingYearXp({
        holders: [{ userId: "ana", net: 0 }],
        closedBy: null,
        award: AWARD,
      }),
    ).toEqual([]);
  });

  it("estorna todo mundo que sobrou quando o ano volta a ficar aberto", () => {
    expect(
      reconcileClosingYearXp({
        holders: [
          { userId: "ana", net: AWARD },
          { userId: "bruno", net: 0 },
          { userId: "carla", net: AWARD },
        ],
        closedBy: null,
        award: AWARD,
      }),
    ).toEqual([
      { userId: "ana", amount: -AWARD, reason: "closing_year_reversal" },
      { userId: "carla", amount: -AWARD, reason: "closing_year_reversal" },
    ]);
  });

  it("ajusta só a diferença quando o dono tem saldo parcial", () => {
    expect(
      reconcileClosingYearXp({
        holders: [{ userId: "ana", net: 5 }],
        closedBy: "ana",
        award: AWARD,
      }),
    ).toEqual([
      { userId: "ana", amount: AWARD - 5, reason: "closing_year_closed" },
    ]);
  });

  it("marca como estorno o acerto que TIRA XP do dono", () => {
    expect(
      reconcileClosingYearXp({
        holders: [{ userId: "ana", net: AWARD + 10 }],
        closedBy: "ana",
        award: AWARD,
      }),
    ).toEqual([
      { userId: "ana", amount: -10, reason: "closing_year_reversal" },
    ]);
  });
});
