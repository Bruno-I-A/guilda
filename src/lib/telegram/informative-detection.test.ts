import { describe, expect, it } from "vitest";

import {
  isDetailedInformativeMessage,
} from "./informative-detection";

describe("isDetailedInformativeMessage", () => {
  it.each([
    "INFORMATIVO NOVO CLIENTE",
    "INFORMATIVO ALTERAÇÃO CLIENTE",
    "INFORMATIVO DE BAIXA DE CLIENTE",
    "[10:59] Eder: INFORMATIVO DE BAIXA DE CLIENTE\nBAIXA DE CLIENTE – código (487)",
  ])("reconhece %s", (text) => {
    expect(isDetailedInformativeMessage(text)).toBe(true);
  });

  it("distingue solicitação curta de informativo detalhado", () => {
    expect(
      isDetailedInformativeMessage(
        "A ALTA GENETICS mudou de endereço. Bruno deve alterar o alvará.",
      ),
    ).toBe(false);
  });
});
