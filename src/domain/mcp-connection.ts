export type McpAgentKind = "codex" | "claude";

export const MCP_AGENT_LABELS: Record<McpAgentKind, string> = {
  codex: "Codex",
  claude: "Claude Code",
};

export function buildMcpConnectionCommand(input: {
  agent: McpAgentKind;
  endpoint: string;
}): string {
  const readToken = `$guildaToken = [System.Net.NetworkCredential]::new('', (Read-Host 'Cole a chave da Guilda' -AsSecureString)).Password`;

  if (input.agent === "claude") {
    return [
      readToken,
      `claude mcp add --transport http --scope user guilda ${input.endpoint} --header "Authorization: Bearer $guildaToken"`,
      "Remove-Variable guildaToken",
    ].join("\n");
  }

  return [
    readToken,
    "$env:GUILDA_MCP_TOKEN = $guildaToken",
    `[Environment]::SetEnvironmentVariable("GUILDA_MCP_TOKEN", $guildaToken, "User")`,
    `codex mcp add guilda --url ${input.endpoint} --bearer-token-env-var GUILDA_MCP_TOKEN`,
    "Remove-Variable guildaToken",
  ].join("\n");
}
