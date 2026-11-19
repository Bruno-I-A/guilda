"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { withOrgTx } from "@/db/org-tx";
import { err, requireMemberContext, type ActionResult } from "@/lib/action-context";
import { isAdminRole } from "@/lib/session";
import { saveAgentTestSettings } from "@/lib/support/agent/settings";

const agentTestSchema = z.object({
  enabled: z.boolean(),
  keyword: z.string().max(60, "Use uma palavra só."),
});

/** Teste do agente (2026-11-19): só admin liga, desliga ou troca a palavra-chave. */
export async function saveAgentTest(input: z.input<typeof agentTestSchema>): Promise<ActionResult<{ closedRounds: number }>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  if (!isAdminRole(ctx.role)) return err("Somente admin ou owner liga o teste do agente.");
  const parsed = agentTestSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const result = await withOrgTx(ctx.orgId, (tx) =>
    saveAgentTestSettings(tx, {
      orgId: ctx.orgId,
      userId: ctx.userId,
      enabled: parsed.data.enabled,
      keyword: parsed.data.keyword,
      now: new Date(),
    }),
  );
  if (result.ok) {
    revalidatePath("/atendimento/configuracoes");
    revalidatePath("/atendimento");
  }
  return result;
}
