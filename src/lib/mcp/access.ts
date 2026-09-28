import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { canProvisionMcpKey, MCP_SCOPES, type McpScope } from "@/domain/mcp-access";
import type { OrgRole } from "@/domain/task-state";

export { MCP_SCOPES, type McpScope } from "@/domain/mcp-access";

export interface McpActor {
  orgId: string;
  organizationName: string;
  userId: string;
  userName: string;
  role: OrgRole;
  agentKeyId: string;
  agentName: string;
  scopes: McpScope[];
}

const roleSchema = z.enum(["owner", "admin", "member"]);
const scopeSchema = z.enum(MCP_SCOPES);
const keyNameSchema = z.string().trim().min(2).max(80);
const tokenPrefix = "gld_";

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function encodeOrgId(orgId: string): string {
  return Buffer.from(orgId, "utf8").toString("base64url");
}

function decodeOrgId(value: string): string | null {
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    return decoded.length > 0 && decoded.length <= 200 ? decoded : null;
  } catch {
    return null;
  }
}

function parseToken(token: string): { orgId: string; keyId: string } | null {
  if (!token.startsWith(tokenPrefix) || token.length > 600) return null;
  const [encodedOrg, keyId, secret, ...rest] = token.slice(tokenPrefix.length).split(".");
  if (!encodedOrg || !z.uuid().safeParse(keyId).success || !secret || rest.length > 0) {
    return null;
  }
  const orgId = decodeOrgId(encodedOrg);
  if (!orgId) return null;
  return { orgId, keyId };
}

function equalHash(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function authenticateMcpToken(token: string): Promise<McpActor | null> {
  const parsed = parseToken(token);
  if (!parsed) return null;
  const suppliedHash = tokenHash(token);

  return withOrgTx(parsed.orgId, async (tx) => {
    const [record] = await tx
      .select({
        keyId: schema.mcpAgentKeys.id,
        tokenHash: schema.mcpAgentKeys.tokenHash,
        agentName: schema.mcpAgentKeys.name,
        scopes: schema.mcpAgentKeys.scopes,
        orgId: schema.mcpAgentKeys.organizationId,
        organizationName: schema.organization.name,
        userId: schema.mcpAgentKeys.userId,
        userName: schema.user.name,
        role: schema.member.role,
        mustChangePassword: schema.user.mustChangePassword,
      })
      .from(schema.mcpAgentKeys)
      .innerJoin(
        schema.organization,
        eq(schema.organization.id, schema.mcpAgentKeys.organizationId),
      )
      .innerJoin(
        schema.member,
        and(
          eq(schema.member.organizationId, schema.mcpAgentKeys.organizationId),
          eq(schema.member.userId, schema.mcpAgentKeys.userId),
        ),
      )
      .innerJoin(schema.user, eq(schema.user.id, schema.mcpAgentKeys.userId))
      .where(
        and(
          eq(schema.mcpAgentKeys.id, parsed.keyId),
          eq(schema.mcpAgentKeys.organizationId, parsed.orgId),
          isNull(schema.mcpAgentKeys.revokedAt),
        ),
      )
      .limit(1);

    const role = roleSchema.safeParse(record?.role);
    const scopes = z.array(scopeSchema).safeParse(record?.scopes);
    if (
      !record ||
      record.mustChangePassword ||
      !role.success ||
      !scopes.success ||
      !equalHash(suppliedHash, record.tokenHash)
    ) {
      return null;
    }

    await tx
      .update(schema.mcpAgentKeys)
      .set({ lastUsedAt: new Date() })
      .where(
        and(
          eq(schema.mcpAgentKeys.id, record.keyId),
          eq(schema.mcpAgentKeys.organizationId, record.orgId),
        ),
      );

    return {
      orgId: record.orgId,
      organizationName: record.organizationName,
      userId: record.userId,
      userName: record.userName,
      role: role.data,
      agentKeyId: record.keyId,
      agentName: record.agentName,
      scopes: scopes.data,
    };
  });
}

export function hasMcpScope(actor: McpActor, scope: McpScope): boolean {
  return actor.scopes.includes(scope);
}

export async function createMcpAgentKey(input: {
  orgId: string;
  creatorUserId: string;
  creatorRole: OrgRole;
  targetUserId: string;
  name: string;
  scopes: McpScope[];
}): Promise<{ token: string; keyId: string; lastFour: string }> {
  const name = keyNameSchema.parse(input.name);
  const scopes = z.array(scopeSchema).min(1).parse([...new Set(input.scopes)]);

  return withOrgTx(input.orgId, async (tx) => {
    const [target] = await tx
      .select({ userId: schema.member.userId, role: schema.member.role })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, input.orgId),
          eq(schema.member.userId, input.targetUserId),
        ),
      )
      .limit(1);
    const targetRole = roleSchema.safeParse(target?.role);
    if (!target || !targetRole.success) {
      throw new Error("Membro da organização não encontrado.");
    }
    if (!canProvisionMcpKey({
      creatorUserId: input.creatorUserId,
      creatorRole: input.creatorRole,
      targetUserId: target.userId,
      targetRole: targetRole.data,
    })) {
      throw new Error("Seu papel não permite criar uma chave para esta pessoa.");
    }

    const keyId = crypto.randomUUID();
    const secret = randomBytes(32).toString("base64url");
    const token = `${tokenPrefix}${encodeOrgId(input.orgId)}.${keyId}.${secret}`;
    await tx.insert(schema.mcpAgentKeys).values({
      id: keyId,
      organizationId: input.orgId,
      userId: target.userId,
      name,
      tokenHash: tokenHash(token),
      tokenLastFour: token.slice(-4),
      scopes,
      createdBy: input.creatorUserId,
    });
    return { token, keyId, lastFour: token.slice(-4) };
  });
}

export async function listMcpAgentKeys(orgId: string, userId?: string) {
  return withOrgTx(orgId, (tx) =>
    tx
      .select({
        id: schema.mcpAgentKeys.id,
        name: schema.mcpAgentKeys.name,
        userId: schema.mcpAgentKeys.userId,
        userName: schema.user.name,
        lastFour: schema.mcpAgentKeys.tokenLastFour,
        scopes: schema.mcpAgentKeys.scopes,
        createdAt: schema.mcpAgentKeys.createdAt,
        lastUsedAt: schema.mcpAgentKeys.lastUsedAt,
        revokedAt: schema.mcpAgentKeys.revokedAt,
      })
      .from(schema.mcpAgentKeys)
      .innerJoin(schema.user, eq(schema.user.id, schema.mcpAgentKeys.userId))
      .where(
        userId
          ? and(
              eq(schema.mcpAgentKeys.organizationId, orgId),
              eq(schema.mcpAgentKeys.userId, userId),
            )
          : eq(schema.mcpAgentKeys.organizationId, orgId),
      )
      .orderBy(desc(schema.mcpAgentKeys.createdAt)),
  );
}

export async function revokeMcpAgentKey(input: {
  orgId: string;
  actorUserId: string;
  actorRole: OrgRole;
  keyId: string;
}): Promise<boolean> {
  return withOrgTx(input.orgId, async (tx) => {
    const [key] = await tx
      .select({ id: schema.mcpAgentKeys.id, userId: schema.mcpAgentKeys.userId, role: schema.member.role })
      .from(schema.mcpAgentKeys)
      .innerJoin(
        schema.member,
        and(
          eq(schema.member.organizationId, schema.mcpAgentKeys.organizationId),
          eq(schema.member.userId, schema.mcpAgentKeys.userId),
        ),
      )
      .where(
        and(
          eq(schema.mcpAgentKeys.organizationId, input.orgId),
          eq(schema.mcpAgentKeys.id, input.keyId),
        ),
      )
      .limit(1);
    if (!key) return false;
    const targetRole = roleSchema.safeParse(key.role);
    if (!targetRole.success || !canProvisionMcpKey({
      creatorUserId: input.actorUserId,
      creatorRole: input.actorRole,
      targetUserId: key.userId,
      targetRole: targetRole.data,
    })) {
      throw new Error("Seu papel não permite revogar a chave desta pessoa.");
    }
    await tx
      .update(schema.mcpAgentKeys)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.mcpAgentKeys.organizationId, input.orgId),
          eq(schema.mcpAgentKeys.id, input.keyId),
          isNull(schema.mcpAgentKeys.revokedAt),
        ),
      );
    return true;
  });
}
