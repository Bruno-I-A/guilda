import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { extractInformative } from "./informative";

const previousKey = process.env.ANTHROPIC_API_KEY;
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = previousKey;
});

/** Guarda o system prompt enviado e devolve uma extração mínima. */
async function systemPromptFor(explicitRequest: boolean): Promise<string> {
  process.env.ANTHROPIC_API_KEY = "sk-ant-teste";
  let system = "";
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    system = JSON.stringify(JSON.parse(String(init?.body ?? "{}")).system);
    const data = {
      isMissionRequest: true, kind: "general_task",
      company: { systemCode: null, legalName: null, cnpj: null, taxRegime: null, city: null, contact: null, summary: null },
      tasks: [{ category: "general", title: "Jogar padel", description: "Jogar padel na sexta.", priority: 2, difficulty: 1, dueDate: null, closingYear: null, sourceSection: "padel", sector: null, assignees: ["Rafa"] }],
      ignoredNotes: [], warnings: [], missingFields: [], fiscalNote: null, commitments: [],
    };
    return new Response(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "x", stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: JSON.stringify(data) }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  await extractInformative("Missão para o Rafa, ir jogar um padel na sexta de noite", [{ userId: "r", name: "Rafael" }], [], [], "org:u", false, explicitRequest);
  return system;
}

describe("pedido explícito pelo WhatsApp", () => {
  it("manda a regra que conta toda atividade pedida como missão", async () => {
    expect(await systemPromptFor(true)).toContain("PEDIDO EXPLÍCITO DE MISSÃO");
  });

  it("o painel e o MCP continuam sem a regra", async () => {
    expect(await systemPromptFor(false)).not.toContain("PEDIDO EXPLÍCITO DE MISSÃO");
  });
});
