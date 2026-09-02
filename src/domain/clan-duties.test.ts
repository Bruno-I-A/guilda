import { describe, expect, test } from "vitest";

import {
  CLAN_DUTIES,
  CLAN_DUTY_DESCRIPTIONS,
  CLAN_DUTY_LABELS,
  findDutyHolder,
  isClanDuty,
} from "./clan-duties";

describe("vocabulário das atribuições", () => {
  test("toda atribuição tem rótulo e descrição", () => {
    for (const duty of CLAN_DUTIES) {
      expect(CLAN_DUTY_LABELS[duty]).toBeTruthy();
      expect(CLAN_DUTY_DESCRIPTIONS[duty]).toBeTruthy();
    }
  });

  test("os rótulos não se repetem entre atribuições", () => {
    const labels = CLAN_DUTIES.map((duty) => CLAN_DUTY_LABELS[duty]);
    expect(new Set(labels).size).toBe(labels.length);
  });

  test.each(CLAN_DUTIES)("%s é atribuição válida", (duty) => {
    expect(isClanDuty(duty)).toBe(true);
  });

  test.each([
    ["fiscal", "nome de clã não é atribuição"],
    ["", "string vazia"],
    ["COMPANY_FLOW", "maiúsculas não passam"],
  ])("%s é rejeitado (%s)", (value) => {
    expect(isClanDuty(value)).toBe(false);
  });

  test("valor que não é string é rejeitado sem lançar", () => {
    expect(isClanDuty(null)).toBe(false);
    expect(isClanDuty(undefined)).toBe(false);
    expect(isClanDuty(2)).toBe(false);
    expect(isClanDuty({ duty: "informative" })).toBe(false);
  });
});

describe("findDutyHolder", () => {
  const duties = [
    { duty: "company_flow" as const, userId: "u-societario" },
    { duty: "informative" as const, userId: "u-informativo" },
  ];

  test("encontra o responsável pela atribuição pedida", () => {
    expect(findDutyHolder(duties, "informative")?.userId).toBe("u-informativo");
    expect(findDutyHolder(duties, "company_flow")?.userId).toBe("u-societario");
  });

  test("ausência devolve null, e não erro — é estado normal", () => {
    expect(findDutyHolder([], "informative")).toBeNull();
    expect(
      findDutyHolder([{ duty: "company_flow", userId: "u-1" }], "informative"),
    ).toBeNull();
  });
});
