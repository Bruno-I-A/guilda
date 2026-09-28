import { describe, expect, it } from "vitest";

import { canProvisionMcpKey } from "./mcp-access";

describe("hierarquia das chaves MCP", () => {
  it("mantém owner como o nível máximo", () => {
    expect(canProvisionMcpKey({ creatorUserId: "owner", creatorRole: "owner", targetUserId: "admin", targetRole: "admin" })).toBe(true);
    expect(canProvisionMcpKey({ creatorUserId: "admin", creatorRole: "admin", targetUserId: "owner", targetRole: "owner" })).toBe(false);
  });

  it("admin provisiona membro, mas não outro admin", () => {
    expect(canProvisionMcpKey({ creatorUserId: "admin-1", creatorRole: "admin", targetUserId: "member", targetRole: "member" })).toBe(true);
    expect(canProvisionMcpKey({ creatorUserId: "admin-1", creatorRole: "admin", targetUserId: "admin-2", targetRole: "admin" })).toBe(false);
  });

  it("cada pessoa pode criar sua própria chave sem ganhar poder", () => {
    expect(canProvisionMcpKey({ creatorUserId: "member", creatorRole: "member", targetUserId: "member", targetRole: "member" })).toBe(true);
    expect(canProvisionMcpKey({ creatorUserId: "member", creatorRole: "member", targetUserId: "other", targetRole: "member" })).toBe(false);
  });
});
