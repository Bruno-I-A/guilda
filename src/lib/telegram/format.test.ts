import { describe, expect, it } from "vitest";

import {
  formatTelegramDate,
  joinTelegramLines,
  truncateTelegramText,
} from "./format";

describe("truncateTelegramText", () => {
  it("mantém mensagens dentro do limite", () => {
    expect(truncateTelegramText("missão", 10)).toBe("missão");
  });

  it("não divide emoji e reserva espaço para reticências", () => {
    expect(truncateTelegramText("ab🛡️cd", 5)).toBe("ab🛡️…");
  });

  it("rejeita limite inválido", () => {
    expect(() => truncateTelegramText("x", 0)).toThrow("Limite");
  });
});

describe("joinTelegramLines", () => {
  it("ignora blocos opcionais ausentes", () => {
    expect(joinTelegramLines(["Título", null, false, "Detalhe"])).toBe(
      "Título\nDetalhe",
    );
  });
});

describe("formatTelegramDate", () => {
  it("formata a data no fuso informado", () => {
    expect(
      formatTelegramDate(new Date("2026-08-12T02:30:00Z"), "America/Sao_Paulo"),
    ).toBe("11/08/2026");
  });
});
