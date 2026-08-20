"use server";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { readSheet } from "read-excel-file/node";
import { z } from "zod";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import {
  fiscalImportSourceRowTotal,
  hasDuplicateFiscalImportTargets,
  normalizeCompanyName,
  parseFiscalSpreadsheetRows,
  reconcileCompanyName,
  type ParsedFiscalImportRow,
} from "@/domain/fiscal-import";
import { fiscalProfileVersionMatches } from "@/domain/fiscal-control";
import { canManageFiscalOperations } from "@/domain/guild-permissions";
import {
  err,
  requireMemberContext,
  type ActionResult,
} from "@/lib/action-context";
import { loadClanScopedFacts } from "@/lib/clans/facts";
import { lockActiveClansForMembershipRead } from "@/lib/clans/locks";
import { FISCAL_CLAN_SLUG } from "@/lib/clans/rules";
import { fiscalProfileSnapshot } from "@/lib/fiscal/materialize";

interface ImportSuggestionView {
  clientId: string;
  clientName: string;
  score: number;
  reasons: readonly string[];
}

export interface FiscalImportPreviewRow {
  id: string;
  rowNumber: number;
  sourceName: string;
  status: "matched" | "suggested" | "ambiguous" | "pending";
  explanation: string;
  issues: readonly { field: string; raw: string | null; message: string }[];
  suggestedClientId: string | null;
  suggestions: readonly ImportSuggestionView[];
  imported: {
    movements: string | null;
    incoming: string | null;
    outgoing: string | null;
    guide: string | null;
    delivery: string | null;
    nfs: string | null;
    observations: string | null;
  };
}

export interface FiscalImportPreview {
  batchId: string;
  fileName: string;
  rows: readonly FiscalImportPreviewRow[];
  clients: readonly {
    id: string;
    name: string;
    active: boolean;
    profile: {
      version: number;
      movements: string;
      incoming: string;
      outgoing: string;
      guide: string;
      delivery: string | null;
      nfs: string;
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

function compactImported(parsed: ParsedFiscalImportRow) {
  return {
    movements: parsed.movements.value,
    incoming: parsed.incoming.value,
    outgoing: parsed.outgoing.value,
    guide: parsed.guide.value,
    delivery: parsed.delivery.detail,
    nfs: parsed.nfs.value,
    observations: parsed.observations,
  };
}

export async function previewFiscalSpreadsheet(
  formData: FormData,
): Promise<ActionResult<FiscalImportPreview>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsedInput = previewSchema.safeParse({ clanId: formData.get("clanId") });
  if (!parsedInput.success) return err("Clã inválido.");
  const clanId = parsedInput.data.clanId;
  const authorized = await withOrgTx(ctx.orgId, (tx) =>
    assertFiscalManager(tx, ctx, clanId),
  );
  if (!authorized) {
    return err("Apenas a liderança do Fiscal ou um admin pode importar a planilha.");
  }

  const file = formData.get("file");
  if (!(file instanceof File)) return err("Selecione uma planilha.");
  if (file.size === 0) return err("A planilha está vazia.");
  if (file.size > 5 * 1024 * 1024) return err("A planilha precisa ter até 5 MB.");
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return err("Use a planilha fiscal em formato .xlsx.");
  }

  let sheet: unknown[][];
  try {
    sheet = await readSheet(Buffer.from(await file.arrayBuffer()));
  } catch {
    return err("Não consegui ler a planilha. Confirme se o arquivo .xlsx está íntegro.");
  }
  if (
    sheet.length > 5000 ||
    sheet.reduce((total, row) => total + row.length, 0) > 100_000
  ) {
    return err("A planilha é grande demais. Reduza para até 5.000 linhas e 100.000 células.");
  }
  const parsedSheet = parseFiscalSpreadsheetRows(sheet);
  if (parsedSheet.errors.length > 0) return err(parsedSheet.errors[0] ?? "Planilha inválida.");
  if (parsedSheet.rows.length === 0) return err("Nenhuma linha de empresa encontrada.");
  if (parsedSheet.rows.length > 1000) return err("Importe no máximo 1000 empresas por arquivo.");

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult<FiscalImportPreview>> => {
    if (!(await assertFiscalManager(tx, ctx, clanId))) {
      return err("Apenas a liderança do Fiscal ou um admin pode importar a planilha.");
    }
    const clients = await tx
      .select({
        id: schema.clients.id,
        name: schema.clients.name,
        active: schema.clients.active,
        profileId: schema.fiscalClientProfiles.id,
        profileVersion: schema.fiscalClientProfiles.version,
        movements: schema.fiscalClientProfiles.movementsApplicability,
        incoming: schema.fiscalClientProfiles.incomingApplicability,
        outgoing: schema.fiscalClientProfiles.outgoingApplicability,
        guide: schema.fiscalClientProfiles.guideApplicability,
        delivery: schema.fiscalClientProfiles.deliveryChannel,
        nfs: schema.fiscalClientProfiles.nfsApplicability,
        observations: schema.fiscalClientProfiles.permanentNotes,
      })
      .from(schema.clients)
      .leftJoin(
        schema.fiscalClientProfiles,
        and(
          eq(schema.fiscalClientProfiles.orgId, schema.clients.orgId),
          eq(schema.fiscalClientProfiles.clientId, schema.clients.id),
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
      aliasesByClient.set(alias.clientId, [
        ...(aliasesByClient.get(alias.clientId) ?? []),
        alias.aliasName,
      ]);
    }
    const aliasIdByNormalized = new Map(
      aliases.map((alias) => [alias.normalizedName, alias.id]),
    );
    const candidates = clients.map((client) => ({
      id: client.id,
      name: client.name,
      aliases: aliasesByClient.get(client.id) ?? [],
    }));
    const reconciled = parsedSheet.rows.map((row) => ({
      row,
      match: reconcileCompanyName(row.parsed.companyName ?? "", candidates),
    }));
    const matchedRows = reconciled.filter(({ match }) => match.status === "exact").length;
    const [batch] = await tx
      .insert(schema.fiscalImportBatches)
      .values({
        orgId: ctx.orgId,
        fileName: file.name.slice(0, 255),
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
        reconciled.map(({ row, match }) => {
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
            resolvedAliasId: exact?.matchedAlias ? aliasIdByNormalized.get(normalizeCompanyName(exact.matchedAlias).canonical) ?? null : null,
            matchConfidence: best ? best.score.toFixed(4) : null,
            resolutionMethod: exact
              ? exact.matchedAlias
                ? "exact_alias" as const
                : "exact_name" as const
              : best
                ? "fuzzy" as const
                : null,
            resolvedBy: exact ? ctx.userId : null,
          };
        }),
      )
      .returning({ id: schema.fiscalImportRows.id, rowNumber: schema.fiscalImportRows.rowNumber });
    const idByRow = new Map(inserted.map((row) => [row.rowNumber, row.id]));

    await tx
      .update(schema.fiscalImportBatches)
      .set({ status: "ready", updatedAt: new Date() })
      .where(and(eq(schema.fiscalImportBatches.orgId, ctx.orgId), eq(schema.fiscalImportBatches.id, batch.id)));

    return {
      ok: true,
      data: {
        batchId: batch.id,
        fileName: file.name,
        clients: clients.map((client) => ({
          id: client.id,
          name: client.name,
          active: client.active,
          profile: client.profileId
            ? {
                version: client.profileVersion!,
                movements: client.movements!,
                incoming: client.incoming!,
                outgoing: client.outgoing!,
                guide: client.guide!,
                delivery: client.delivery,
                nfs: client.nfs!,
                observations: client.observations,
              }
            : null,
        })),
        missingColumns: parsedSheet.missingColumns,
        rejected: parsedSheet.rejectedRows.length,
        rejectedRows: parsedSheet.rejectedRows.map((row) => ({
          rowNumber: row.rowNumber,
          message: row.message,
        })),
        skipped: parsedSheet.skippedRows.length,
        rows: reconciled.map(({ row, match }) => ({
          id: idByRow.get(row.rowNumber)!,
          rowNumber: row.rowNumber,
          sourceName: row.parsed.companyName ?? "",
          status:
            match.status === "exact"
              ? "matched"
              : match.status === "ambiguous"
                ? "ambiguous"
                : match.suggestions.length > 0
                  ? "suggested"
                  : "pending",
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
  return result;
}

const applySchema = z.object({
  clanId: z.uuid("Clã inválido."),
  batchId: z.uuid("Lote inválido."),
  resolutions: z
    .array(
      z.discriminatedUnion("action", [
        z.object({ rowId: z.uuid(), action: z.literal("ignore") }),
        z.object({
          rowId: z.uuid(),
          action: z.literal("apply"),
          clientId: z.uuid(),
          expectedProfileVersion: z.number().int().min(1).nullable(),
        }),
      ]),
    )
    .min(1)
    .max(1000),
});

function importedApplicability(value: unknown): "required" | "not_required" | "not_applicable" | null {
  if (value === "yes") return "required";
  if (value === "no") return "not_required";
  if (value === "not_applicable") return "not_applicable";
  return null;
}

export interface FiscalImportApplyResult {
  imported: number;
  ignored: number;
  errors: number;
  createdProfiles: number;
  updatedProfiles: number;
  unchangedProfiles: number;
}

export async function applyFiscalImport(
  input: z.input<typeof applySchema>,
): Promise<ActionResult<FiscalImportApplyResult>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsed = applySchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Conciliação inválida.");
  const data = parsed.data;

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult<FiscalImportApplyResult>> => {
    if (!(await assertFiscalManager(tx, ctx, data.clanId))) {
      return err("Apenas a liderança do Fiscal ou um admin pode concluir a importação.");
    }
    const [batch] = await tx
      .select()
      .from(schema.fiscalImportBatches)
      .where(and(eq(schema.fiscalImportBatches.orgId, ctx.orgId), eq(schema.fiscalImportBatches.id, data.batchId)))
      .for("update");
    if (!batch) return err("Lote de importação não encontrado.");
    if (batch.status === "completed") return err("Este lote já foi aplicado.");
    if (batch.status !== "ready") return err("Este lote ainda não está pronto para aplicação.");

    const rowIds = [...new Set(data.resolutions.map((item) => item.rowId))];
    if (
      rowIds.length !== data.resolutions.length ||
      rowIds.length !== batch.totalRows
    ) {
      return err("Revise todas as linhas do lote uma única vez antes de aplicar.");
    }
    const appliedTargets = data.resolutions.flatMap((item) =>
      item.action === "apply" ? [item.clientId] : [],
    );
    if (hasDuplicateFiscalImportTargets(appliedTargets)) {
      return err(
        "Mais de uma linha foi conciliada com a mesma empresa. Ignore a duplicada ou revise o arquivo antes de aplicar.",
      );
    }
    const rows = await tx
      .select()
      .from(schema.fiscalImportRows)
      .where(
        and(
          eq(schema.fiscalImportRows.orgId, ctx.orgId),
          eq(schema.fiscalImportRows.batchId, batch.id),
          inArray(schema.fiscalImportRows.id, rowIds),
        ),
      )
      .for("update");
    if (rows.length !== rowIds.length) return err("Uma ou mais linhas não pertencem a este lote.");
    const rowById = new Map(rows.map((row) => [row.id, row]));
    // Alias é único por organização. Locks consultivos em ordem fixa
    // serializam dois lotes que tentem ensinar o mesmo nome ao mesmo tempo.
    for (const normalizedName of [...new Set(rows.map((row) => row.normalizedSourceName))].sort()) {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`${ctx.orgId}:${normalizedName}`}))`,
      );
    }
    const targetIds = data.resolutions.flatMap((item) => item.action === "apply" ? [item.clientId] : []);
    const clients = targetIds.length > 0
      ? await tx
          .select({ id: schema.clients.id })
          .from(schema.clients)
          .where(
            and(
              eq(schema.clients.orgId, ctx.orgId),
              inArray(schema.clients.id, [...new Set(targetIds)]),
            ),
          )
          .orderBy(asc(schema.clients.id))
          .for("update")
      : [];
    const validClients = new Set(clients.map((client) => client.id));
    if (validClients.size !== new Set(targetIds).size) {
      return err("Uma das empresas selecionadas não pertence à organização.");
    }

    const resolutionByRow = new Map(data.resolutions.map((item) => [item.rowId, item]));
    const aliasesForRows = await tx
      .select({
        normalizedName: schema.fiscalClientAliases.normalizedName,
        clientId: schema.fiscalClientAliases.clientId,
      })
      .from(schema.fiscalClientAliases)
      .where(
        and(
          eq(schema.fiscalClientAliases.orgId, ctx.orgId),
          inArray(
            schema.fiscalClientAliases.normalizedName,
            rows.map((row) => row.normalizedSourceName),
          ),
        ),
      );
    const aliasTargetByName = new Map(
      aliasesForRows.map((alias) => [alias.normalizedName, alias.clientId]),
    );
    for (const row of rows) {
      const resolution = resolutionByRow.get(row.id);
      if (!resolution || resolution.action === "ignore") continue;
      const aliasTarget = aliasTargetByName.get(row.normalizedSourceName);
      if (aliasTarget && aliasTarget !== resolution.clientId) {
        return err(
          `Linha ${row.rowNumber}: o nome “${row.sourceName}” já está conciliado com outra empresa.`,
        );
      }
    }

    let imported = 0;
    let ignored = 0;
    const errors = 0;
    let createdProfiles = 0;
    let updatedProfiles = 0;
    let unchangedProfiles = 0;
    for (const resolution of data.resolutions) {
      const row = rowById.get(resolution.rowId)!;
      if (resolution.action === "ignore") {
        await tx.update(schema.fiscalImportRows).set({ status: "ignored", resolvedBy: ctx.userId, updatedAt: new Date() }).where(eq(schema.fiscalImportRows.id, row.id));
        ignored += 1;
        continue;
      }
      if (!validClients.has(resolution.clientId)) {
        return err("Empresa selecionada não pertence à organização.");
      }
      const normalized = row.normalizedSourceName;
      const [existingAlias] = await tx
        .select()
        .from(schema.fiscalClientAliases)
        .where(
          and(
            eq(schema.fiscalClientAliases.orgId, ctx.orgId),
            eq(schema.fiscalClientAliases.normalizedName, normalized),
          ),
        )
        .limit(1);
      if (existingAlias && existingAlias.clientId !== resolution.clientId) {
        return err(`Linha ${row.rowNumber}: este alias já está ligado a outra empresa.`);
      }
      const raw = row.rawData as { parsed?: Record<string, unknown> };
      const values = raw.parsed ?? {};
      const [profile] = await tx
        .select()
        .from(schema.fiscalClientProfiles)
        .where(and(eq(schema.fiscalClientProfiles.orgId, ctx.orgId), eq(schema.fiscalClientProfiles.clientId, resolution.clientId)))
        .for("update");
      if (!fiscalProfileVersionMatches(profile?.version, resolution.expectedProfileVersion)) {
        return err(
          `Linha ${row.rowNumber}: a Ficha Fiscal desta empresa mudou depois da prévia. Gere uma nova prévia antes de aplicar.`,
        );
      }
      const base = {
        movementsApplicability: profile?.movementsApplicability ?? "unknown" as const,
        incomingApplicability: profile?.incomingApplicability ?? "unknown" as const,
        outgoingApplicability: profile?.outgoingApplicability ?? "unknown" as const,
        guideApplicability: profile?.guideApplicability ?? "unknown" as const,
        nfsApplicability: profile?.nfsApplicability ?? "unknown" as const,
        deliveryChannel: profile?.deliveryChannel ?? null,
        permanentNotes: profile?.permanentNotes ?? null,
      };
      const profileValues = {
        movementsApplicability: importedApplicability(values.movements) ?? base.movementsApplicability,
        incomingApplicability: importedApplicability(values.incoming) ?? base.incomingApplicability,
        outgoingApplicability: importedApplicability(values.outgoing) ?? base.outgoingApplicability,
        guideApplicability: importedApplicability(values.guide) ?? base.guideApplicability,
        nfsApplicability: importedApplicability(values.nfs) ?? base.nfsApplicability,
        deliveryChannel: typeof values.delivery === "string" && values.delivery.trim() ? values.delivery.trim().slice(0, 120) : base.deliveryChannel,
        permanentNotes: typeof values.observations === "string" && values.observations.trim() ? values.observations.trim() : base.permanentNotes,
        updatedBy: ctx.userId,
        updatedAt: new Date(),
      };
      const changedFields = [
        "movementsApplicability",
        "incomingApplicability",
        "outgoingApplicability",
        "guideApplicability",
        "nfsApplicability",
        "deliveryChannel",
        "permanentNotes",
      ].filter(
        (field) =>
          base[field as keyof typeof base] !==
          profileValues[field as keyof typeof profileValues],
      );
      if (!profile || changedFields.length > 0) {
        const saved = profile
          ? (
              await tx
                .update(schema.fiscalClientProfiles)
                .set({ ...profileValues, version: profile.version + 1 })
                .where(
                  and(
                    eq(schema.fiscalClientProfiles.orgId, ctx.orgId),
                    eq(schema.fiscalClientProfiles.id, profile.id),
                  ),
                )
                .returning()
            )[0]
          : (
              await tx
                .insert(schema.fiscalClientProfiles)
                .values({
                  orgId: ctx.orgId,
                  clientId: resolution.clientId,
                  ...profileValues,
                  createdBy: ctx.userId,
                })
                .returning()
            )[0];
        await tx.insert(schema.fiscalClientProfileEvents).values({
          orgId: ctx.orgId,
          profileId: saved.id,
          clientId: saved.clientId,
          eventType: "imported",
          version: saved.version,
          snapshot: fiscalProfileSnapshot(saved),
          changedFields,
          actorId: ctx.userId,
        });
        if (profile) updatedProfiles += 1;
        else createdProfiles += 1;
      } else {
        unchangedProfiles += 1;
      }

      const alias = existingAlias ?? (
        await tx.insert(schema.fiscalClientAliases).values({
          orgId: ctx.orgId,
          clientId: resolution.clientId,
          aliasName: row.sourceName,
          normalizedName: normalized,
          source: "import_reconciliation",
          createdBy: ctx.userId,
        }).returning()
      )[0];
      const method = row.resolvedClientId === resolution.clientId && row.resolutionMethod
        ? row.resolutionMethod
        : row.suggestedClientId === resolution.clientId
          ? "fuzzy"
          : "manual";
      await tx.update(schema.fiscalImportRows).set({
        status: "imported",
        resolvedClientId: resolution.clientId,
        resolvedAliasId: alias.id,
        resolutionMethod: method,
        resolvedBy: ctx.userId,
        appliedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(schema.fiscalImportRows.id, row.id));
      imported += 1;
    }

    const totalErrors = errors + batch.errorRows;
    const report = {
      totalRows: fiscalImportSourceRowTotal(data.resolutions.length, batch.errorRows),
      matchedRows: imported,
      pendingRows: 0,
      ignoredRows: ignored,
      errorRows: totalErrors,
      createdProfiles,
      updatedProfiles,
      unchangedProfiles,
      rejectedRows: batch.errorRows,
    };
    await tx.update(schema.fiscalImportBatches).set({
      status: "completed",
      matchedRows: imported,
      pendingRows: 0,
      ignoredRows: ignored,
      errorRows: totalErrors,
      report,
      completedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(eq(schema.fiscalImportBatches.orgId, ctx.orgId), eq(schema.fiscalImportBatches.id, batch.id)));
    return {
      ok: true,
      data: {
        imported,
        ignored,
        errors: totalErrors,
        createdProfiles,
        updatedProfiles,
        unchangedProfiles,
      },
    };
  });
  if (result.ok) revalidatePath(`/clans/${data.clanId}`);
  return result;
}
