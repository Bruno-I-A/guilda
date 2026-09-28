export type McpAgentKind = "codex" | "claude";

export const MCP_AGENT_LABELS: Record<McpAgentKind, string> = {
  codex: "Codex",
  claude: "Claude Code",
};

export function buildMcpConnectionCommand(input: {
  agent: McpAgentKind;
  endpoint: string;
  token: string;
}): string {
  if (input.agent === "claude") {
    return `claude mcp add --transport http --scope user --header "Authorization: Bearer ${input.token}" guilda ${input.endpoint}`;
  }

  return [
    `$env:GUILDA_MCP_TOKEN = "${input.token}"`,
    `[Environment]::SetEnvironmentVariable("GUILDA_MCP_TOKEN", "${input.token}", "User")`,
    `codex mcp add guilda --url ${input.endpoint} --bearer-token-env-var GUILDA_MCP_TOKEN`,
  ].join("\n");
}
