import "server-only";

import { withOrgTx, type OrgTx } from "@/db/org-tx";
import { canManageFiscalOperations, isAdminRole } from "@/domain/guild-permissions";
import { err, requireMemberContext, type ActionResult } from "@/lib/action-context";
import { requireFiscalClan } from "./fiscal-clan";

export type MemberContext = Extract<Awaited<ReturnType<typeof requireMemberContext>>, { ok: true }>;

/** Sessao, cla Fiscal e permissao operacional conferidos na mesma transacao. */
export async function asFiscalOperator<T>(
  clanId: string,
  run: (tx: OrgTx, ctx: MemberContext) => Promise<ActionResult<T>>,
  options: { adminOnly?: boolean } = {},
): Promise<ActionResult<T>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  if (options.adminOnly && !isAdminRole(ctx.role)) return err("Só admins configuram o modelo da nota.");
  return withOrgTx(ctx.orgId, async (tx) => {
    const fiscal = await requireFiscalClan(tx, { orgId: ctx.orgId, clanId, userId: ctx.userId, role: ctx.role });
    if (!fiscal) return err("Clã Fiscal não encontrado.");
    if (!canManageFiscalOperations(fiscal.facts)) return err("Apenas integrantes do Fiscal ou um admin podem operar as notas.");
    return run(tx, ctx);
  });
}
