"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { withOrgTx } from "@/db/org-tx";
import { AGENT_MODES } from "@/domain/support-agent";
import { err, requireMemberContext, type ActionResult } from "@/lib/action-context";
import { isAdminRole } from "@/lib/session";
import { saveAgentSettings } from "@/lib/support/agent/settings";

const agentSchema = z.object({
  mode: z.enum(AGENT_MODES),
  keyword: z.string().max(60, "Use uma palavra só."),
});

/** Modo do agente (2026-11-23): só admin liga, desliga ou troca a palavra-chave. */
export async function saveAgentMode(input: z.input<typeof agentSchema>): Promise<ActionResult<{ closedRounds: number }>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  if (!isAdminRole(ctx.role)) return err("Somente admin ou owner muda o agente de IA.");
  const parsed = agentSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const result = await withOrgTx(ctx.orgId, (tx) =>
    saveAgentSettings(tx, {
      orgId: ctx.orgId,
      userId: ctx.userId,
      mode: parsed.data.mode,
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
