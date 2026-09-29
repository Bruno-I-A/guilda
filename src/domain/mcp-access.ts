export const MCP_SCOPES = [
  "missions:read",
  "directory:read",
  "missions:create",
  "missions:write",
  "missions:assign",
  "missions:review",
  "missions:cancel",
  "closings:read",
  "closings:write",
  "informatives:read",
  "informatives:write",
  "mural:read",
  "mural:write",
] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

type McpMissionStatus =
  | "pending"
  | "in_progress"
  | "awaiting_approval"
  | "completed"
  | "rejected"
  | "cancelled";

/**
 * O DTO anuncia somente transições para as quais existe uma ferramenta MCP.
 * A máquina de estados também conhece a janela de desfazer conclusão, mas a
 * primeira versão do MCP não expõe esse comando.
 */
export function mcpMissionTransitionTargets(
  current: McpMissionStatus,
): McpMissionStatus[] {
  if (current === "pending") return ["in_progress", "cancelled"];
  if (current === "in_progress") return ["awaiting_approval", "completed", "cancelled"];
  if (current === "awaiting_approval") return ["completed", "rejected", "cancelled"];
  if (current === "rejected") return ["in_progress", "cancelled"];
  return [];
}

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
