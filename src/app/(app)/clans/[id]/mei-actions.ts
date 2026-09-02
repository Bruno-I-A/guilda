"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { withOrgTx, type OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { MEI_DECLARATION_STATUSES } from "@/domain/mei-declaration";
import { canManageFiscalOperations } from "@/domain/guild-permissions";
import {
  err,
  requireMemberContext,
  type ActionResult,
} from "@/lib/action-context";
import { loadClanScopedFacts } from "@/lib/clans/facts";
import { lockActiveClansForMembershipRead } from "@/lib/clans/locks";
import { FISCAL_CLAN_SLUG } from "@/lib/clans/rules";

type MemberContext = {
  orgId: string;
  userId: string;
  role: Parameters<typeof loadClanScopedFacts>[4];
};

async function assertMeiManager(
  tx: OrgTx,
  ctx: MemberContext,
  clanId: string,
): Promise<ActionResult> {
  await lockActiveClansForMembershipRead(tx, ctx.orgId);
  const { clan, facts } = await loadClanScopedFacts(
    tx,
    ctx.orgId,
    clanId,
    ctx.userId,
    ctx.role,
  );
  if (!clan) return err("Clã não encontrado.");
  if (clan.slug !== FISCAL_CLAN_SLUG) {
    return err("O controle de MEI pertence ao clã Fiscal.");
  }
  if (!canManageFiscalOperations(facts)) {
    return err("Apenas integrantes do Fiscal ou um admin podem editar o controle MEI.");
  }
  return { ok: true };
}

const saveSchema = z
  .object({
    clanId: z.uuid("Clã inválido."),
    clientId: z.uuid("Empresa inválida."),
    year: z.number().int().min(2000).max(2100),
    status: z.enum(MEI_DECLARATION_STATUSES),
    submittedAt: z.string().trim().optional(),
    notes: z.string().trim().max(3000, "Observação muito longa.").optional(),
  })
  .superRefine((data, ctx) => {
    const hasValidDate = /^\d{4}-\d{2}-\d{2}$/.test(data.submittedAt ?? "");
    if (data.status === "submitted" && !hasValidDate) {
      ctx.addIssue({
        code: "custom",
        path: ["submittedAt"],
        message: "Informe a data de entrega da declaração.",
      });
    }
  });

export async function saveMeiDeclaration(
  input: z.input<typeof saveSchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const data = parsed.data;

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult> => {
    const authorization = await assertMeiManager(tx, ctx, data.clanId);
    if (!authorization.ok) return authorization;

    const [client] = await tx
      .select({ id: schema.clients.id })
      .from(schema.clients)
      .where(
        and(
          eq(schema.clients.orgId, ctx.orgId),
          eq(schema.clients.id, data.clientId),
          eq(schema.clients.active, true),
          eq(schema.clients.taxRegime, "mei"),
        ),
      )
      .for("update");
    if (!client) return err("Empresa MEI ativa não encontrada.");

    await tx
      .insert(schema.meiAnnualDeclarations)
      .values({
        orgId: ctx.orgId,
        clientId: client.id,
        year: data.year,
        status: data.status,
        submittedAt: data.status === "submitted" ? data.submittedAt : null,
        notes: data.notes || null,
        updatedBy: ctx.userId,
      })
      .onConflictDoUpdate({
        target: [
          schema.meiAnnualDeclarations.orgId,
          schema.meiAnnualDeclarations.clientId,
          schema.meiAnnualDeclarations.year,
        ],
        set: {
          status: data.status,
          submittedAt: data.status === "submitted" ? data.submittedAt : null,
          notes: data.notes || null,
          updatedBy: ctx.userId,
          updatedAt: new Date(),
        },
      });
    return { ok: true };
  });

  if (result.ok) revalidatePath(`/clans/${data.clanId}`);
  return result;
}
