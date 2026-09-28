import { createMcpHandler } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db/org-tx", () => ({ withOrgTx: vi.fn() }));

import type { McpActor } from "@/lib/mcp/access";

import { createGuildaMcpServer } from "./server";

const actor: McpActor = {
  orgId: "org-test",
  organizationName: "Guilda Teste",
  userId: "user-owner",
  userName: "Bruno",
  role: "owner",
  agentKeyId: "00000000-0000-4000-8000-000000000001",
  agentName: "Codex",
  scopes: [],
};

let id = 0;

function handlerFor(currentActor = actor) {
  return createMcpHandler(() => createGuildaMcpServer(currentActor), { legacy: "stateless" });
}

async function rpc(method: string, params: Record<string, unknown> = {}, currentActor = actor) {
  const response = await handlerFor(currentActor).fetch(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    }),
    { authInfo: { token: "test", clientId: currentActor.agentKeyId, scopes: currentActor.scopes } },
  );
  expect(response.status).toBe(200);
  const body = response.headers.get("content-type")?.includes("text/event-stream")
    ? JSON.parse((await response.text()).split("\n").find((line) => line.startsWith("data: "))!.slice(6))
    : await response.json();
  if (body.error) throw new Error(JSON.stringify(body.error));
  return body.result;
}

describe("Guilda MCP", () => {
  it("publica somente as ferramentas operacionais previstas", async () => {
    const initialized = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "teste", version: "0" },
    });
    expect(initialized.serverInfo.name).toBe("guilda");
    expect(initialized.instructions).toContain("papel e os vínculos");

    const { tools } = await rpc("tools/list");
    expect(tools.map((tool: { name: string }) => tool.name).sort()).toEqual([
      "aprovar_missao",
      "buscar_empresas",
      "cancelar_missao",
      "concluir_missao",
      "contexto_da_guilda",
      "criar_missao",
      "detalhar_missao",
      "editar_missao",
      "entregar_missao",
      "iniciar_missao",
      "listar_clas",
      "listar_integrantes",
      "listar_missoes",
      "rejeitar_missao",
      "resumo_de_missoes",
      "transferir_missao",
    ]);
  });

  it("recusa chamada antes do banco quando a chave não tem o escopo", async () => {
    const result = await rpc("tools/call", {
      name: "listar_missoes",
      arguments: { scope: "minhas" },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("missions:read");
  });
});
