"use server";

import { and, asc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { readSheet } from "read-excel-file/node";
import { z } from "zod";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import {
  normalizeCompanyName,
  reconcileCompanyName,
} from "@/domain/fiscal-import";
import { canManageFiscalOperations } from "@/domain/guild-permissions";
import {
  parseInstallmentProgress,
  parseInstallmentSpreadsheetRows,
} from "@/domain/installment-import";
import {
  err,
  requireMemberContext,
  type ActionResult,
} from "@/lib/action-context";
import { loadClanScopedFacts } from "@/lib/clans/facts";
import { lockActiveClansForMembershipRead } from "@/lib/clans/locks";
import { FISCAL_CLAN_SLUG } from "@/lib/clans/rules";

type OrgTx = Parameters<Parameters<typeof withOrgTx>[1]>[0];

async function canManageInstallments(
  tx: OrgTx,
  ctx: { orgId: string; userId: string; role: Parameters<typeof loadClanScopedFacts>[4] },
  clanId: string,
): Promise<boolean> {
  await lockActiveClansForMembershipRead(tx, ctx.orgId);
  const loaded = await loadClanScopedFacts(
    tx,
    ctx.orgId,
    clanId,
    ctx.userId,
    ctx.role,
  );
  return Boolean(
    loaded.clan?.slug === FISCAL_CLAN_SLUG &&
      canManageFiscalOperations(loaded.facts),
  );
}

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null);

const installmentFieldsSchema = z.object({
  clientId: z.uuid("Empresa inválida."),
  installmentType: z
    .string()
    .trim()
    .min(2, "Informe o tipo de parcelamento.")
    .max(240),
  notes: nullableText(5000),
  deliveryMethod: nullableText(240),
  installmentNumber: nullableText(120),
  paidInstallments: z.number().int().min(0).max(100_000),
  totalInstallments: z.number().int().min(1).max(100_000).nullable(),
}).refine(
  (value) => value.totalInstallments === null || value.paidInstallments <= value.totalInstallments,
  { message: "As parcelas pagas não podem superar o total." },
);

const saveSchema = installmentFieldsSchema.safeExtend({
  clanId: z.uuid("Clã inválido."),
  installmentId: z.uuid("Parcelamento inválido.").nullable(),
});

export async function saveFiscalInstallment(
  input: z.input<typeof saveSchema>,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const data = parsed.data;

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult<{ id: string }>> => {
    if (!(await canManageInstallments(tx, ctx, data.clanId))) {
      return err("Apenas a liderança do Fiscal ou um admin pode alterar parcelamentos.");
    }
    const [client] = await tx
      .select({ id: schema.clients.id })
      .from(schema.clients)
      .where(
        and(
          eq(schema.clients.orgId, ctx.orgId),
          eq(schema.clients.id, data.clientId),
          eq(schema.clients.active, true),
        ),
      );
    if (!client) return err("Empresa ativa não encontrada.");

    if (data.installmentId) {
      const [saved] = await tx
        .update(schema.fiscalInstallments)
        .set({
          clientId: data.clientId,
          installmentType: data.installmentType,
          notes: data.notes,
          deliveryMethod: data.deliveryMethod,
          paidInstallments: data.paidInstallments,
          totalInstallments: data.totalInstallments,
          installmentNumber: data.totalInstallments
            ? `${data.paidInstallments}/${data.totalInstallments}`
            : data.installmentNumber,
          updatedBy: ctx.userId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.fiscalInstallments.orgId, ctx.orgId),
            eq(schema.fiscalInstallments.id, data.installmentId),
          ),
        )
        .returning({ id: schema.fiscalInstallments.id });
      if (!saved) return err("Parcelamento não encontrado.");
      return { ok: true, data: saved };
    }

    const [saved] = await tx
      .insert(schema.fiscalInstallments)
      .values({
        orgId: ctx.orgId,
        clientId: data.clientId,
        installmentType: data.installmentType,
        notes: data.notes,
        deliveryMethod: data.deliveryMethod,
        paidInstallments: data.paidInstallments,
        totalInstallments: data.totalInstallments,
        installmentNumber: data.totalInstallments
          ? `${data.paidInstallments}/${data.totalInstallments}`
          : data.installmentNumber,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: schema.fiscalInstallments.id });
    return { ok: true, data: saved };
  });

  if (result.ok) revalidatePath(`/clans/${data.clanId}`);
  return result;
}

const deleteSchema = z.object({
  clanId: z.uuid("Clã inválido."),
  installmentId: z.uuid("Parcelamento inválido."),
});

export async function deleteFiscalInstallment(
  input: z.input<typeof deleteSchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const data = parsed.data;

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult> => {
    if (!(await canManageInstallments(tx, ctx, data.clanId))) {
      return err("Apenas a liderança do Fiscal ou um admin pode excluir parcelamentos.");
    }
    const removed = await tx
      .delete(schema.fiscalInstallments)
      .where(
        and(
          eq(schema.fiscalInstallments.orgId, ctx.orgId),
          eq(schema.fiscalInstallments.id, data.installmentId),
        ),
      )
      .returning({ id: schema.fiscalInstallments.id });
    if (removed.length === 0) return err("Parcelamento não encontrado.");
    return { ok: true };
  });

  if (result.ok) revalidatePath(`/clans/${data.clanId}`);
  return result;
}

const progressSchema = z.object({
  clanId: z.uuid("Clã inválido."),
  installmentId: z.uuid("Parcelamento inválido."),
  direction: z.enum(["increase", "decrease"]),
});

export async function changeFiscalInstallmentPaid(
  input: z.input<typeof progressSchema>,
): Promise<ActionResult<{ paidInstallments: number }>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsed = progressSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const data = parsed.data;

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult<{ paidInstallments: number }>> => {
    if (!(await canManageInstallments(tx, ctx, data.clanId))) {
      return err("Apenas a liderança do Fiscal ou um admin pode alterar o progresso.");
    }
    const [installment] = await tx
      .select({
        paidInstallments: schema.fiscalInstallments.paidInstallments,
        totalInstallments: schema.fiscalInstallments.totalInstallments,
      })
      .from(schema.fiscalInstallments)
      .where(
        and(
          eq(schema.fiscalInstallments.orgId, ctx.orgId),
          eq(schema.fiscalInstallments.id, data.installmentId),
        ),
      )
      .for("update");
    if (!installment) return err("Parcelamento não encontrado.");

    const delta = data.direction === "increase" ? 1 : -1;
    const next = Math.max(
      0,
      Math.min(
        installment.paidInstallments + delta,
        installment.totalInstallments ?? Number.MAX_SAFE_INTEGER,
      ),
    );
    await tx
      .update(schema.fiscalInstallments)
      .set({
        paidInstallments: next,
        installmentNumber: installment.totalInstallments
          ? `${next}/${installment.totalInstallments}`
          : undefined,
        updatedBy: ctx.userId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.fiscalInstallments.orgId, ctx.orgId),
          eq(schema.fiscalInstallments.id, data.installmentId),
        ),
      );
    return { ok: true, data: { paidInstallments: next } };
  });

  if (result.ok) revalidatePath(`/clans/${data.clanId}`);
  return result;
}

const generatedSchema = z.object({
  clanId: z.uuid("Clã inválido."),
  installmentId: z.uuid("Parcelamento inválido."),
  periodYear: z.number().int().min(2000).max(2100),
  periodMonth: z.number().int().min(1).max(12),
  generated: z.boolean(),
});

export async function setFiscalInstallmentGenerated(
  input: z.input<typeof generatedSchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsed = generatedSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const data = parsed.data;

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult> => {
    if (!(await canManageInstallments(tx, ctx, data.clanId))) {
      return err("Apenas a liderança do Fiscal ou um admin pode marcar parcelas geradas.");
    }
    const [installment] = await tx
      .select({
        id: schema.fiscalInstallments.id,
        paidInstallments: schema.fiscalInstallments.paidInstallments,
        totalInstallments: schema.fiscalInstallments.totalInstallments,
      })
      .from(schema.fiscalInstallments)
      .where(
        and(
          eq(schema.fiscalInstallments.orgId, ctx.orgId),
          eq(schema.fiscalInstallments.id, data.installmentId),
        ),
      )
      .for("update");
    if (!installment) return err("Parcelamento não encontrado.");

    if (data.generated) {
      const canAdvance =
        installment.totalInstallments === null ||
        installment.paidInstallments < installment.totalInstallments;
      const inserted = await tx
        .insert(schema.fiscalInstallmentIssuances)
        .values({
          orgId: ctx.orgId,
          installmentId: data.installmentId,
          periodYear: data.periodYear,
          periodMonth: data.periodMonth,
          advancedPaid: canAdvance,
          generatedBy: ctx.userId,
        })
        .onConflictDoNothing()
        .returning({ id: schema.fiscalInstallmentIssuances.id });
      if (inserted.length > 0 && canAdvance) {
        const next = installment.paidInstallments + 1;
        await tx
          .update(schema.fiscalInstallments)
          .set({
            paidInstallments: next,
            installmentNumber: installment.totalInstallments
              ? `${next}/${installment.totalInstallments}`
              : undefined,
            updatedBy: ctx.userId,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.fiscalInstallments.orgId, ctx.orgId),
              eq(schema.fiscalInstallments.id, data.installmentId),
            ),
          );
      }
    } else {
      const removed = await tx
        .delete(schema.fiscalInstallmentIssuances)
        .where(
          and(
            eq(schema.fiscalInstallmentIssuances.orgId, ctx.orgId),
            eq(schema.fiscalInstallmentIssuances.installmentId, data.installmentId),
            eq(schema.fiscalInstallmentIssuances.periodYear, data.periodYear),
            eq(schema.fiscalInstallmentIssuances.periodMonth, data.periodMonth),
          ),
        )
        .returning({ advancedPaid: schema.fiscalInstallmentIssuances.advancedPaid });
      if (removed[0]?.advancedPaid && installment.paidInstallments > 0) {
        const next = installment.paidInstallments - 1;
        await tx
          .update(schema.fiscalInstallments)
          .set({
            paidInstallments: next,
            installmentNumber: installment.totalInstallments
              ? `${next}/${installment.totalInstallments}`
              : undefined,
            updatedBy: ctx.userId,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.fiscalInstallments.orgId, ctx.orgId),
              eq(schema.fiscalInstallments.id, data.installmentId),
            ),
          );
      }
    }
    return { ok: true };
  });

  if (result.ok) revalidatePath(`/clans/${data.clanId}`);
  return result;
}

export interface InstallmentImportPreview {
  fileName: string;
  clients: readonly { id: string; name: string }[];
  rows: readonly {
    rowNumber: number;
    sourceName: string;
    status: "matched" | "suggested" | "ambiguous" | "pending";
    suggestedClientId: string | null;
    explanation: string;
    installmentType: string;
    notes: string | null;
    deliveryMethod: string | null;
    installmentNumber: string | null;
    paidInstallments: number;
    totalInstallments: number | null;
  }[];
  rejectedRows: readonly { rowNumber: number; message: string }[];
  skippedRows: number;
}

export async function previewInstallmentImport(
  formData: FormData,
): Promise<ActionResult<InstallmentImportPreview>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const clanId = String(formData.get("clanId") ?? "");
  if (!z.uuid().safeParse(clanId).success) return err("Clã inválido.");
  const file = formData.get("file");
  if (!(file instanceof File)) return err("Selecione uma planilha.");
  if (!file.name.toLocaleLowerCase("pt-BR").endsWith(".xlsx")) {
    return err("Use uma planilha no formato .xlsx.");
  }
  if (file.size === 0 || file.size > 5 * 1024 * 1024) {
    return err("A planilha precisa ter entre 1 byte e 5 MB.");
  }

  let sheet: unknown[][];
  try {
    sheet = await readSheet(Buffer.from(await file.arrayBuffer()));
  } catch {
    return err("Não consegui ler a planilha. Confirme se o arquivo .xlsx está íntegro.");
  }
  if (sheet.length > 5000) return err("A planilha deve ter no máximo 5.000 linhas.");
  const parsedSheet = parseInstallmentSpreadsheetRows(sheet);
  if (parsedSheet.errors.length > 0) return err(parsedSheet.errors[0] ?? "Planilha inválida.");
  if (parsedSheet.rows.length === 0) return err("Nenhum parcelamento encontrado na planilha.");
  if (parsedSheet.rows.length > 1000) return err("Importe no máximo 1.000 parcelamentos por arquivo.");

  return withOrgTx(ctx.orgId, async (tx): Promise<ActionResult<InstallmentImportPreview>> => {
    if (!(await canManageInstallments(tx, ctx, clanId))) {
      return err("Apenas a liderança do Fiscal ou um admin pode importar parcelamentos.");
    }
    const clients = await tx
      .select({ id: schema.clients.id, name: schema.clients.name })
      .from(schema.clients)
      .where(and(eq(schema.clients.orgId, ctx.orgId), eq(schema.clients.active, true)))
      .orderBy(asc(schema.clients.name));
    const aliases = await tx
      .select({ clientId: schema.fiscalClientAliases.clientId, aliasName: schema.fiscalClientAliases.aliasName })
      .from(schema.fiscalClientAliases)
      .where(eq(schema.fiscalClientAliases.orgId, ctx.orgId));
    const aliasesByClient = new Map<string, string[]>();
    for (const alias of aliases) {
      aliasesByClient.set(alias.clientId, [
        ...(aliasesByClient.get(alias.clientId) ?? []),
        alias.aliasName,
      ]);
    }
    const candidates = clients.map((client) => ({
      ...client,
      aliases: aliasesByClient.get(client.id) ?? [],
    }));

    return {
      ok: true,
      data: {
        fileName: file.name,
        clients,
        rows: parsedSheet.rows.map((row) => {
          const match = reconcileCompanyName(row.parsed.companyName, candidates);
          const suggestion = match.exactMatch ?? match.suggestions[0] ?? null;
          return {
            rowNumber: row.rowNumber,
            sourceName: row.parsed.companyName,
            status: match.status === "exact"
              ? "matched"
              : match.status === "ambiguous"
                ? "ambiguous"
                : suggestion
                  ? "suggested"
                  : "pending",
            suggestedClientId: suggestion?.clientId ?? null,
            explanation: match.explanation,
            installmentType: row.parsed.installmentType,
            notes: row.parsed.notes,
            deliveryMethod: row.parsed.deliveryMethod,
            installmentNumber: row.parsed.installmentNumber,
            ...parseInstallmentProgress(row.parsed.installmentNumber),
          };
        }),
        rejectedRows: parsedSheet.rejectedRows,
        skippedRows: parsedSheet.skippedRows,
      },
    };
  });
}

const applyImportSchema = z.object({
  clanId: z.uuid("Clã inválido."),
  rows: z
    .array(
      installmentFieldsSchema.safeExtend({
        rowNumber: z.number().int().min(1),
        sourceName: z.string().trim().min(1).max(240),
      }),
    )
    .min(1)
    .max(1000),
});

export async function applyInstallmentImport(
  input: z.input<typeof applyImportSchema>,
): Promise<ActionResult<{ imported: number }>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsed = applyImportSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Importação inválida.");
  const data = parsed.data;

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult<{ imported: number }>> => {
    if (!(await canManageInstallments(tx, ctx, data.clanId))) {
      return err("Apenas a liderança do Fiscal ou um admin pode importar parcelamentos.");
    }
    const clientIds = [...new Set(data.rows.map((row) => row.clientId))];
    const clients = await tx
      .select({ id: schema.clients.id })
      .from(schema.clients)
      .where(
        and(
          eq(schema.clients.orgId, ctx.orgId),
          eq(schema.clients.active, true),
          inArray(schema.clients.id, clientIds),
        ),
      );
    if (clients.length !== clientIds.length) {
      return err("Uma das empresas selecionadas não está ativa nesta organização.");
    }

    await tx.insert(schema.fiscalInstallments).values(
      data.rows.map((row) => ({
        orgId: ctx.orgId,
        clientId: row.clientId,
        installmentType: row.installmentType,
        notes: row.notes,
        deliveryMethod: row.deliveryMethod,
        installmentNumber: row.installmentNumber,
        paidInstallments: row.paidInstallments,
        totalInstallments: row.totalInstallments,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })),
    );

    for (const row of data.rows) {
      const normalizedName = normalizeCompanyName(row.sourceName).canonical;
      if (!normalizedName) continue;
      await tx
        .insert(schema.fiscalClientAliases)
        .values({
          orgId: ctx.orgId,
          clientId: row.clientId,
          aliasName: row.sourceName,
          normalizedName,
          source: "import_reconciliation",
          createdBy: ctx.userId,
        })
        .onConflictDoNothing();
    }
    return { ok: true, data: { imported: data.rows.length } };
  });

  if (result.ok) revalidatePath(`/clans/${data.clanId}`);
  return result;
}
