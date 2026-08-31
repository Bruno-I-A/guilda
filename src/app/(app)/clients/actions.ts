"use server";

import { and, count, desc, eq, isNull, ne, sql } from "drizzle-orm";
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
  parseClientReplacementRows,
  type ClientImportCellValue,
  type ClientReplacementRow,
} from "@/lib/clients-import";
import {
  lookupCnpj,
  type CnpjLookupData,
} from "@/lib/cnpj-lookup";
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

type ImportRowState = "pending" | "consulted" | "error";

interface EnrichedClientImportRow extends ClientReplacementRow {
  state: ImportRowState;
  attempts: number;
  lookup: CnpjLookupData | null;
  taxRegime: (typeof TAX_REGIMES)[number] | null;
  error: string | null;
}

export interface ClientImportProgress {
  batchId: string;
  status: string;
  total: number;
  consulted: number;
  errors: number;
  retryAfterSeconds: number;
  review: {
    rowNumber: number;
    cnpj: string;
    name: string;
    error: string | null;
    taxRegime: (typeof TAX_REGIMES)[number] | null;
    cadastralSituation: string | null;
  }[];
}

function inferTaxRegime(
  lookup: CnpjLookupData,
): (typeof TAX_REGIMES)[number] | null {
  if (lookup.isMeiOptant) return "simples";
  if (lookup.isSimplesOptant) return "simples";
  const latest = [...lookup.taxRegimes]
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0))[0]?.form
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase();
  if (latest?.includes("PRESUMIDO")) return "presumido";
  if (latest?.includes("REAL")) return "real";
  const nature = lookup.legalNature
    ?.normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase();
  return nature?.includes("ASSOCIACAO PRIVADA") ? "association" : null;
}

function progressOf(
  batchId: string,
  status: string,
  rows: EnrichedClientImportRow[],
  retryAfterSeconds = 0,
): ClientImportProgress {
  return {
    batchId,
    status,
    total: rows.length,
    consulted: rows.filter((row) => row.state === "consulted").length,
    errors: rows.filter((row) => row.state === "error").length,
    retryAfterSeconds,
    review: rows
      .filter((row) =>
        row.state === "error" ||
        (row.state === "consulted" && (
          !row.taxRegime || row.lookup?.cadastralSituation?.toUpperCase() !== "ATIVA"
        )),
      )
      .map((row) => ({
        rowNumber: row.rowNumber,
        cnpj: row.cnpj,
        name: row.lookup?.legalName ?? row.spreadsheetName,
        error: row.error,
        taxRegime: row.taxRegime,
        cadastralSituation: row.lookup?.cadastralSituation ?? null,
      })),
  };
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

/** Inicia a preparação; nenhuma empresa existente é tocada nesta etapa. */
export async function startClientReplacementImport(
  formData: FormData,
): Promise<ActionResult<ClientImportProgress>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  if (!isAdminRole(ctx.role)) return err("Apenas admin/owner pode substituir a base.");

  const file = formData.get("file");
  if (!(file instanceof File)) return err("Selecione a planilha de clientes.");
  if (file.size === 0 || file.size > 5 * 1024 * 1024) {
    return err("A planilha precisa ter entre 1 byte e 5 MB.");
  }
  if (!/\.(xlsx|csv)$/i.test(file.name)) return err("Use uma planilha .xlsx ou .csv.");

  let sheetRows: ClientImportCellValue[][];
  try {
    sheetRows = await readSpreadsheetRows(file.name, Buffer.from(await file.arrayBuffer()));
  } catch {
    return err("Não consegui ler a planilha.");
  }
  const parsed = parseClientReplacementRows(sheetRows);
  if (parsed.rejected.length > 0) {
    const first = parsed.rejected[0];
    return err(`Corrija a linha ${first.rowNumber}: ${first.error}.`);
  }
  if (parsed.rows.length === 0) return err("Nenhuma empresa válida encontrada.");
  if (parsed.rows.length > 3000) return err("Importe no máximo 3000 empresas.");

  const rows: EnrichedClientImportRow[] = parsed.rows.map((row) => ({
    ...row,
    state: "pending",
    attempts: 0,
    lookup: null,
    taxRegime: null,
    error: null,
  }));
  const [batch] = await withOrgTx(ctx.orgId, (tx) =>
    tx.insert(schema.clientImportBatches).values({
      orgId: ctx.orgId,
      createdBy: ctx.userId,
      fileName: file.name,
      rows,
    }).returning({ id: schema.clientImportBatches.id, status: schema.clientImportBatches.status }),
  );
  return { ok: true, data: progressOf(batch.id, batch.status, rows) };
}

const batchSchema = z.object({ batchId: z.uuid() });

export async function getLatestClientReplacementImport(): Promise<
  ActionResult<ClientImportProgress | null>
> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  if (!isAdminRole(ctx.role)) return err("Apenas admin/owner pode substituir a base.");
  const batch = await withOrgTx(ctx.orgId, (tx) => tx.query.clientImportBatches.findFirst({
    where: and(
      eq(schema.clientImportBatches.orgId, ctx.orgId),
      ne(schema.clientImportBatches.status, "completed"),
    ),
    orderBy: [desc(schema.clientImportBatches.createdAt)],
  }));
  if (!batch) return { ok: true, data: null };
  return {
    ok: true,
    data: progressOf(
      batch.id,
      batch.status === "cooldown" ? "processing" : batch.status,
      batch.rows as EnrichedClientImportRow[],
    ),
  };
}

export async function processClientReplacementImport(
  input: z.input<typeof batchSchema>,
): Promise<ActionResult<ClientImportProgress>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  if (!isAdminRole(ctx.role)) return err("Apenas admin/owner pode substituir a base.");
  const parsed = batchSchema.safeParse(input);
  if (!parsed.success) return err("Lote inválido.");

  const batch = await withOrgTx(ctx.orgId, (tx) => tx.query.clientImportBatches.findFirst({
    where: and(
      eq(schema.clientImportBatches.id, parsed.data.batchId),
      eq(schema.clientImportBatches.orgId, ctx.orgId),
    ),
  }));
  if (!batch) return err("Lote não encontrado.");
  if (batch.status === "completed") return err("Este lote já foi importado.");

  const rows = batch.rows as EnrichedClientImportRow[];
  const indexes = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.state === "pending")
    .slice(0, 1);
  const consulted = await Promise.all(indexes.map(async ({ row, index }) => ({
    index,
    result: await lookupCnpj(row.cnpj),
  })));
  let retryAfterSeconds = 0;
  for (const item of consulted) {
    const current = rows[item.index];
    current.attempts += 1;
    if (item.result.ok) {
      current.state = "consulted";
      current.lookup = item.result.data;
      current.taxRegime = inferTaxRegime(item.result.data);
      current.error = null;
    } else if (item.result.reason === "not_found") {
      current.state = "error";
      current.error = "CNPJ não encontrado na consulta pública";
    } else if (item.result.reason === "rate_limited") {
      current.state = "pending";
      current.error = null;
      retryAfterSeconds = Math.min(300, 30 * (2 ** Math.min(current.attempts - 1, 3)));
    } else if (current.attempts < 3) {
      current.state = "pending";
      current.error = null;
      retryAfterSeconds = 15 * current.attempts;
    } else {
      current.state = "error";
      current.error = "Serviço de consulta indisponível; tente novamente mais tarde";
    }
  }
  const hasPending = rows.some((row) => row.state === "pending");
  const needsReview = rows.some((row) => row.state === "error" || !row.taxRegime);
  const status = retryAfterSeconds > 0
    ? "cooldown"
    : hasPending
      ? "processing"
      : needsReview
        ? "review"
        : "ready";
  await withOrgTx(ctx.orgId, (tx) => tx.update(schema.clientImportBatches)
    .set({ rows, status, updatedAt: new Date() })
    .where(and(
      eq(schema.clientImportBatches.id, batch.id),
      eq(schema.clientImportBatches.orgId, ctx.orgId),
    )));
  return { ok: true, data: progressOf(batch.id, status, rows, retryAfterSeconds) };
}

export async function retryClientReplacementLookups(
  input: z.input<typeof batchSchema>,
): Promise<ActionResult<ClientImportProgress>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  if (!isAdminRole(ctx.role)) return err("Apenas admin/owner pode substituir a base.");
  const parsed = batchSchema.safeParse(input);
  if (!parsed.success) return err("Lote inválido.");
  const result = await withOrgTx(ctx.orgId, async (tx) => {
    const batch = await tx.query.clientImportBatches.findFirst({
      where: and(eq(schema.clientImportBatches.id, parsed.data.batchId), eq(schema.clientImportBatches.orgId, ctx.orgId)),
    });
    if (!batch) return null;
    const rows = batch.rows as EnrichedClientImportRow[];
    for (const row of rows) {
      if (row.state === "error") {
        row.state = "pending";
        row.attempts = 0;
        row.error = null;
      }
    }
    await tx.update(schema.clientImportBatches).set({ rows, status: "processing", updatedAt: new Date() })
      .where(eq(schema.clientImportBatches.id, batch.id));
    return progressOf(batch.id, "processing", rows);
  });
  return result ? { ok: true, data: result } : err("Lote não encontrado.");
}

const rowRegimeSchema = z.object({
  batchId: z.uuid(),
  rowNumber: z.number().int().positive(),
  taxRegime: z.enum(TAX_REGIMES),
});

export async function setClientReplacementRowRegime(
  input: z.input<typeof rowRegimeSchema>,
): Promise<ActionResult<ClientImportProgress>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  if (!isAdminRole(ctx.role)) return err("Apenas admin/owner pode substituir a base.");
  const parsed = rowRegimeSchema.safeParse(input);
  if (!parsed.success) return err("Revisão inválida.");
  const result = await withOrgTx(ctx.orgId, async (tx) => {
    const batch = await tx.query.clientImportBatches.findFirst({
      where: and(eq(schema.clientImportBatches.id, parsed.data.batchId), eq(schema.clientImportBatches.orgId, ctx.orgId)),
    });
    if (!batch) return null;
    const rows = batch.rows as EnrichedClientImportRow[];
    const row = rows.find((candidate) => candidate.rowNumber === parsed.data.rowNumber);
    if (!row || row.state !== "consulted") return null;
    row.taxRegime = parsed.data.taxRegime;
    const status = rows.every((candidate) => candidate.state === "consulted" && candidate.taxRegime) ? "ready" : "review";
    await tx.update(schema.clientImportBatches).set({ rows, status, updatedAt: new Date() })
      .where(eq(schema.clientImportBatches.id, batch.id));
    return progressOf(batch.id, status, rows);
  });
  return result ? { ok: true, data: result } : err("Empresa ou lote não encontrado.");
}

const finalizeReplacementSchema = z.object({
  batchId: z.uuid(),
  confirmation: z.literal("ZERAR E IMPORTAR"),
});

export async function finalizeClientReplacementImport(
  input: z.input<typeof finalizeReplacementSchema>,
): Promise<ActionResult<{ imported: number; inactive: number }>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  if (!isAdminRole(ctx.role)) return err("Apenas admin/owner pode substituir a base.");
  const parsed = finalizeReplacementSchema.safeParse(input);
  if (!parsed.success) return err('Digite exatamente "ZERAR E IMPORTAR".');

  const finalizationState: {
    stage: "validating" | "resetting" | "importing";
  } = { stage: "validating" };
  let result: { imported: number; inactive: number } | null;
  try {
    result = await withOrgTx(ctx.orgId, async (tx) => {
      const [batch] = await tx.select().from(schema.clientImportBatches)
        .where(and(eq(schema.clientImportBatches.id, parsed.data.batchId), eq(schema.clientImportBatches.orgId, ctx.orgId)))
        .for("update");
      if (!batch) return null;
      const rows = batch.rows as EnrichedClientImportRow[];
      if (!rows.every((row) => row.state === "consulted" && row.lookup && row.taxRegime)) return null;

      finalizationState.stage = "resetting";
      await tx.execute(sql`SELECT reset_org_operational_data_for_launch(${ctx.orgId})`);
      finalizationState.stage = "importing";
      const now = new Date();
      await tx.insert(schema.clients).values(rows.map((row) => {
        const lookup = row.lookup!;
        return {
          orgId: ctx.orgId,
          name: lookup.legalName,
          tradeName: lookup.tradeName,
          taxRegime: row.taxRegime!,
          cnpj: row.cnpj,
          operationalEmail: row.operationalEmail,
          operationalPhone: row.operationalPhone,
          revenueEmail: lookup.email,
          revenuePhones: lookup.phones,
          address: lookup.address,
          cadastralSituation: lookup.cadastralSituation,
          cadastralSituationDate: lookup.cadastralSituationDate,
          companySize: lookup.companySize,
          legalNature: lookup.legalNature,
          shareCapital: lookup.shareCapital,
          headquartersType: lookup.headquartersType,
          cnaeCode: lookup.cnaeCode,
          cnaeDescription: lookup.cnaeDescription,
          secondaryCnaes: lookup.secondaryCnaes,
          openedAt: lookup.openedAt,
          qsa: lookup.qsa,
          taxRegimeHistory: lookup.taxRegimes,
          cnpjSyncedAt: now,
          active: lookup.cadastralSituation?.toUpperCase() === "ATIVA",
        };
      }));
      return {
        imported: rows.length,
        inactive: rows.filter((row) => row.lookup?.cadastralSituation?.toUpperCase() !== "ATIVA").length,
      };
    });
  } catch (error) {
    const cause = (error as {
      cause?: { code?: string; constraint?: string; table?: string; routine?: string };
    })?.cause;
    console.error("Client replacement finalization failed", {
      stage: finalizationState.stage,
      code: cause?.code,
      constraint: cause?.constraint,
      table: cause?.table,
      routine: cause?.routine,
    });
    return err(
      finalizationState.stage === "resetting"
        ? "Não foi possível limpar os dados de teste. A importação não foi aplicada; tente novamente após a implantação terminar."
        : finalizationState.stage === "importing"
          ? "Não foi possível gravar a nova base. A limpeza foi desfeita e nenhum dado foi perdido."
          : "Não foi possível validar o lote para importação.",
    );
  }
  if (!result) return err("O lote ainda possui consultas ou regimes pendentes.");
  revalidatePath("/", "layout");
  return { ok: true, data: result };
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
 * mensagem "vai apagar N missões, M fechamentos, P distribuições" antes do
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
 * histórico de carteira e distribuições somem junto (ON DELETE CASCADE nas
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
