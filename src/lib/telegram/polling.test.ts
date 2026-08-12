// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  deleteTelegramCommands,
  disableTelegramWebhook,
  getTelegramUpdates,
} from "./polling";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("recepção Telegram por long polling", () => {
  it("remove o webhook anterior sem descartar updates pendentes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await disableTelegramWebhook("123:token");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/deleteWebhook");
    expect(JSON.parse(String(init.body))).toEqual({ drop_pending_updates: false });
  });

  it("remove o menu legado de comandos", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await deleteTelegramCommands("123:token");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/deleteMyCommands");
    expect(JSON.parse(String(init.body))).toEqual({});
  });

  it("busca apenas mensagens e callbacks a partir do offset", async () => {
    const update = { update_id: 42, message: { chat: { id: 1, type: "private" } } };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: [update] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getTelegramUpdates("123:token", 40, 0)).resolves.toEqual([update]);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      offset: 40,
      timeout: 0,
      allowed_updates: ["message", "callback_query"],
    });
  });

  it("recusa respostas inválidas e preserva o erro da Bot API", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, result: [{ update_id: "inválido" }] })),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: false, description: "Conflict: webhook ativo" }),
          { status: 409 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getTelegramUpdates("123:token", undefined, 0)).rejects.toThrow(
      "lote de updates inválido",
    );
    await expect(getTelegramUpdates("123:token", undefined, 0)).rejects.toThrow(
      "Conflict: webhook ativo",
    );
  });
});
