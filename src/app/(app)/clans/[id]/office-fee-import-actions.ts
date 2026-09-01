"use server";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { readSheet } from "read-excel-file/node";
import { z } from "zod";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { formatCnpj } from "@/domain/cnpj";
import {
  hasDuplicateFiscalImportTargets,
  normalizeCompanyName,
  reconcileCompanyName,
} from "@/domain/fiscal-import";
import {
  parseOfficeFeeSpreadsheetRows,
  type ParsedOfficeFeeImportRow,
} from "@/domain/office-fee-import";
import { officeFeeProfileVersionMatches } from "@/domain/office-fee-control";
import { canManageFiscalOperations } from "@/domain/guild-permissions";
import { err, requireMemberContext, type ActionResult } from "@/lib/action-context";
import { loadClanScopedFacts } from "@/lib/clans/facts";
import { lockActiveClansForMembershipRead } from "@/lib/clans/locks";
import { FISCAL_CLAN_SLUG } from "@/lib/clans/rules";
import { officeFeeProfileSnapshot } from "@/lib/office-fees/materialize";

interface ImportSuggestionView {
  clientId: string;
  clientName: string;
  score: number;
  reasons: readonly string[];
}

export interface OfficeFeeImportPreviewRow {
  id: string;
  rowNumber: number;
  sourceName: string;
  status: "matched" | "suggested" | "ambiguous" | "pending";
  explanation: string;
  issues: readonly { field: string; raw: string | null; message: string }[];
  suggestedClientId: string | null;
  suggestions: readonly ImportSuggestionView[];
  imported: {
    cnpj: string | null;
    billingMethod: string | null;
    chargesAdditionalInstallment: boolean | null;
    monthlyFee: string | null;
    observations: string | null;
  };
}

export interface OfficeFeeImportPreview {
  batchId: string;
  fileName: string;
  rows: readonly OfficeFeeImportPreviewRow[];
  clients: readonly {
    id: string;
    name: string;
    cnpj: string | null;
    active: boolean;
    profile: {
      version: number;
      billingMethod: string;
      chargesAdditionalInstallment: boolean;
      monthlyFee: string;
      observations: string | null;
    } | null;
  }[];
  missingColumns: readonly string[];
  rejected: number;
  rejectedRows: readonly { rowNumber: number; message: string }[];
  skipped: number;
}

const previewSchema = z.object({ clanId: z.uuid("Clã inválido.") });

async function assertFiscalManager(
  tx: Parameters<Parameters<typeof withOrgTx>[1]>[0],
  ctx: { orgId: string; userId: string; role: Parameters<typeof loadClanScopedFacts>[4] },
  clanId: string,
) {
  await lockActiveClansForMembershipRead(tx, ctx.orgId);
  const loaded = await loadClanScopedFacts(tx, ctx.orgId, clanId, ctx.userId, ctx.role);
  return Boolean(
    loaded.clan?.slug === FISCAL_CLAN_SLUG && canManageFiscalOperations(loaded.facts),
  );
}

function jsonSafeCells(cells: readonly unknown[]): unknown[] {
  return cells.map((cell) =>
    cell instanceof Date
      ? cell.toISOString()
      : typeof cell === "string" || typeof cell === "number" || typeof cell === "boolean" || cell === null
        ? cell
        : cell === undefined
          ? null
          : String(cell),
  );
}

function compactImported(parsed: ParsedOfficeFeeImportRow) {
  return {
    cnpj: parsed.cnpj,
    billingMethod: parsed.billingMethod,
    chargesAdditionalInstallment: parsed.chargesAdditionalInstallment,
    monthlyFee: parsed.monthlyFee,
    observations: parsed.observations,
  };
}

export async function previewOfficeFeeSpreadsheet(
  formData: FormData,
): Promise<ActionResult<OfficeFeeImportPreview>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsedInput = previewSchema.safeParse({ clanId: formData.get("clanId") });
  if (!parsedInput.success) return err("Clã inválido.");
  const clanId = parsedInput.data.clanId;
  const authorized = await withOrgTx(ctx.orgId, (tx) => assertFiscalManager(tx, ctx, clanId));
  if (!authorized) return err("Apenas integrantes do Fiscal ou um admin podem importar honorários.");

  const file = formData.get("file");
  if (!(file instanceof File)) return err("Selecione uma planilha.");
  if (file.size === 0) return err("A planilha está vazia.");
  if (file.size > 5 * 1024 * 1024) return err("A planilha precisa ter até 5 MB.");
  if (!file.name.toLowerCase().endsWith(".xlsx")) return err("Use a planilha em formato .xlsx.");

  let sheet: unknown[][];
  try {
    sheet = await readSheet(Buffer.from(await file.arrayBuffer()));
  } catch {
    return err("Não consegui ler a planilha. Confirme se o arquivo .xlsx está íntegro.");
  }
  if (sheet.length > 5000 || sheet.reduce((sum, row) => sum + row.length, 0) > 100_000) {
    return err("A planilha é grande demais. Reduza para até 5.000 linhas e 100.000 células.");
  }
  const parsedSheet = parseOfficeFeeSpreadsheetRows(sheet);
  if (parsedSheet.errors.length > 0) return err(parsedSheet.errors[0] ?? "Planilha inválida.");
  if (parsedSheet.rows.length === 0) return err("Nenhuma linha de honorário encontrada.");
  if (parsedSheet.rows.length > 1000) return err("Importe no máximo 1000 empresas por arquivo.");

  return withOrgTx(ctx.orgId, async (tx): Promise<ActionResult<OfficeFeeImportPreview>> => {
    if (!(await assertFiscalManager(tx, ctx, clanId))) {
      return err("Apenas integrantes do Fiscal ou um admin podem concluir a prévia.");
    }
    const clients = await tx
      .select({
        id: schema.clients.id,
        name: schema.clients.name,
        cnpj: schema.clients.cnpj,
        active: schema.clients.active,
        profileId: schema.officeFeeProfiles.id,
        profileVersion: schema.officeFeeProfiles.version,
        billingMethod: schema.officeFeeProfiles.billingMethod,
        chargesAdditionalInstallment: schema.officeFeeProfiles.chargesAdditionalInstallment,
        monthlyFee: schema.officeFeeProfiles.monthlyFee,
        observations: schema.officeFeeProfiles.permanentNotes,
      })
      .from(schema.clients)
      .leftJoin(
        schema.officeFeeProfiles,
        and(
          eq(schema.officeFeeProfiles.orgId, schema.clients.orgId),
          eq(schema.officeFeeProfiles.clientId, schema.clients.id),
        ),
      )
      .where(eq(schema.clients.orgId, ctx.orgId))
      .orderBy(asc(schema.clients.name));
    const aliases = await tx
      .select({
        id: schema.fiscalClientAliases.id,
        clientId: schema.fiscalClientAliases.clientId,
        aliasName: schema.fiscalClientAliases.aliasName,
        normalizedName: schema.fiscalClientAliases.normalizedName,
      })
      .from(schema.fiscalClientAliases)
      .where(eq(schema.fiscalClientAliases.orgId, ctx.orgId));
    const aliasesByClient = new Map<string, string[]>();
    for (const alias of aliases) {
      aliasesByClient.set(alias.clientId, [...(aliasesByClient.get(alias.clientId) ?? []), alias.aliasName]);
    }
    const aliasIdByNormalized = new Map(aliases.map((alias) => [alias.normalizedName, alias.id]));
    const cnpjCandidates = new Map(
      clients.filter((client) => client.cnpj).map((client) => [client.cnpj!, client]),
    );
    const candidates = clients.map((client) => ({
      id: client.id,
      name: client.name,
      aliases: aliasesByClient.get(client.id) ?? [],
    }));
    const reconciled = parsedSheet.rows.map((row) => {
      const cnpjClient = row.parsed.cnpj ? cnpjCandidates.get(row.parsed.cnpj) : null;
      if (cnpjClient) {
        return {
          row,
          match: {
            status: "exact" as const,
            exactMatch: {
              clientId: cnpjClient.id,
              clientName: cnpjClient.name,
              score: 1,
              matchedAlias: null,
              reasons: [{ code: "exact_name" as const, label: "CNPJ idêntico" }],
            },
            suggestions: [],
            explanation: "CNPJ idêntico ao cadastro da empresa.",
          },
          method: "exact_cnpj" as const,
        };
      }
      return {
        row,
        match: reconcileCompanyName(row.parsed.companyName ?? "", candidates),
        method: null,
      };
    });
    const matchedRows = reconciled.filter(({ match }) => match.status === "exact").length;
    const [batch] = await tx
      .insert(schema.fiscalImportBatches)
      .values({
        orgId: ctx.orgId,
        fileName: file.name.slice(0, 255),
        kind: "office_fee",
        status: "reconciling",
        totalRows: reconciled.length,
        matchedRows,
        pendingRows: reconciled.length - matchedRows,
        errorRows: parsedSheet.rejectedRows.length,
        createdBy: ctx.userId,
      })
      .returning({ id: schema.fiscalImportBatches.id });
    const inserted = await tx
      .insert(schema.fiscalImportRows)
      .values(
        reconciled.map(({ row, match, method }) => {
          const exact = match.exactMatch;
          const best = exact ?? match.suggestions[0] ?? null;
          const normalized = row.parsed.normalizedCompanyName.canonical;
          return {
            orgId: ctx.orgId,
            batchId: batch.id,
            rowNumber: row.rowNumber,
            sourceName: (row.parsed.companyName ?? "").slice(0, 240),
            normalizedSourceName: normalized.slice(0, 240),
            rawData: {
              cells: jsonSafeCells(row.rawData),
              parsed: compactImported(row.parsed),
              issues: row.parsed.issues,
              explanation: match.explanation,
              suggestions: match.suggestions,
            },
            status: exact ? "matched" as const : best ? "suggested" as const : "pending" as const,
            suggestedClientId: best?.clientId ?? null,
            resolvedClientId: exact?.clientId ?? null,
            resolvedAliasId: exact?.matchedAlias
              ? aliasIdByNormalized.get(normalizeCompanyName(exact.matchedAlias).canonical) ?? null
              : null,
            matchConfidence: best ? best.score.toFixed(4) : null,
            resolutionMethod: exact
              ? method ?? (exact.matchedAlias ? "exact_alias" as const : "exact_name" as const)
              : best
                ? "fuzzy" as const
                : null,
            resolvedBy: exact ? ctx.userId : null,
          };
        }),
      )
      .returning({ id: schema.fiscalImportRows.id, rowNumber: schema.fiscalImportRows.rowNumber });
    const idByRow = new Map(inserted.map((row) => [row.rowNumber, row.id]));
    await tx.update(schema.fiscalImportBatches).set({ status: "ready", updatedAt: new Date() }).where(
      and(eq(schema.fiscalImportBatches.orgId, ctx.orgId), eq(schema.fiscalImportBatches.id, batch.id)),
    );
    return {
      ok: true,
      data: {
        batchId: batch.id,
        fileName: file.name,
        clients: clients.map((client) => ({
          id: client.id,
          name: client.name,
          cnpj: client.cnpj,
          active: client.active,
          profile: client.profileId
            ? {
                version: client.profileVersion!,
                billingMethod: client.billingMethod!,
                chargesAdditionalInstallment: client.chargesAdditionalInstallment!,
                monthlyFee: client.monthlyFee!,
                observations: client.observations,
              }
            : null,
        })),
        missingColumns: parsedSheet.missingColumns,
        rejected: parsedSheet.rejectedRows.length,
        rejectedRows: parsedSheet.rejectedRows,
        skipped: parsedSheet.skippedRows.length,
        rows: reconciled.map(({ row, match }) => ({
          id: idByRow.get(row.rowNumber)!,
          rowNumber: row.rowNumber,
          sourceName: row.parsed.companyName ?? "",
          status: match.status === "exact" ? "matched" : match.status === "ambiguous" ? "ambiguous" : match.suggestions.length > 0 ? "suggested" : "pending",
          explanation: match.explanation,
          issues: row.parsed.issues,
          suggestedClientId: (match.exactMatch ?? match.suggestions[0])?.clientId ?? null,
          suggestions: match.suggestions.map((suggestion) => ({
            clientId: suggestion.clientId,
            clientName: suggestion.clientName,
            score: suggestion.score,
            reasons: suggestion.reasons.map((reason) => reason.label),
          })),
          imported: compactImported(row.parsed),
        })),
      },
    };
  });
}

const applySchema = z.object({
  clanId: z.uuid("Clã inválido."),
  batchId: z.uuid("Lote inválido."),
  resolutions: z.array(
    z.discriminatedUnion("action", [
      z.object({ rowId: z.uuid(), action: z.literal("ignore") }),
      z.object({
        rowId: z.uuid(),
        action: z.literal("apply"),
        clientId: z.uuid(),
        expectedProfileVersion: z.number().int().min(1).nullable(),
      }),
    ]),
  ).min(1).max(1000),
});

export interface OfficeFeeImportApplyResult {
  imported: number;
  ignored: number;
  errors: number;
  createdProfiles: number;
  updatedProfiles: number;
  unchangedProfiles: number;
  cnpjsAdded: number;
}

export async function applyOfficeFeeImport(
  input: z.input<typeof applySchema>,
): Promise<ActionResult<OfficeFeeImportApplyResult>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsed = applySchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Conciliação inválida.");
  const data = parsed.data;
  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult<OfficeFeeImportApplyResult>> => {
    if (!(await assertFiscalManager(tx, ctx, data.clanId))) {
      return err("Apenas integrantes do Fiscal ou um admin podem concluir a importação.");
    }
    const [batch] = await tx.select().from(schema.fiscalImportBatches).where(
      and(
        eq(schema.fiscalImportBatches.orgId, ctx.orgId),
        eq(schema.fiscalImportBatches.id, data.batchId),
        eq(schema.fiscalImportBatches.kind, "office_fee"),
      ),
    ).for("update");
    if (!batch) return err("Lote de honorários não encontrado.");
    if (batch.status === "completed") return err("Este lote já foi aplicado.");
    if (batch.status !== "ready") return err("Este lote ainda não está pronto para aplicação.");
    const rowIds = [...new Set(data.resolutions.map((item) => item.rowId))];
    if (rowIds.length !== data.resolutions.length || rowIds.length !== batch.totalRows) {
      return err("Revise todas as linhas do lote uma única vez antes de aplicar.");
    }
    const targets = data.resolutions.flatMap((item) => item.action === "apply" ? [item.clientId] : []);
    if (hasDuplicateFiscalImportTargets(targets)) {
      return err("Mais de uma linha foi conciliada com a mesma empresa. Ignore a duplicada ou revise o arquivo.");
    }
    const rows = await tx.select().from(schema.fiscalImportRows).where(
      and(
        eq(schema.fiscalImportRows.orgId, ctx.orgId),
        eq(schema.fiscalImportRows.batchId, batch.id),
        inArray(schema.fiscalImportRows.id, rowIds),
      ),
    ).for("update");
    if (rows.length !== rowIds.length) return err("Uma ou mais linhas não pertencem a este lote.");
    const rowById = new Map(rows.map((row) => [row.id, row]));
    for (const key of [...new Set(rows.flatMap((row) => {
      const parsedRow = (row.rawData as { parsed?: { cnpj?: string | null } }).parsed;
      return [row.normalizedSourceName, parsedRow?.cnpj ? `cnpj:${parsedRow.cnpj}` : null].filter(Boolean) as string[];
    }))].sort()) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${ctx.orgId}:${key}`}))`);
    }
    const clients = targets.length > 0
      ? await tx.select({ id: schema.clients.id, cnpj: schema.clients.cnpj }).from(schema.clients).where(
          and(eq(schema.clients.orgId, ctx.orgId), inArray(schema.clients.id, [...new Set(targets)])),
        ).orderBy(asc(schema.clients.id)).for("update")
      : [];
    const clientById = new Map(clients.map((client) => [client.id, client]));
    if (clientById.size !== new Set(targets).size) return err("Uma das empresas selecionadas não pertence à organização.");
    const aliases = await tx.select({ normalizedName: schema.fiscalClientAliases.normalizedName, clientId: schema.fiscalClientAliases.clientId }).from(schema.fiscalClientAliases).where(
      and(eq(schema.fiscalClientAliases.orgId, ctx.orgId), inArray(schema.fiscalClientAliases.normalizedName, rows.map((row) => row.normalizedSourceName))),
    );
    const aliasByName = new Map(aliases.map((alias) => [alias.normalizedName, alias.clientId]));
    const resolutions = new Map(data.resolutions.map((item) => [item.rowId, item]));
    for (const row of rows) {
      const resolution = resolutions.get(row.id);
      if (!resolution || resolution.action === "ignore") continue;
      const existingTarget = aliasByName.get(row.normalizedSourceName);
      if (existingTarget && existingTarget !== resolution.clientId) {
        return err(`Linha ${row.rowNumber}: este nome já está conciliado com outra empresa.`);
      }
    }

    let imported = 0;
    let ignored = 0;
    let createdProfiles = 0;
    let updatedProfiles = 0;
    let unchangedProfiles = 0;
    let cnpjsAdded = 0;
    for (const resolution of data.resolutions) {
      const row = rowById.get(resolution.rowId)!;
      if (resolution.action === "ignore") {
        await tx.update(schema.fiscalImportRows).set({ status: "ignored", resolvedBy: ctx.userId, updatedAt: new Date() }).where(eq(schema.fiscalImportRows.id, row.id));
        ignored += 1;
        continue;
      }
      const client = clientById.get(resolution.clientId);
      if (!client) return err("Empresa selecionada não pertence à organização.");
      const raw = row.rawData as { parsed?: Record<string, unknown> };
      const values = raw.parsed ?? {};
      const sourceCnpj = typeof values.cnpj === "string" ? values.cnpj : null;
      if (sourceCnpj && client.cnpj && client.cnpj !== sourceCnpj) {
        return err(`Linha ${row.rowNumber}: o CNPJ ${formatCnpj(sourceCnpj)} diverge do cadastro desta empresa.`);
      }
      if (sourceCnpj && !client.cnpj) {
        const [holder] = await tx.select({ id: schema.clients.id }).from(schema.clients).where(
          and(eq(schema.clients.orgId, ctx.orgId), eq(schema.clients.cnpj, sourceCnpj)),
        ).for("update");
        if (holder && holder.id !== client.id) return err(`Linha ${row.rowNumber}: o CNPJ já pertence a outra empresa cadastrada.`);
        await tx.update(schema.clients).set({ cnpj: sourceCnpj }).where(
          and(eq(schema.clients.orgId, ctx.orgId), eq(schema.clients.id, client.id)),
        );
        cnpjsAdded += 1;
      }
      const [profile] = await tx.select().from(schema.officeFeeProfiles).where(
        and(eq(schema.officeFeeProfiles.orgId, ctx.orgId), eq(schema.officeFeeProfiles.clientId, client.id)),
      ).for("update");
      if (!officeFeeProfileVersionMatches(profile?.version, resolution.expectedProfileVersion)) {
        return err(`Linha ${row.rowNumber}: o cadastro de honorário mudou depois da prévia. Gere uma nova prévia.`);
      }
      const billingMethod = values.billingMethod;
      const chargesAdditionalInstallment = values.chargesAdditionalInstallment;
      const monthlyFee = values.monthlyFee;
      if (
        !["asaas", "recibo", "pix", "other"].includes(String(billingMethod)) ||
        typeof chargesAdditionalInstallment !== "boolean" ||
        typeof monthlyFee !== "string" ||
        !/^\d+(?:\.\d{1,2})?$/.test(monthlyFee)
      ) return err(`Linha ${row.rowNumber}: os dados de honorário originais são inválidos.`);
      const next = {
        billingMethod: billingMethod as schema.OfficeFeeProfile["billingMethod"],
        chargesAdditionalInstallment,
        monthlyFee,
        permanentNotes: typeof values.observations === "string" && values.observations.trim() ? values.observations.trim() : null,
        updatedBy: ctx.userId,
        updatedAt: new Date(),
      };
      const changedFields = profile
        ? [
            ["billingMethod", profile.billingMethod, next.billingMethod],
            ["chargesAdditionalInstallment", profile.chargesAdditionalInstallment, next.chargesAdditionalInstallment],
            ["monthlyFee", profile.monthlyFee, next.monthlyFee],
            ["permanentNotes", profile.permanentNotes ?? "", next.permanentNotes ?? ""],
          ].filter(([, before, after]) => before !== after).map((entry) => String(entry[0]))
        : ["billingMethod", "chargesAdditionalInstallment", "monthlyFee", "permanentNotes"];
      let saved = profile;
      if (!profile) {
        [saved] = await tx.insert(schema.officeFeeProfiles).values({
          orgId: ctx.orgId,
          clientId: client.id,
          ...next,
          createdBy: ctx.userId,
        }).returning();
        createdProfiles += 1;
      } else if (changedFields.length > 0) {
        [saved] = await tx.update(schema.officeFeeProfiles).set({ ...next, version: profile.version + 1 }).where(
          and(eq(schema.officeFeeProfiles.orgId, ctx.orgId), eq(schema.officeFeeProfiles.id, profile.id)),
        ).returning();
        updatedProfiles += 1;
      } else {
        unchangedProfiles += 1;
      }
      if (!saved) throw new Error("Não foi possível salvar o honorário.");
      if (!profile || changedFields.length > 0) {
        await tx.insert(schema.officeFeeProfileEvents).values({
          orgId: ctx.orgId,
          profileId: saved.id,
          clientId: saved.clientId,
          eventType: "imported",
          version: saved.version,
          snapshot: officeFeeProfileSnapshot(saved),
          changedFields,
          actorId: ctx.userId,
        });
      }
      const [alias] = await tx.insert(schema.fiscalClientAliases).values({
        orgId: ctx.orgId,
        clientId: client.id,
        aliasName: row.sourceName,
        normalizedName: row.normalizedSourceName,
        source: "import_reconciliation",
        createdBy: ctx.userId,
      }).onConflictDoUpdate({
        target: [schema.fiscalClientAliases.orgId, schema.fiscalClientAliases.normalizedName],
        set: { clientId: client.id },
      }).returning();
      const method = row.resolvedClientId === client.id && row.resolutionMethod
        ? row.resolutionMethod
        : row.suggestedClientId === client.id
          ? "fuzzy"
          : "manual";
      await tx.update(schema.fiscalImportRows).set({
        status: "imported",
        resolvedClientId: client.id,
        resolvedAliasId: alias.id,
        resolutionMethod: method,
        resolvedBy: ctx.userId,
        appliedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(schema.fiscalImportRows.id, row.id));
      imported += 1;
    }
    const errors = batch.errorRows;
    await tx.update(schema.fiscalImportBatches).set({
      status: "completed",
      matchedRows: imported,
      pendingRows: 0,
      ignoredRows: ignored,
      errorRows: errors,
      report: {
        totalRows: data.resolutions.length + batch.errorRows,
        matchedRows: imported,
        pendingRows: 0,
        ignoredRows: ignored,
        errorRows: errors,
        createdProfiles,
        updatedProfiles,
        unchangedProfiles,
        rejectedRows: batch.errorRows,
      },
      completedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(eq(schema.fiscalImportBatches.orgId, ctx.orgId), eq(schema.fiscalImportBatches.id, batch.id)));
    return { ok: true, data: { imported, ignored, errors, createdProfiles, updatedProfiles, unchangedProfiles, cnpjsAdded } };
  });
  if (result.ok) revalidatePath(`/clans/${data.clanId}`);
  return result;
}
