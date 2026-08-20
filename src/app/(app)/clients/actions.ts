"use server";

import { and, count, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { readSheet } from "read-excel-file/node";
import { z } from "zod";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { normalizeCnpj, validateCnpj } from "@/domain/cnpj";
import {
  err,
  requireMemberContext,
  type ActionResult,
} from "@/lib/action-context";
import { TAX_REGIMES } from "@/lib/clients-ui";
import {
  parseClientImportRows,
  type ClientImportCellValue,
} from "@/lib/clients-import";
import { isAdminRole } from "@/lib/session";

/**
 * Server Actions das empresas-cliente (Fase 5a).
 * Qualquer membro da org gerencia o cadastro (decisão de 2026-07-06).
 * Sem DELETE: cliente sai de cena com active = false.
 */

const clientFieldsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Nome muito curto.")
    .max(200, "Nome muito longo."),
  taxRegime: z.enum(TAX_REGIMES, { error: "Escolha o regime tributário." }),
  cnpj: z
    .string()
    .optional()
    .transform((v) => (v ? normalizeCnpj(v) : undefined))
    .refine((v) => !v || validateCnpj(v), "CNPJ inválido — confira os dígitos."),
});

function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } })?.cause;
  return cause?.code === "23505";
}

export interface ImportClientsResult {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  rejected: { rowNumber: number; error: string }[];
}

export async function createClient(
  input: z.input<typeof clientFieldsSchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = clientFieldsSchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }
  const data = parsed.data;

  try {
    await withOrgTx(ctx.orgId, (tx) =>
      tx.insert(schema.clients).values({
        orgId: ctx.orgId,
        name: data.name,
        taxRegime: data.taxRegime,
        cnpj: data.cnpj ?? null,
      }),
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      return err("Já existe uma empresa com este CNPJ na organização.");
    }
    throw error;
  }

  revalidatePath("/clients");
  revalidatePath("/clans/[id]", "page");
  return { ok: true };
}

const updateClientSchema = clientFieldsSchema.extend({
  clientId: z.uuid(),
});

export async function updateClient(
  input: z.input<typeof updateClientSchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = updateClientSchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }
  const data = parsed.data;

  try {
    const updated = await withOrgTx(ctx.orgId, (tx) =>
      tx
        .update(schema.clients)
        .set({
          name: data.name,
          taxRegime: data.taxRegime,
          cnpj: data.cnpj ?? null,
        })
        .where(
          and(
            eq(schema.clients.id, data.clientId),
            eq(schema.clients.orgId, ctx.orgId),
          ),
        )
        .returning({ id: schema.clients.id }),
    );
    if (updated.length === 0) return err("Empresa não encontrada.");
  } catch (error) {
    if (isUniqueViolation(error)) {
      return err("Já existe uma empresa com este CNPJ na organização.");
    }
    throw error;
  }

  revalidatePath("/clients");
  revalidatePath("/clans/[id]", "page");
  return { ok: true };
}

const setActiveSchema = z.object({
  clientId: z.uuid(),
  active: z.boolean(),
});

export async function setClientActive(
  input: z.input<typeof setActiveSchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = setActiveSchema.safeParse(input);
  if (!parsed.success) return err("Dados inválidos.");

  const updated = await withOrgTx(ctx.orgId, (tx) =>
    tx
      .update(schema.clients)
      .set({ active: parsed.data.active })
      .where(
        and(
          eq(schema.clients.id, parsed.data.clientId),
          eq(schema.clients.orgId, ctx.orgId),
        ),
      )
      .returning({ id: schema.clients.id }),
  );
  if (updated.length === 0) return err("Empresa não encontrada.");

  revalidatePath("/clients");
  revalidatePath("/clans/[id]", "page");
  return { ok: true };
}

const importClientsSchema = z.object({
  taxRegime: z.enum(TAX_REGIMES, { error: "Escolha o regime tributário." }),
});

function readCsvRows(text: string): ClientImportCellValue[][] {
  const delimiter = text.includes(";") ? ";" : ",";
  return text.split(/\r?\n/).map((line) =>
    line
      .split(delimiter)
      .map((cell) => cell.trim().replace(/^"|"$/g, "")),
  );
}

async function readSpreadsheetRows(
  fileName: string,
  buffer: Buffer,
): Promise<ClientImportCellValue[][]> {
  if (fileName.toLowerCase().endsWith(".csv")) {
    return readCsvRows(buffer.toString("utf8"));
  }

  return readSheet(buffer);
}

export async function importClientsFromSpreadsheet(
  formData: FormData,
): Promise<ActionResult<ImportClientsResult>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = importClientsSchema.safeParse({
    taxRegime: formData.get("taxRegime"),
  });
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }

  const file = formData.get("file");
  if (!(file instanceof File)) return err("Selecione uma planilha.");
  if (file.size === 0) return err("A planilha está vazia.");
  if (file.size > 5 * 1024 * 1024) {
    return err("A planilha precisa ter até 5 MB.");
  }
  if (
    !file.name.toLowerCase().endsWith(".xlsx") &&
    !file.name.toLowerCase().endsWith(".csv")
  ) {
    return err("Use uma planilha .xlsx ou .csv.");
  }

  let rows: ClientImportCellValue[][];
  try {
    rows = await readSpreadsheetRows(file.name, Buffer.from(await file.arrayBuffer()));
  } catch {
    return err("Não consegui ler a planilha. Use .xlsx ou .csv.");
  }

  const parsedRows = parseClientImportRows(rows, parsed.data.taxRegime);
  if (parsedRows.rows.length === 0) {
    return err(
      parsedRows.rejected.length > 0
        ? "Nenhuma empresa válida encontrada na planilha."
        : "A planilha não tem empresas para importar.",
    );
  }
  if (parsedRows.rows.length > 3000) {
    return err("Importe no máximo 3000 empresas por arquivo.");
  }

  const summary: ImportClientsResult = {
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: parsedRows.skipped,
    rejected: parsedRows.rejected,
  };

  await withOrgTx(ctx.orgId, async (tx) => {
    for (const row of parsedRows.rows) {
      const existing = row.cnpj
        ? await tx.query.clients.findFirst({
            where: and(
              eq(schema.clients.orgId, ctx.orgId),
              eq(schema.clients.cnpj, row.cnpj),
            ),
          })
        : await tx.query.clients.findFirst({
            where: and(
              eq(schema.clients.orgId, ctx.orgId),
              eq(schema.clients.name, row.name),
              isNull(schema.clients.cnpj),
            ),
          });

      if (!existing) {
        await tx.insert(schema.clients).values({
          orgId: ctx.orgId,
          name: row.name,
          taxRegime: row.taxRegime,
          cnpj: row.cnpj ?? null,
        });
        summary.created++;
        continue;
      }

      if (
        existing.name !== row.name ||
        existing.taxRegime !== row.taxRegime ||
        !existing.active
      ) {
        await tx
          .update(schema.clients)
          .set({
            name: row.name,
            taxRegime: row.taxRegime,
            active: true,
          })
          .where(eq(schema.clients.id, existing.id));
        summary.updated++;
      } else {
        summary.unchanged++;
      }
    }
  });

  revalidatePath("/clients");
  revalidatePath("/clans/[id]", "page");
  return { ok: true, data: summary };
}

const deletionSummarySchema = z.object({ clientId: z.uuid() });

export interface ClientDeletionSummary {
  clientName: string;
  taskCount: number;
  closingCount: number;
  commitmentCount: number;
  portfolioHolderName: string | null;
}

/**
 * Contagem para o dialog de confirmação — a mesma consulta que fundamenta a
 * mensagem "vai apagar N missões, M fechamentos, P compromissos" antes do
 * usuário decidir se confirma. As quatro contagens rodam na mesma transação
 * que a leitura do cliente, então são consistentes ENTRE SI (uma única foto
 * do banco) — mas isto é uma chamada separada de `deleteClientPermanently`,
 * sem transação compartilhada entre as duas. Quem protege a exclusão de uma
 * corrida é o `.for("update")` + a checagem de nome dentro da própria
 * `deleteClientPermanently`, não este resumo.
 */
export async function getClientDeletionSummary(
  input: z.input<typeof deletionSummarySchema>,
): Promise<ActionResult<ClientDeletionSummary>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  if (!isAdminRole(ctx.role)) {
    return err("Apenas admin/owner pode excluir uma empresa permanentemente.");
  }

  const parsed = deletionSummarySchema.safeParse(input);
  if (!parsed.success) return err("Empresa inválida.");

  const summary = await withOrgTx(ctx.orgId, async (tx) => {
    const [client] = await tx
      .select({ id: schema.clients.id, name: schema.clients.name })
      .from(schema.clients)
      .where(
        and(
          eq(schema.clients.id, parsed.data.clientId),
          eq(schema.clients.orgId, ctx.orgId),
        ),
      );
    if (!client) return null;

    const [[taskRow], [closingRow], [commitmentRow], [portfolioRow]] = await Promise.all([
      tx
        .select({ value: count() })
        .from(schema.tasks)
        .where(
          and(eq(schema.tasks.orgId, ctx.orgId), eq(schema.tasks.clientId, client.id)),
        ),
      tx
        .select({ value: count() })
        .from(schema.accountingClosings)
        .where(
          and(
            eq(schema.accountingClosings.orgId, ctx.orgId),
            eq(schema.accountingClosings.clientId, client.id),
          ),
        ),
      tx
        .select({ value: count() })
        .from(schema.clientCommitments)
        .where(
          and(
            eq(schema.clientCommitments.orgId, ctx.orgId),
            eq(schema.clientCommitments.clientId, client.id),
          ),
        ),
      tx
        .select({ name: schema.user.name })
        .from(schema.fiscalPortfolios)
        .innerJoin(schema.user, eq(schema.user.id, schema.fiscalPortfolios.userId))
        .where(
          and(
            eq(schema.fiscalPortfolios.orgId, ctx.orgId),
            eq(schema.fiscalPortfolios.clientId, client.id),
          ),
        )
        .limit(1),
    ]);

    return {
      clientName: client.name,
      taskCount: taskRow.value,
      closingCount: closingRow.value,
      commitmentCount: commitmentRow.value,
      portfolioHolderName: portfolioRow?.name ?? null,
    };
  });

  if (!summary) return err("Empresa não encontrada.");
  return { ok: true, data: summary };
}

const deletePermanentlySchema = z.object({
  clientId: z.uuid(),
  confirmName: z.string().trim().min(1, "Digite o nome da empresa para confirmar."),
});

/**
 * Exclusão física de uma empresa-cliente, em cascata: missões, eventos de
 * missão, transferências, fechamentos, anos de fechamento, carteira,
 * histórico de carteira e compromissos somem junto (ON DELETE CASCADE nas
 * FKs — ver migration 0033). `xp_ledger.task_id`/`closing_year_id` e
 * `guild_notices.client_id` viram NULL em vez de apagar (ON DELETE SET
 * NULL): o XP já creditado nunca é tocado, só perde o rastro de onde veio.
 *
 * Mais restrito que `setClientActive` (que qualquer membro faz): exige
 * admin/owner, porque o estrago é permanente. Não exige desativar antes —
 * digitar o nome exato já é a barreira principal.
 */
export async function deleteClientPermanently(
  input: z.input<typeof deletePermanentlySchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  if (!isAdminRole(ctx.role)) {
    return err("Apenas admin/owner pode excluir uma empresa permanentemente.");
  }

  const parsed = deletePermanentlySchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult> => {
    const [client] = await tx
      .select({ id: schema.clients.id, name: schema.clients.name })
      .from(schema.clients)
      .where(
        and(
          eq(schema.clients.id, parsed.data.clientId),
          eq(schema.clients.orgId, ctx.orgId),
        ),
      )
      .for("update");
    if (!client) return err("Empresa não encontrada.");

    if (parsed.data.confirmName !== client.name) {
      return err("O nome digitado não confere com o nome da empresa.");
    }

    await tx
      .delete(schema.clients)
      .where(and(eq(schema.clients.id, client.id), eq(schema.clients.orgId, ctx.orgId)));

    return { ok: true };
  });

  if (result.ok) {
    revalidatePath("/clients");
    revalidatePath("/clans/[id]", "page");
    revalidatePath("/profile");
    revalidatePath("/leaderboard");
  }
  return result;
}
