import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { shouldNotifyTaskCreation } from "./create";

describe("notificação da criação de missão", () => {
  test("não repete no Telegram as missões geradas por Informativo", () => {
    expect(shouldNotifyTaskCreation("informativo-1")).toBe(false);
  });

  test("mantém o aviso para os demais tipos de missão", () => {
    expect(shouldNotifyTaskCreation(null)).toBe(true);
    expect(shouldNotifyTaskCreation(undefined)).toBe(true);
  });
});
