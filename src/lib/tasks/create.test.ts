import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { shouldNotifyTaskCreation } from "./create";

describe("notificação da criação de missão", () => {
  test("missão de Informativo não avisa uma a uma (a confirmação agrupa)", () => {
    expect(shouldNotifyTaskCreation("informativo-1")).toBe(false);
  });

  test("mantém o aviso para os demais tipos de missão", () => {
    expect(shouldNotifyTaskCreation(null)).toBe(true);
    expect(shouldNotifyTaskCreation(undefined)).toBe(true);
  });
});
