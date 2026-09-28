export const MCP_SCOPES = [
  "missions:read",
  "directory:read",
  "missions:create",
  "missions:write",
  "missions:assign",
  "missions:review",
  "missions:cancel",
] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

export type McpProvisionRole = "owner" | "admin" | "member";

/**
 * A pessoa nunca pode emitir uma chave que represente alguém acima dela.
 * Owner é o único nível que pode provisionar qualquer membro da organização.
 */
export function canProvisionMcpKey(input: {
  creatorUserId: string;
  creatorRole: McpProvisionRole;
  targetUserId: string;
  targetRole: McpProvisionRole;
}): boolean {
  if (input.creatorRole === "owner") return true;
  if (input.creatorUserId === input.targetUserId) return true;
  return input.creatorRole === "admin" && input.targetRole === "member";
}
