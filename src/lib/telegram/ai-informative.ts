import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { type OrgTx, withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { normalizeCnpj, validateCnpj } from "@/domain/cnpj";
import { resolveClientName } from "@/lib/ai/client-resolution";
import { extractInformative } from "@/lib/ai/informative";
import {
  informativeDraftPayloadSchema,
  type InformativeDraftPayload,
} from "@/lib/ai/informative-schema";
import { resolveMemberName } from "@/lib/ai/member-resolution";
import { listOrgMembers } from "@/lib/org";
import { createTaskRecord } from "@/lib/tasks/create";

import type { TelegramApi } from "./endpoint";
import { encodeDraftCallback } from "./endpoint";
import { isDetailedInformativeMessage } from "./informative-detection";

const DRAFT_TTL_MS = 30 * 60 * 1000;

const MISSING_FIELD_LABELS = {
  company: "o nome da empresa",
  actions: "o que precisa ser feito",
  responsible: "quem será o responsável",
} as const;

type Actor = {
  orgId: string;
  userId: string;
  role: "owner" | "admin" | "member";
};

function taxRegimeLabel(value: InformativeDraftPayload["company"]["taxRegime"]): string {
  return value
    ? { simples: "Simples Nacional", presumido: "Lucro Presumido", association: "Associação", real: "Lucro Real" }[value]
    : "não identificado";
}

function dueDate(value: string | null): Date | null {
  return value ? new Date(`${value}T12:00:00Z`) : null;
}

function currentYearInSaoPaulo(): number {
  return Number(
    new Intl.DateTimeFormat("en", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
    }).format(new Date()),
  );
}

async function ensureClosingYear(
  tx: OrgTx,
  input: { orgId: string; clientId: string; year: number },
): Promise<string> {
  const existing = await tx.query.accountingClosingYears.findFirst({
    where: and(
      eq(schema.accountingClosingYears.orgId, input.orgId),
      eq(schema.accountingClosingYears.clientId, input.clientId),
      eq(schema.accountingClosingYears.year, input.year),
    ),
    columns: { id: true },
  });
  if (existing) return existing.id;

  const [created] = await tx
    .insert(schema.accountingClosingYears)
    .values({
      orgId: input.orgId,
      clientId: input.clientId,
      year: input.year,
    })
    .onConflictDoNothing()
    .returning({ id: schema.accountingClosingYears.id });
  if (created) return created.id;

  const raced = await tx.query.accountingClosingYears.findFirst({
    where: and(
      eq(schema.accountingClosingYears.orgId, input.orgId),
      eq(schema.accountingClosingYears.clientId, input.clientId),
      eq(schema.accountingClosingYears.year, input.year),
    ),
    columns: { id: true },
  });
  if (!raced) throw new Error("Não foi possível preparar a campanha de fechamentos.");
  return raced.id;
}

function draftPreview(payload: InformativeDraftPayload): string {
  const kindLabel = {
    new_client: "Novo cliente",
    client_change: "Alteração",
    client_closure: "Baixa de cliente",
    general_task: "Nova solicitação",
  }[payload.kind];
  const companyLabel = payload.company.legalName
    ? `${kindLabel}: ${payload.company.legalName}`
    : kindLabel;
  const lines = [
    "🤖 Prévia das missões",
    "",
    companyLabel,
  ];
  if (payload.sourceFormat === "informative") {
    lines.push(
      `CNPJ: ${payload.company.normalizedCnpj ?? "não informado"}`,
      `Regime: ${taxRegimeLabel(payload.company.taxRegime)}`,
      `Empresa no painel: ${payload.company.clientId ? "localizada" : payload.company.createClient ? "será criada" : "não localizada"}`,
    );
  }
  lines.push("", `${payload.tasks.length} missão(ões) proposta(s):`);
  payload.tasks.slice(0, 20).forEach((task, index) => {
    lines.push(`${index + 1}. ${task.assigneeName} — ${task.title}`);
    if (task.category === "annual_closing" && task.closingYear) {
      lines.push(`   ↳ ao concluir, fechará a campanha de ${task.closingYear}`);
    }
  });
  if (payload.tasks.length > 20) {
    lines.push(`… e mais ${payload.tasks.length - 20}.`);
  }
  if (payload.unresolvedAssignees.length) {
    lines.push(
      "",
      `⚠️ Responsáveis pendentes ou não reconhecidos: ${payload.unresolvedAssignees.join(", ")}`,
    );
  }
  if (payload.warnings.length) {
    lines.push("", ...payload.warnings.slice(0, 5).map((warning) => `⚠️ ${warning}`));
  }
  lines.push("", "Revise a prévia antes de confirmar. Nenhuma missão foi criada ainda.");
  return lines.join("\n").slice(0, 4096);
}

export async function createInformativeDraft(
  api: TelegramApi,
  chatId: number,
  connectionId: string,
  actor: Actor,
  sourceText: string,
): Promise<void> {
  await api.sendMessage(chatId, "🤖 Analisando a solicitação e conferindo responsáveis…");

  const [members, clients] = await Promise.all([
    listOrgMembers(actor.orgId),
    withOrgTx(actor.orgId, (tx) =>
      tx.query.clients.findMany({
        where: and(
          eq(schema.clients.orgId, actor.orgId),
          eq(schema.clients.active, true),
        ),
      }),
    ),
  ]);
  const sourceFormat = isDetailedInformativeMessage(sourceText)
    ? "informative"
    : "business_mission";
  const extracted = await extractInformative(
    sourceText,
    members.map(({ userId, name }) => ({ userId, name })),
    clients.map(({ name }) => ({ name })),
    `${actor.orgId}:${actor.userId}`,
  );

  if (!extracted.data.isMissionRequest) {
    await api.sendMessage(
      chatId,
      "Não identifiquei uma solicitação de nova missão. Diga o que precisa ser feito, quem será o responsável e, quando houver, a empresa e o prazo.",
    );
    return;
  }

  const kind = extracted.data.kind ?? "general_task";
  const hasAnnualClosing = extracted.data.tasks.some(
    (task) => task.category === "annual_closing",
  );
  const missing = new Set(extracted.data.missingFields);
  if (
    (kind !== "general_task" || hasAnnualClosing) &&
    !extracted.data.company.legalName
  ) {
    missing.add("company");
  }
  if (extracted.data.tasks.length === 0) missing.add("actions");
  if (extracted.data.tasks.some((task) => task.assignees.length === 0)) {
    missing.add("responsible");
  }
  if (missing.size) {
    const labels = [...missing].map((field) => MISSING_FIELD_LABELS[field]);
    await api.sendMessage(
      chatId,
      `Entendi parte da solicitação, mas faltou informar: ${labels.join(", ")}. Reenvie tudo em uma única mensagem; a ordem e a formatação não importam.`,
    );
    return;
  }

  const legalName = extracted.data.company.legalName;

  const normalizedCnpj = extracted.data.company.cnpj
    ? normalizeCnpj(extracted.data.company.cnpj)
    : null;
  const validCnpj = normalizedCnpj && validateCnpj(normalizedCnpj)
    ? normalizedCnpj
    : null;
  const existingClient =
    (validCnpj
      ? clients.find((client) => client.cnpj === validCnpj) ?? null
      : null) ??
    (legalName ? resolveClientName(legalName, clients) : null);

  if (hasAnnualClosing && !existingClient) {
    await api.sendMessage(
      chatId,
      legalName
        ? `Não consegui localizar “${legalName}” de forma única na carteira de clientes. Reenvie a missão usando o nome cadastrado da empresa.`
        : "Para vincular o fechamento à campanha anual, informe o nome da empresa.",
    );
    return;
  }

  const finalLegalName = existingClient?.name ?? legalName;

  const unresolved = new Set<string>();
  const tasks: InformativeDraftPayload["tasks"] = [];
  for (const task of extracted.data.tasks) {
    if (task.assignees.length === 0) {
      unresolved.add(`Sem responsável: ${task.title}`.slice(0, 200));
      continue;
    }
    const resolvedForTask = new Set<string>();
    for (const requested of task.assignees) {
      const resolved = resolveMemberName(requested, members);
      if (!resolved) {
        unresolved.add(requested);
        continue;
      }
      if (resolvedForTask.has(resolved.userId)) continue;
      resolvedForTask.add(resolved.userId);
      tasks.push({
        title: task.title,
        description: `${task.description}\n\nTrecho da solicitação:\n${task.sourceSection}`.slice(
          0,
          5000,
        ),
        assigneeId: resolved.userId,
        assigneeName: resolved.name,
        priority: task.priority,
        difficulty: task.difficulty,
        dueDate: task.dueDate,
        category: task.category,
        closingYear:
          task.category === "annual_closing"
            ? task.closingYear ?? currentYearInSaoPaulo()
            : null,
        sourceSection: task.sourceSection,
      });
    }
  }

  const warnings = [...extracted.data.warnings];
  const closingYears = [
    ...new Set(
      tasks
        .filter((task) => task.category === "annual_closing")
        .map((task) => task.closingYear)
        .filter((year): year is number => year !== null),
    ),
  ];
  if (existingClient && closingYears.length > 0) {
    const alreadyClosed = await withOrgTx(actor.orgId, (tx) =>
      tx.query.accountingClosingYears.findMany({
        where: and(
          eq(schema.accountingClosingYears.orgId, actor.orgId),
          eq(schema.accountingClosingYears.clientId, existingClient.id),
          inArray(schema.accountingClosingYears.year, closingYears),
        ),
        columns: { year: true, closedAt: true },
      }),
    );
    for (const annual of alreadyClosed) {
      if (annual.closedAt) {
        warnings.push(
          `A campanha de ${annual.year} desta empresa já está marcada como fechada.`,
        );
      }
    }
  }
  const createClient =
    sourceFormat === "informative" &&
    extracted.data.kind === "new_client" &&
    Boolean(finalLegalName) &&
    !existingClient &&
    Boolean(validCnpj && extracted.data.company.taxRegime);
  if (sourceFormat === "informative" && extracted.data.kind === "new_client" && !validCnpj) {
    warnings.push("CNPJ ausente ou inválido; a empresa não poderá ser criada automaticamente.");
  }
  if (
    sourceFormat === "informative" &&
    extracted.data.kind === "new_client" &&
    !existingClient &&
    !extracted.data.company.taxRegime
  ) {
    warnings.push("Regime tributário não identificado; a empresa não poderá ser criada automaticamente.");
  }
  if (
    sourceFormat === "informative" &&
    !existingClient &&
    extracted.data.kind === "client_closure"
  ) {
    warnings.push("Cliente baixado não localizado no painel; as missões serão criadas sem vínculo.");
  } else if (sourceFormat === "informative" && !existingClient && !createClient) {
    warnings.push("As missões serão criadas sem vínculo com uma empresa do painel.");
  }

  const payload = informativeDraftPayloadSchema.parse({
    ...extracted.data,
    kind,
    sourceFormat,
    company: {
      ...extracted.data.company,
      legalName: finalLegalName,
      summary:
        extracted.data.company.summary ??
        (finalLegalName
          ? `Solicitação referente a ${finalLegalName}.`
          : "Solicitação de missão geral."),
      normalizedCnpj: validCnpj,
      clientId: existingClient?.id ?? null,
      createClient,
    },
    tasks,
    unresolvedAssignees: [...unresolved],
    warnings,
  });

  const draft = await withOrgTx(actor.orgId, async (tx) => {
    await tx
      .update(schema.telegramAiDrafts)
      .set({ status: "cancelled", decidedAt: new Date() })
      .where(
        and(
          eq(schema.telegramAiDrafts.orgId, actor.orgId),
          eq(schema.telegramAiDrafts.requestedBy, actor.userId),
          eq(schema.telegramAiDrafts.status, "pending"),
        ),
      );
    const [created] = await tx
      .insert(schema.telegramAiDrafts)
      .values({
        orgId: actor.orgId,
        requestedBy: actor.userId,
        connectionId,
        sourceText,
        model: extracted.model,
        payload,
        expiresAt: new Date(Date.now() + DRAFT_TTL_MS),
      })
      .returning({ id: schema.telegramAiDrafts.id });
    return created;
  });

  const blocked =
    payload.unresolvedAssignees.length > 0 ||
    payload.tasks.length === 0;
  await api.sendMessage(chatId, draftPreview(payload), {
    replyMarkup: {
      inline_keyboard: [
        ...(blocked
          ? []
          : [[{ text: `Criar ${payload.tasks.length} missões`, callback_data: encodeDraftCallback("confirm", draft.id) }]]),
        [{ text: "Cancelar rascunho", callback_data: encodeDraftCallback("cancel", draft.id) }],
      ],
    },
  });
}

export async function decideInformativeDraft(
  actor: Actor,
  connectionId: string,
  draftId: string,
  decision: "confirm" | "cancel",
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  return withOrgTx(actor.orgId, async (tx) => {
    const [draft] = await tx
      .select()
      .from(schema.telegramAiDrafts)
      .where(
        and(
          eq(schema.telegramAiDrafts.id, draftId),
          eq(schema.telegramAiDrafts.orgId, actor.orgId),
          eq(schema.telegramAiDrafts.requestedBy, actor.userId),
          eq(schema.telegramAiDrafts.connectionId, connectionId),
        ),
      )
      .for("update");
    if (!draft) return { ok: false, message: "Rascunho não encontrado." };
    if (draft.status === "confirmed") return { ok: true, message: "Este rascunho já foi criado." };
    if (draft.status !== "pending") return { ok: false, message: "Este rascunho já foi cancelado." };
    if (draft.expiresAt <= new Date()) return { ok: false, message: "O rascunho expirou. Envie a solicitação novamente." };

    if (decision === "cancel") {
      await tx
        .update(schema.telegramAiDrafts)
        .set({ status: "cancelled", decidedAt: new Date() })
        .where(eq(schema.telegramAiDrafts.id, draft.id));
      return { ok: true, message: "Rascunho cancelado. Nenhuma missão foi criada." };
    }

    const payload = informativeDraftPayloadSchema.safeParse(draft.payload);
    if (!payload.success) return { ok: false, message: "O rascunho está inválido. Gere outro." };
    if (payload.data.unresolvedAssignees.length || payload.data.tasks.length === 0) {
      return { ok: false, message: "Existem responsáveis não reconhecidos ou nenhuma missão válida." };
    }

    let clientId: string | null = null;
    if (payload.data.company.clientId) {
      const existing = await tx.query.clients.findFirst({
        where: and(
          eq(schema.clients.id, payload.data.company.clientId),
          eq(schema.clients.orgId, actor.orgId),
          eq(schema.clients.active, true),
        ),
        columns: { id: true },
      });
      clientId = existing?.id ?? null;
    }
    if (
      !clientId &&
      payload.data.company.createClient &&
      payload.data.company.legalName &&
      payload.data.company.taxRegime &&
      payload.data.company.normalizedCnpj
    ) {
      const [client] = await tx
        .insert(schema.clients)
        .values({
          orgId: actor.orgId,
          name: payload.data.company.legalName,
          cnpj: payload.data.company.normalizedCnpj,
          taxRegime: payload.data.company.taxRegime,
        })
        .onConflictDoNothing()
        .returning({ id: schema.clients.id });
      clientId = client?.id ?? null;
      if (!clientId && payload.data.company.normalizedCnpj) {
        const existing = await tx.query.clients.findFirst({
          where: and(
            eq(schema.clients.orgId, actor.orgId),
            eq(schema.clients.cnpj, payload.data.company.normalizedCnpj),
          ),
          columns: { id: true },
        });
        clientId = existing?.id ?? null;
      }
    }
    const membershipRows = await tx
      .select({ userId: schema.member.userId })
      .from(schema.member)
      .where(eq(schema.member.organizationId, actor.orgId));
    const memberIds = new Set(membershipRows.map((row) => row.userId));
    if (payload.data.tasks.some((task) => !memberIds.has(task.assigneeId))) {
      return { ok: false, message: "Um responsável não pertence mais à Guilda. Gere outra prévia." };
    }
    if (
      payload.data.tasks.some(
        (task) =>
          task.category === "annual_closing" &&
          (!clientId || !task.closingYear),
      )
    ) {
      return {
        ok: false,
        message: "O fechamento anual perdeu o vínculo com a empresa ou o ano. Gere outra prévia.",
      };
    }

    const taskIds: string[] = [];
    for (const task of payload.data.tasks) {
      let closingYearId: string | null = null;
      if (task.category === "annual_closing") {
        if (!clientId || !task.closingYear) throw new Error("Fechamento anual inválido.");
        closingYearId = await ensureClosingYear(tx, {
          orgId: actor.orgId,
          clientId,
          year: task.closingYear,
        });
      }
      const companySuffix = payload.data.company.legalName
        ? ` — ${payload.data.company.legalName}`
        : "";
      const created = await createTaskRecord(tx, {
        orgId: actor.orgId,
        creatorId: actor.userId,
        assigneeId: task.assigneeId,
        clientId: clientId ?? null,
        closingYearId,
        title: `${task.title}${companySuffix}`.slice(0, 200),
        description: task.description,
        priority: task.priority,
        difficulty: task.difficulty,
        dueDate: dueDate(task.dueDate),
      });
      taskIds.push(created.id);
    }

    await tx
      .update(schema.telegramAiDrafts)
      .set({
        status: "confirmed",
        decidedAt: new Date(),
        createdTaskIds: taskIds,
      })
      .where(eq(schema.telegramAiDrafts.id, draft.id));
    return {
      ok: true,
      message: payload.data.company.legalName
        ? `${taskIds.length} missão(ões) criada(s) para ${payload.data.company.legalName}.`
        : `${taskIds.length} missão(ões) criada(s).`,
    };
  });
}
