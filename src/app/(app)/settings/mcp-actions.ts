"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireMemberContext, type ActionResult, err } from "@/lib/action-context";
import {
  createMcpAgentKey,
  MCP_SCOPES,
  revokeMcpAgentKey,
  type McpScope,
} from "@/lib/mcp/access";

const createSchema = z.object({
  name: z.string().trim().min(2, "Dê um nome para a conexão.").max(80),
  targetUserId: z.string().min(1),
  scopes: z.array(z.enum(MCP_SCOPES)).min(1, "Escolha ao menos uma permissão."),
});

export async function createMcpKeyAction(input: {
  name: string;
  targetUserId: string;
  scopes: McpScope[];
}): Promise<ActionResult<{ token: string }>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  try {
    const key = await createMcpAgentKey({
      orgId: ctx.orgId,
      creatorUserId: ctx.userId,
      creatorRole: ctx.role,
      targetUserId: parsed.data.targetUserId,
      name: parsed.data.name,
      scopes: parsed.data.scopes,
    });
    revalidatePath("/settings");
    return { ok: true, data: { token: key.token } };
  } catch (error) {
    return err(error instanceof Error ? error.message : "Não foi possível gerar a chave.");
  }
}

export async function revokeMcpKeyAction(input: { keyId: string }): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsed = z.object({ keyId: z.uuid() }).safeParse(input);
  if (!parsed.success) return err("Chave inválida.");
  try {
    const found = await revokeMcpAgentKey({
      orgId: ctx.orgId,
      actorUserId: ctx.userId,
      actorRole: ctx.role,
      keyId: parsed.data.keyId,
    });
    if (!found) return err("Chave não encontrada.");
    revalidatePath("/settings");
    return { ok: true };
  } catch (error) {
    return err(error instanceof Error ? error.message : "Não foi possível revogar a chave.");
  }
}
