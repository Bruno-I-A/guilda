import { describe, expect, test } from "vitest";

import { parseMeiDeclarationYear } from "./mei-declaration";

describe("ano-calendário do controle MEI", () => {
  test("aceita somente anos inteiros dentro do intervalo operacional", () => {
    expect(parseMeiDeclarationYear("2025", 2024)).toBe(2025);
    expect(parseMeiDeclarationYear("1999", 2024)).toBe(2024);
    expect(parseMeiDeclarationYear("2025.5", 2024)).toBe(2024);
    expect(parseMeiDeclarationYear(undefined, 2024)).toBe(2024);
  });
});
