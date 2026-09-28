import { describe, expect, it } from "vitest";

import { buildMcpConnectionCommand } from "./mcp-connection";

const endpoint = "https://guilda.example/api/mcp";

describe("comandos de conexão MCP", () => {
  it("prepara o Codex com token persistente no Windows", () => {
    const command = buildMcpConnectionCommand({ agent: "codex", endpoint });

    expect(command).toContain("Read-Host 'Cole a chave da Guilda' -AsSecureString");
    expect(command).toContain("SetEnvironmentVariable");
    expect(command).toContain(
      `codex mcp add guilda --url ${endpoint} --bearer-token-env-var GUILDA_MCP_TOKEN`,
    );
  });

  it("prepara o Claude Code com transporte HTTP e escopo do usuário", () => {
    const command = buildMcpConnectionCommand({ agent: "claude", endpoint });

    expect(command).toContain("Read-Host 'Cole a chave da Guilda' -AsSecureString");
    expect(command).toContain(
      `claude mcp add --transport http --scope user guilda ${endpoint} --header "Authorization: Bearer $guildaToken"`,
    );
    expect(command.indexOf(endpoint)).toBeLessThan(command.indexOf("--header"));
  });

  it("não incorpora a chave no comando copiável", () => {
    const command = buildMcpConnectionCommand({ agent: "codex", endpoint });

    expect(command).not.toContain("guilda_mcp_");
  });
});
