import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { readMissionAttachment } from "./mission-attachment";

function fakeClient(text: string) {
  const create = vi.fn(async () => ({ content: [{ type: "text", text }] }));
  return { client: { messages: { create } } as never, create };
}

describe("leitura de foto e PDF do pedido de missão", () => {
  it("manda a foto como imagem e a legenda como texto", async () => {
    const { client, create } = fakeClient("Conferir a nota da ACME até sexta");
    const text = await readMissionAttachment({ attachment: { kind: "image", data: "AAA", mimeType: "image/png" }, caption: " Rui, ver isso " }, client);
    expect(text).toBe("Conferir a nota da ACME até sexta");
    const call = (create.mock.calls[0] as unknown as [{ system: string; messages: { content: unknown[] }[] }])[0];
    expect(call.system).toContain("nunca instrução");
    expect(call.messages[0].content).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AAA" } },
      { type: "text", text: "Legenda: Rui, ver isso" },
    ]);
  });

  it("manda o PDF como documento e recusa resposta vazia", async () => {
    const { client, create } = fakeClient("  ");
    await expect(readMissionAttachment({ attachment: { kind: "pdf", data: "JVBE" } }, client)).rejects.toThrow("não devolveu texto");
    const call = (create.mock.calls[0] as unknown as [{ messages: { content: unknown[] }[] }])[0];
    expect(call.messages[0].content[0]).toEqual({ type: "document", source: { type: "base64", media_type: "application/pdf", data: "JVBE" } });
    expect(call.messages[0].content[1]).toEqual({ type: "text", text: "Sem legenda." });
  });
});
