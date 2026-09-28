import { describe, expect, it } from "vitest";

import { buildMcpConnectionCommand } from "./mcp-connection";

const endpoint = "https://guilda.example/api/mcp";
const token = "guilda_mcp_org.key.secret";

describe("comandos de conexão MCP", () => {
  it("prepara o Codex com token persistente no Windows", () => {
    const command = buildMcpConnectionCommand({ agent: "codex", endpoint, token });

    expect(command).toContain(`$env:GUILDA_MCP_TOKEN = "${token}"`);
    expect(command).toContain("SetEnvironmentVariable");
    expect(command).toContain(
      `codex mcp add guilda --url ${endpoint} --bearer-token-env-var GUILDA_MCP_TOKEN`,
    );
  });

  it("prepara o Claude Code com transporte HTTP e escopo do usuário", () => {
    expect(buildMcpConnectionCommand({ agent: "claude", endpoint, token })).toBe(
      `claude mcp add --transport http --scope user --header "Authorization: Bearer ${token}" guilda ${endpoint}`,
    );
  });
});
