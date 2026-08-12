import "server-only";

import { and, eq } from "drizzle-orm";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { normalizeCnpj, validateCnpj } from "@/domain/cnpj";
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

const DRAFT_TTL_MS = 30 * 60 * 1000;

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

function draftPreview(payload: InformativeDraftPayload): string {
  const kindLabel = {
    new_client: "Novo cliente",
    client_change: "Alteração",
    client_closure: "Baixa de cliente",
  }[payload.kind];
  const lines = [
    "🤖 Prévia do informativo",
    "",
    `${kindLabel}: ${payload.company.legalName}`,
    `CNPJ: ${payload.company.normalizedCnpj ?? "não informado"}`,
    `Regime: ${taxRegimeLabel(payload.company.taxRegime)}`,
    `Empresa no painel: ${payload.company.clientId ? "localizada" : payload.company.createClient ? "será criada" : "não localizada"}`,
    "",
    `${payload.tasks.length} missão(ões) proposta(s):`,
  ];
  payload.tasks.slice(0, 20).forEach((task, index) => {
    lines.push(`${index + 1}. ${task.assigneeName} — ${task.title}`);
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
  if (actor.role === "member") {
    await api.sendMessage(chatId, "Somente admin ou owner pode criar missões por informativo.");
    return;
  }
  await api.sendMessage(chatId, "🤖 Analisando o informativo e conferindo responsáveis…");

  const members = await listOrgMembers(actor.orgId);
  const extracted = await extractInformative(
    sourceText,
    members.map(({ userId, name }) => ({ userId, name })),
    `${actor.orgId}:${actor.userId}`,
  );

  const normalizedCnpj = extracted.data.company.cnpj
    ? normalizeCnpj(extracted.data.company.cnpj)
    : null;
  const validCnpj = normalizedCnpj && validateCnpj(normalizedCnpj)
    ? normalizedCnpj
    : null;
  const existingClient = await withOrgTx(actor.orgId, async (tx) => {
    if (validCnpj) {
      const byCnpj = await tx.query.clients.findFirst({
        where: and(
          eq(schema.clients.orgId, actor.orgId),
          eq(schema.clients.cnpj, validCnpj),
        ),
      });
      if (byCnpj) return byCnpj;
    }
    return tx.query.clients.findFirst({
      where: and(
        eq(schema.clients.orgId, actor.orgId),
        eq(schema.clients.name, extracted.data.company.legalName),
      ),
    });
  });

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
        description: `${task.description}\n\nTrecho do informativo:\n${task.sourceSection}`.slice(
          0,
          5000,
        ),
        assigneeId: resolved.userId,
        assigneeName: resolved.name,
        priority: task.priority,
        difficulty: task.difficulty,
        dueDate: task.dueDate,
        sourceSection: task.sourceSection,
      });
    }
  }

  const warnings = [...extracted.data.warnings];
  const createClient =
    extracted.data.kind === "new_client" &&
    !existingClient &&
    Boolean(validCnpj && extracted.data.company.taxRegime);
  if (extracted.data.kind === "new_client" && !validCnpj) {
    warnings.push("CNPJ ausente ou inválido; a empresa não poderá ser criada automaticamente.");
  }
  if (
    extracted.data.kind === "new_client" &&
    !existingClient &&
    !extracted.data.company.taxRegime
  ) {
    warnings.push("Regime tributário não identificado; a empresa não poderá ser criada automaticamente.");
  }
  if (!existingClient && extracted.data.kind === "client_closure") {
    warnings.push("Cliente baixado não localizado no painel; as missões serão criadas sem vínculo.");
  } else if (!existingClient && !createClient) {
    warnings.push("As missões serão criadas sem vínculo com uma empresa do painel.");
  }

  const payload = informativeDraftPayloadSchema.parse({
    ...extracted.data,
    company: {
      ...extracted.data.company,
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
  if (actor.role === "member") return { ok: false, message: "Apenas admin ou owner pode confirmar." };

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
    if (draft.expiresAt <= new Date()) return { ok: false, message: "O rascunho expirou. Envie o informativo novamente." };

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
        ),
        columns: { id: true },
      });
      clientId = existing?.id ?? null;
    }
    if (
      !clientId &&
      payload.data.company.createClient &&
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

    const taskIds: string[] = [];
    for (const task of payload.data.tasks) {
      const created = await createTaskRecord(tx, {
        orgId: actor.orgId,
        creatorId: actor.userId,
        assigneeId: task.assigneeId,
        clientId: clientId ?? null,
        title: `${task.title} — ${payload.data.company.legalName}`.slice(0, 200),
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
      message: `${taskIds.length} missão(ões) criada(s) para ${payload.data.company.legalName}.`,
    };
  });
}
