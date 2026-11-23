import { expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: {} }));

import { transcribeAudio } from "./transcription";

const audio = { bytes: new Uint8Array([1, 2]).buffer, mimeType: "audio/ogg", fileName: "audio.ogg" };
const config = { apiKey: "sk-segredo-que-nao-pode-vazar", model: "gpt-4o-mini-transcribe" };

test("erro da OpenAI vira mensagem com o status, sem a chave", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "Incorrect API key provided" } }), { status: 401 }));
  const error = await transcribeAudio(audio, config, fetchMock as unknown as typeof fetch).catch((reason: Error) => reason);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe("OpenAI 401: Incorrect API key provided");
  expect((error as Error).message).not.toContain(config.apiKey);
});

test("resposta sem texto não vira transcrição vazia", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: "   " }), { status: 200 }));
  await expect(transcribeAudio(audio, config, fetchMock as unknown as typeof fetch)).rejects.toThrow("sem texto");
});

test("a chave vai só no cabeçalho de autorização", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: "ok" }), { status: 200 }));
  await transcribeAudio(audio, config, fetchMock as unknown as typeof fetch);
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${config.apiKey}`);
});
