import { describe, expect, it } from "vitest";

import {
  dueDateLabel,
  isTelegramNotificationPayload,
  taskUrl,
} from "./notification-payload";

describe("payload de notificação do Telegram", () => {
  it("valida mensagens e botões com uma única ação", () => {
    expect(
      isTelegramNotificationPayload({
        version: 1,
        text: "Nova missão",
        preference: "tasks",
        keyboard: [[{ text: "Abrir", url: "https://guilda.test/tasks/1" }]],
      }),
    ).toBe(true);
    expect(
      isTelegramNotificationPayload({
        version: 1,
        text: "Inválido",
        preference: "tasks",
        keyboard: [[{ text: "Duas ações", url: "/x", callbackData: "x" }]],
      }),
    ).toBe(false);
  });

  it("mantém datas de prazo em UTC e monta URL absoluta", () => {
    expect(dueDateLabel(new Date("2026-08-12T12:00:00Z"))).toBe("12/08/2026");
    expect(taskUrl("abc", "https://guilda.test/base")).toBe(
      "https://guilda.test/tasks/abc",
    );
  });
});

