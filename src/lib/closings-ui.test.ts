import { describe, expect, it } from "vitest";

import { isClosingOverdue } from "./closings-ui";

describe("isClosingOverdue", () => {
  it("identifica fechamento pendente com prazo vencido", () => {
    expect(isClosingOverdue("2026-05-29", "pending", "2026-05-30")).toBe(true);
  });

  it("não considera concluído como atrasado", () => {
    expect(isClosingOverdue("2026-05-29", "completed", "2026-05-30")).toBe(false);
  });

  it("mantém o fechamento do dia dentro do prazo", () => {
    expect(isClosingOverdue("2026-05-30", "blocked", "2026-05-30")).toBe(false);
  });
});
