"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { type OrgTx, withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import {
  canDeleteClanClosing,
  canManageClanClosings,
  type ClosingActorFacts,
} from "@/domain/guild-permissions";
import { CLOSING_YEAR_XP } from "@/domain/xp";
import {
  err,
  requireMemberContext,
  type ActionResult,
} from "@/lib/action-context";
import { isActiveClanMember, loadClanScopedFacts } from "@/lib/clans/facts";
import { lockActiveClansForMembershipRead } from "@/lib/clans/locks";
import { CONTABILIDADE_CLAN_SLUG } from "@/lib/clans/rules";
import { reconcileClosingYearLedger } from "@/lib/closings/closing-year-xp";
import {
  enqueueTelegramNotificationIfEnabled,
  enqueueTelegramOrgBroadcast,
  notificationPayload,
} from "@/lib/telegram/notifications";

/**
 * Server Actions dos Fechamentos da Contabilidade.
 *
 * Toda decisão de permissão sai de `canManageClanClosings` /
 * `canDeleteClanClosing`, com os fatos (papel na organização, liderança e
 * vínculo ativo com ESTE clã) carregados aqui do banco. A interface nunca
 * informa quem é da Contabilidade — a aba só existir no clã certo é
 * navegação, não autorização.
 */

const yearSchema = z.number().int().min(2000).max(2100);

type MemberContext = {
  orgId: string;
  userId: string;
  role: Parameters<typeof loadClanScopedFacts>[4];
};

/**
 * Prova que o clã informado é a Contabilidade e devolve os fatos de
 * autorização. O mutex de leitura de vínculo é o mesmo das demais mesas:
 * fecha a janela entre validar a participação e gravar.
 */
async function requireClosingActor(
  tx: OrgTx,
  ctx: MemberContext,
  clanId: string,
): Promise<{ ok: true; facts: ClosingActorFacts } | { ok: false; error: string }> {
  await lockActiveClansForMembershipRead(tx, ctx.orgId);
  const { clan, facts } = await loadClanScopedFacts(
    tx,
    ctx.orgId,
    clanId,
    ctx.userId,
    ctx.role,
  );
  if (!clan) return err("Clã não encontrado.");
  if (clan.slug !== CONTABILIDADE_CLAN_SLUG) {
    return err("Os fechamentos pertencem ao clã Contabilidade.");
  }
  const activeMember = await isActiveClanMember(
    tx,
    ctx.orgId,
    clan.id,
    ctx.userId,
  );
  return { ok: true, facts: { ...facts, isActiveClanMember: activeMember } };
}

const NAO_AUTORIZADO =
  "Apenas quem integra a Contabilidade, sua liderança ou um admin pode alterar fechamentos.";

/** Gate da rotina diária — usado por tudo, menos a exclusão. */
async function requireClosingManager(
  tx: OrgTx,
  ctx: MemberContext,
  clanId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const gate = await requireClosingActor(tx, ctx, clanId);
  if (!gate.ok) return gate;
  if (!canManageClanClosings(gate.facts)) return err(NAO_AUTORIZADO);
  return { ok: true };
}

function optionalMoneySchema(
  label: string,
  options: { nonnegative?: boolean } = {},
) {
  return z
    .union([z.string(), z.number()])
    .transform((value, ctx) => {
      const raw = String(value).trim();
      if (!raw) return null;

      const normalized = raw.includes(",")
        ? raw.replace(/\./g, "").replace(",", ".")
        : raw;

      if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) {
        ctx.addIssue({
          code: "custom",
          message: `${label} deve ser um valor válido com até 2 casas decimais.`,
        });
        return z.NEVER;
      }

      const numericValue = Number(normalized);
      if (
        !Number.isFinite(numericValue) ||
        Math.abs(numericValue) > 9_999_999_999_999.99
      ) {
        ctx.addIssue({
          code: "custom",
          message: `${label} está fora do limite permitido.`,
        });
        return z.NEVER;
      }
      if (options.nonnegative && numericValue < 0) {
        ctx.addIssue({
          code: "custom",
          message: `${label} não pode ser negativo.`,
        });
        return z.NEVER;
      }

      return normalized;
    });
}

const closingFields = {
  title: z
    .string()
    .trim()
    .min(2, "Descreva o fechamento.")
    .max(160, "Descrição muito longa."),
  notes: z.string().trim().max(3000, "Observação muito longa."),
  cashBalance: optionalMoneySchema("Saldo de caixa"),
  periodResult: optionalMoneySchema("Resultado"),
  shareholderLoan: optionalMoneySchema("Empréstimo de sócio", {
    nonnegative: true,
  }),
};

/** Presente em TODA action: é o clã cuja liderança/vínculo será conferido. */
const clanIdField = { clanId: z.uuid("Clã inválido.") };

const createClosingSchema = z.object({
  ...clanIdField,
  ...closingFields,
  clientId: z.uuid(),
  year: yearSchema,
});

export async function createClosing(
  input: z.input<typeof createClosingSchema>,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = createClosingSchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }
  const data = parsed.data;

  const result = await withOrgTx(ctx.orgId, async (tx) => {
    const gate = await requireClosingManager(tx, ctx, data.clanId);
    if (!gate.ok) return gate;

    const client = await tx.query.clients.findFirst({
      where: and(
        eq(schema.clients.id, data.clientId),
        eq(schema.clients.orgId, ctx.orgId),
        eq(schema.clients.active, true),
      ),
      columns: { id: true },
    });
    if (!client) return err("Empresa não encontrada.");

    const now = new Date();
    const [created] = await tx
      .insert(schema.accountingClosings)
      .values({
        orgId: ctx.orgId,
        clientId: client.id,
        title: data.title,
        dueDate: `${data.year}-12-31`,
        status: "completed",
        notes: data.notes || null,
        cashBalance: data.cashBalance,
        periodResult: data.periodResult,
        shareholderLoan: data.shareholderLoan,
        createdBy: ctx.userId,
        completedBy: ctx.userId,
        completedAt: now,
        updatedAt: now,
      })
      .returning({ id: schema.accountingClosings.id });

    return { ok: true, data: { id: created.id } } as const;
  });

  if (!result.ok) return result;
  revalidatePath("/clans/[id]", "page");
  return result;
}

const updateClosingSchema = z.object({
  ...clanIdField,
  ...closingFields,
  closingId: z.uuid(),
  clientId: z.uuid(),
  year: yearSchema,
});

export async function updateClosing(
  input: z.input<typeof updateClosingSchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = updateClosingSchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }
  const data = parsed.data;

  const result = await withOrgTx(ctx.orgId, async (tx) => {
    const gate = await requireClosingManager(tx, ctx, data.clanId);
    if (!gate.ok) return gate;

    const closing = await tx.query.accountingClosings.findFirst({
      where: and(
        eq(schema.accountingClosings.id, data.closingId),
        eq(schema.accountingClosings.orgId, ctx.orgId),
      ),
      columns: { id: true, completedAt: true, completedBy: true },
    });
    if (!closing) return err("Fechamento não encontrado.");
    const client = await tx.query.clients.findFirst({
      where: and(
        eq(schema.clients.id, data.clientId),
        eq(schema.clients.orgId, ctx.orgId),
        eq(schema.clients.active, true),
      ),
      columns: { id: true },
    });
    if (!client) return err("Empresa não encontrada.");

    const now = new Date();
    await tx
      .update(schema.accountingClosings)
      .set({
        clientId: client.id,
        title: data.title,
        dueDate: `${data.year}-12-31`,
        status: "completed",
        notes: data.notes || null,
        cashBalance: data.cashBalance,
        periodResult: data.periodResult,
        shareholderLoan: data.shareholderLoan,
        completedBy: closing.completedBy ?? ctx.userId,
        completedAt: closing.completedAt ?? now,
        completedByTaskId: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.accountingClosings.id, closing.id),
          eq(schema.accountingClosings.orgId, ctx.orgId),
        ),
      );

    return { ok: true } as const;
  });

  if (!result.ok) return result;
  revalidatePath("/clans/[id]", "page");
  return { ok: true };
}

const setStatusSchema = z.object({
  ...clanIdField,
  closingId: z.uuid(),
  status: z.enum(["pending", "blocked", "completed"]),
});

export async function setClosingStatus(
  input: z.input<typeof setStatusSchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = setStatusSchema.safeParse(input);
  if (!parsed.success) return err("Situação inválida.");

  const completed = parsed.data.status === "completed";
  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult> => {
    const gate = await requireClosingManager(tx, ctx, parsed.data.clanId);
    if (!gate.ok) return gate;

    const [row] = await tx
      .update(schema.accountingClosings)
      .set({
        status: parsed.data.status,
        completedBy: completed ? ctx.userId : null,
        completedAt: completed ? new Date() : null,
        completedByTaskId: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.accountingClosings.id, parsed.data.closingId),
          eq(schema.accountingClosings.orgId, ctx.orgId),
        ),
      )
      .returning({
        id: schema.accountingClosings.id,
        title: schema.accountingClosings.title,
        clientId: schema.accountingClosings.clientId,
      });
    if (!row) return err("Fechamento não encontrado.");
    const client = await tx.query.clients.findFirst({
      where: and(
        eq(schema.clients.id, row.clientId),
        eq(schema.clients.orgId, ctx.orgId),
      ),
      columns: { name: true },
    });
    await enqueueTelegramOrgBroadcast(tx, {
      orgId: ctx.orgId,
      eventType: `closing_${parsed.data.status}`,
      dedupeKey: `closing:${row.id}:status:${parsed.data.status}:${Date.now()}`,
      payload: notificationPayload(
        "closings",
        `📚 Fechamento ${parsed.data.status === "completed" ? "concluído" : parsed.data.status === "blocked" ? "com pendência" : "reaberto"}\n\n${client?.name ?? "Empresa"} — ${row.title}`,
        process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL
          ? [[{
              text: "Abrir fechamentos",
              url: new URL(
                "/closings",
                process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL,
              ).toString(),
            }]]
          : undefined,
      ),
    });
    return { ok: true };
  });

  if (!result.ok) return result;
  revalidatePath("/clans/[id]", "page");
  return { ok: true };
}

const deleteClosingSchema = z.object({ ...clanIdField, closingId: z.uuid() });

export async function deleteClosing(
  input: z.input<typeof deleteClosingSchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = deleteClosingSchema.safeParse(input);
  if (!parsed.success) return err("Fechamento inválido.");

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult> => {
    // Exclusão é o degrau estreito: apaga o registro sem deixar rastro,
    // diferente de reabrir o ano, que preserva o histórico.
    const gate = await requireClosingActor(tx, ctx, parsed.data.clanId);
    if (!gate.ok) return gate;
    if (!canDeleteClanClosing(gate.facts)) {
      return err(
        "Apenas a liderança da Contabilidade ou um admin pode excluir um fechamento.",
      );
    }

    const deleted = await tx
      .delete(schema.accountingClosings)
      .where(
        and(
          eq(schema.accountingClosings.id, parsed.data.closingId),
          eq(schema.accountingClosings.orgId, ctx.orgId),
        ),
      )
      .returning({ id: schema.accountingClosings.id });

    if (deleted.length === 0) return err("Fechamento não encontrado.");
    return { ok: true };
  });

  if (!result.ok) return result;
  revalidatePath("/clans/[id]", "page");
  return { ok: true };
}

const closingYearSchema = z.object({
  ...clanIdField,
  clientId: z.uuid(),
  year: z.number().int().min(2000).max(2100),
});

const setYearClosedSchema = closingYearSchema.extend({
  closed: z.boolean(),
});

export async function setYearClosed(
  input: z.input<typeof setYearClosedSchema>,
): Promise<ActionResult<{ xpAwarded: boolean; xp: number }>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = setYearClosedSchema.safeParse(input);
  if (!parsed.success) return err("Empresa ou ano inválido.");
  const data = parsed.data;

  const result = await withOrgTx(ctx.orgId, async (tx) => {
    const gate = await requireClosingManager(tx, ctx, data.clanId);
    if (!gate.ok) return gate;

    const client = await tx.query.clients.findFirst({
      where: and(
        eq(schema.clients.id, data.clientId),
        eq(schema.clients.orgId, ctx.orgId),
        eq(schema.clients.active, true),
      ),
      columns: { id: true },
    });
    if (!client) return err("Empresa não encontrada.");

    const now = new Date();
    // FOR UPDATE, não um findFirst solto: é o lock DA LINHA DO ANO que
    // serializa duas pessoas fechando o mesmo ano, porque a reconciliação do
    // ledger logo abaixo soma os lançamentos sem lock próprio. Foi ele que
    // substituiu o índice único parcial `(closing_year_id) WHERE reason =
    // 'closing_year_closed'`, removido porque impedia recreditar quem
    // fechasse o ano de novo depois de uma reabertura.
    const [existing] = await tx
      .select({ id: schema.accountingClosingYears.id })
      .from(schema.accountingClosingYears)
      .where(
        and(
          eq(schema.accountingClosingYears.orgId, ctx.orgId),
          eq(schema.accountingClosingYears.clientId, client.id),
          eq(schema.accountingClosingYears.year, data.year),
        ),
      )
      .for("update");

    const annual = existing
      ? (
          await tx
            .update(schema.accountingClosingYears)
            .set({
              closedAt: data.closed ? now : null,
              closedBy: data.closed ? ctx.userId : null,
              closedByTaskId: null,
              // Uma DEFIS entregue para um ano reaberto precisa ser revisada.
              ...(data.closed
                ? {}
                : { defisCompletedAt: null, defisCompletedBy: null }),
              updatedAt: now,
            })
            .where(
              and(
                eq(schema.accountingClosingYears.id, existing.id),
                eq(schema.accountingClosingYears.orgId, ctx.orgId),
              ),
            )
            .returning({ id: schema.accountingClosingYears.id })
        )[0]
      : (
          await tx
            .insert(schema.accountingClosingYears)
            .values({
              orgId: ctx.orgId,
              clientId: client.id,
              year: data.year,
              closedAt: data.closed ? now : null,
              closedBy: data.closed ? ctx.userId : null,
              updatedAt: now,
            })
            .returning({ id: schema.accountingClosingYears.id })
        )[0];

    // Fechar credita, reabrir estorna — os dois lados saem da mesma
    // reconciliação, que compara o ledger com quem consta no ano. Reabrir sem
    // estornar deixava o XP com quem teve o trabalho desfeito.
    const entries = await reconcileClosingYearLedger(tx, {
      orgId: ctx.orgId,
      closingYearId: annual.id,
      closedBy: data.closed ? ctx.userId : null,
    });
    const xpAwarded = entries.some(
      (entry) => entry.userId === ctx.userId && entry.amount > 0,
    );

    if (xpAwarded) {
      await enqueueTelegramNotificationIfEnabled(tx, {
        orgId: ctx.orgId,
        userId: ctx.userId,
        eventType: "closing_year_xp",
        dedupeKey: `closing-year:${annual.id}:xp`,
        payload: notificationPayload(
          "xp",
          `🏆 Fechamento anual concluído\n\n+${CLOSING_YEAR_XP} XP`,
          process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL
            ? [[{
                text: "Ver perfil",
                url: new URL(
                  "/profile",
                  process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL,
                ).toString(),
              }]]
            : undefined,
        ),
      });
    }

    return {
      ok: true,
      data: { xpAwarded, xp: CLOSING_YEAR_XP },
    } as const;
  });

  if (!result.ok) return result;
  revalidatePath("/clans/[id]", "page");
  if (result.data.xpAwarded) {
    revalidatePath("/profile");
    revalidatePath("/leaderboard");
  }
  return result;
}

const setDefisCompletedSchema = closingYearSchema.extend({
  completed: z.boolean(),
});

export async function setDefisCompleted(
  input: z.input<typeof setDefisCompletedSchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = setDefisCompletedSchema.safeParse(input);
  if (!parsed.success) return err("Empresa ou ano inválido.");
  const data = parsed.data;

  const result = await withOrgTx(ctx.orgId, async (tx) => {
    const gate = await requireClosingManager(tx, ctx, data.clanId);
    if (!gate.ok) return gate;

    const client = await tx.query.clients.findFirst({
      where: and(
        eq(schema.clients.id, data.clientId),
        eq(schema.clients.orgId, ctx.orgId),
        eq(schema.clients.active, true),
      ),
      columns: { id: true, taxRegime: true },
    });
    if (!client) return err("Empresa não encontrada.");
    if (client.taxRegime !== "simples") {
      return err("O controle da DEFIS é exclusivo do Simples Nacional.");
    }

    const annual = await tx.query.accountingClosingYears.findFirst({
      where: and(
        eq(schema.accountingClosingYears.orgId, ctx.orgId),
        eq(schema.accountingClosingYears.clientId, client.id),
        eq(schema.accountingClosingYears.year, data.year),
      ),
      columns: { id: true, closedAt: true },
    });
    if (!annual?.closedAt) {
      return err("Feche o ano da empresa antes de registrar a DEFIS.");
    }

    const updated = await tx
      .update(schema.accountingClosingYears)
      .set({
        defisCompletedAt: data.completed ? new Date() : null,
        defisCompletedBy: data.completed ? ctx.userId : null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.accountingClosingYears.id, annual.id),
          eq(schema.accountingClosingYears.orgId, ctx.orgId),
        ),
      )
      .returning({ id: schema.accountingClosingYears.id });

    return updated.length > 0
      ? ({ ok: true } as const)
      : err("Controle anual não encontrado.");
  });

  if (!result.ok) return result;
  revalidatePath("/clans/[id]", "page");
  return { ok: true };
}

const updateYearNotesSchema = closingYearSchema.extend({
  notes: z.string().trim().max(3000, "Observação do ano muito longa."),
  defisNotes: z.string().trim().max(3000, "Observação da DEFIS muito longa."),
});

export async function updateYearNotes(
  input: z.input<typeof updateYearNotesSchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = updateYearNotesSchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }
  const data = parsed.data;

  const result = await withOrgTx(ctx.orgId, async (tx) => {
    const gate = await requireClosingManager(tx, ctx, data.clanId);
    if (!gate.ok) return gate;

    const client = await tx.query.clients.findFirst({
      where: and(
        eq(schema.clients.id, data.clientId),
        eq(schema.clients.orgId, ctx.orgId),
        eq(schema.clients.active, true),
      ),
      columns: { id: true, taxRegime: true },
    });
    if (!client) return err("Empresa não encontrada.");

    const now = new Date();
    await tx
      .insert(schema.accountingClosingYears)
      .values({
        orgId: ctx.orgId,
        clientId: client.id,
        year: data.year,
        notes: data.notes || null,
        defisNotes:
          client.taxRegime === "simples" ? data.defisNotes || null : null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          schema.accountingClosingYears.orgId,
          schema.accountingClosingYears.clientId,
          schema.accountingClosingYears.year,
        ],
        set: {
          notes: data.notes || null,
          defisNotes:
            client.taxRegime === "simples" ? data.defisNotes || null : null,
          updatedAt: now,
        },
      });

    return { ok: true } as const;
  });

  if (!result.ok) return result;
  revalidatePath("/clans/[id]", "page");
  return { ok: true };
}
