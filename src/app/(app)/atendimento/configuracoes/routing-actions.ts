"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { withOrgTx } from "@/db/org-tx";
import { err, requireMemberContext, type ActionResult } from "@/lib/action-context";
import { isAdminRole } from "@/lib/session";
import { ROUTING_TOPICS_MAX, saveClanRoutingTopics } from "@/lib/support/agent/routing";

const topics = z.string().max(ROUTING_TOPICS_MAX, `Use até ${ROUTING_TOPICS_MAX} caracteres por pessoa.`);
const routingSchema = z.object({
  clanId: z.uuid("Clã inválido."),
  people: z.array(z.object({ userId: z.string().min(1).max(100), topics })).max(200),
  portfolioTopics: topics,
});

/** Encaminhamento por assunto (2026-11-20): só admin escreve quem atende cada assunto. */
export async function saveClanRouting(input: z.input<typeof routingSchema>): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  if (!isAdminRole(ctx.role)) return err("Somente admin ou owner define quem atende cada assunto.");
  const parsed = routingSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const result = await withOrgTx(ctx.orgId, (tx) =>
    saveClanRoutingTopics(tx, { orgId: ctx.orgId, actorId: ctx.userId, ...parsed.data, now: new Date() }),
  );
  if (result.ok) revalidatePath("/atendimento/configuracoes");
  return result;
}
