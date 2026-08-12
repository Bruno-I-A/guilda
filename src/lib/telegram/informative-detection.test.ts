import { describe, expect, it } from "vitest";

import { isClientInformative } from "./informative-detection";

describe("isClientInformative", () => {
  it.each([
    "INFORMATIVO NOVO CLIENTE",
    "INFORMATIVO ALTERAÇÃO CLIENTE",
    "INFORMATIVO DE BAIXA DE CLIENTE",
    "[10:59] Eder: INFORMATIVO DE BAIXA DE CLIENTE\nBAIXA DE CLIENTE – código (487)",
  ])("reconhece %s", (text) => {
    expect(isClientInformative(text)).toBe(true);
  });

  it("não envia conversa comum para classificação", () => {
    expect(isClientInformative("Bom dia, quais são minhas tarefas?")).toBe(false);
  });
});
