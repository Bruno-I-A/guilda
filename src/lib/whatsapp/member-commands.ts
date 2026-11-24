import "server-only";

import { randomInt } from "node:crypto";

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { type OrgTx, withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { canHandleInformatives } from "@/domain/guild-permissions";
import type { OrgRole, TaskStatus } from "@/domain/task-state";
import { listLedClanIds } from "@/lib/clans/leadership";
import { cancelInformative, confirmInformative } from "@/lib/informatives/confirm";
import { buildInformativeDraft, draftIsBlocked, saveInformativeDraftTx, type InformativeActor } from "@/lib/informatives/draft";
import { draftPreview } from "@/lib/informatives/preview";
import { enqueueMemberReply } from "@/lib/notices/enqueue";
import { appLink } from "@/lib/notices/links";
import { transitionTaskForActor } from "@/lib/tasks/transition-service";

import { draftButtonId, parseMemberButton, type MemberInbound } from "./member-inbound";
import { runMemberWhatsAppNotificationCycle } from "./member-notification-worker";
import { whatsAppPhoneVariants } from "./member-notifications";
import {
  generateVerificationCode,
  hashVerificationCode,
  parseVerificationMessage,
  VERIFICATION_TTL_MS,
} from "./member-verification";

/**
 * Mensagens dos integrantes no WhatsApp do escritório (2026-11-24, substitui o
 * bot do Telegram): o código que confirma o número, o pedido de missão (a
 * mesma IA dos Informativos) e o toque nos botões dos avisos.
 */

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: "Pendente",
  in_progress: "Em andamento",
  awaiting_approval: "Aguardando aprovação",
  completed: "Concluída",
  rejected: "Devolvida",
  cancelled: "Cancelada",
};

const MISSION_GUIDANCE =
  "Para criar missões, escreva o pedido numa mensagem: o que precisa ser feito, quem faz e, quando houver, a empresa e o prazo. A ordem não importa.";

function memberGuidance(): string {
  return `Por aqui você recebe os avisos das suas missões e usa os botões das mensagens. Missão nova por mensagem é com líder de clã, admin ou dono; pelo app: ${appLink("tasks/new")}`;
}

/** Gera um código novo para o Perfil; só o hash fica guardado. */
export async function startMemberWhatsAppVerification(tx: OrgTx, input: { orgId: string; userId: string; now?: Date }): Promise<{ code: string; expiresAt: Date } | null> {
  const now = input.now ?? new Date();
  const code = generateVerificationCode(randomInt);
  const expiresAt = new Date(now.getTime() + VERIFICATION_TTL_MS);
  const updated = await tx.update(schema.memberWhatsAppConnections)
    .set({ verificationCodeHash: hashVerificationCode(input.orgId, code), verificationExpiresAt: expiresAt, updatedAt: now })
    .where(and(eq(schema.memberWhatsAppConnections.orgId, input.orgId), eq(schema.memberWhatsAppConnections.userId, input.userId)))
    .returning({ id: schema.memberWhatsAppConnections.id });
  return updated.length ? { code, expiresAt } : null;
}

/**
 * Chamado pelo webhook antes do Atendimento. Devolve `true` quando a mensagem
 * é de um integrante e já foi tratada aqui (não vira conversa de cliente):
 * confirmação do número ou comando de número confirmado. Número cadastrado e
 * ainda não confirmado, fora a tentativa de código, segue como cliente.
 */
export async function routeMemberMessage(tx: OrgTx, input: { orgId: string; message: MemberInbound }): Promise<boolean> {
  const { message } = input;
  const connection = await tx.query.memberWhatsAppConnections.findFirst({
    where: and(
      eq(schema.memberWhatsAppConnections.orgId, input.orgId),
      inArray(schema.memberWhatsAppConnections.phoneE164, whatsAppPhoneVariants(`+${message.from}`)),
    ),
  });
  if (!connection) return false;

  const code = message.kind === "text" ? parseVerificationMessage(message.text) : null;
  if (code) {
    const valid = connection.verificationCodeHash === hashVerificationCode(input.orgId, code)
      && Boolean(connection.verificationExpiresAt && connection.verificationExpiresAt.getTime() > message.occurredAt.getTime());
    if (valid) {
      await tx.update(schema.memberWhatsAppConnections)
        .set({ verifiedAt: new Date(), verificationCodeHash: null, verificationExpiresAt: null, lastInboundAt: message.occurredAt, updatedAt: new Date() })
        .where(and(eq(schema.memberWhatsAppConnections.orgId, input.orgId), eq(schema.memberWhatsAppConnections.id, connection.id)));
      const canCreate = await canCreateMissions(tx, input.orgId, connection.userId);
      await enqueueMemberReply(tx, {
        orgId: input.orgId,
        userId: connection.userId,
        dedupeKey: `whatsapp-verify:${message.externalId}`,
        text: ["Número confirmado na Guilda. Você vai receber aqui os avisos das suas missões.", "", canCreate ? MISSION_GUIDANCE : memberGuidance()].join("\n"),
      });
      return true;
    }
    if (!connection.verifiedAt) {
      await enqueueMemberReply(tx, {
        orgId: input.orgId,
        userId: connection.userId,
        dedupeKey: `whatsapp-verify:${message.externalId}`,
        text: "Esse código não confere ou já venceu. Gere outro no seu Perfil da Guilda e mande de novo.",
      });
      return true;
    }
  }

  if (!connection.verifiedAt) return false;

  // Mensagem do integrante abre a janela de 24 horas para os avisos dele.
  await tx.update(schema.memberWhatsAppConnections)
    .set({ lastInboundAt: message.occurredAt, updatedAt: new Date() })
    .where(and(eq(schema.memberWhatsAppConnections.orgId, input.orgId), eq(schema.memberWhatsAppConnections.id, connection.id)));
  await tx.insert(schema.memberWhatsAppCommands).values({
    orgId: input.orgId,
    userId: connection.userId,
    connectionId: connection.id,
    externalId: message.externalId,
    kind: message.kind,
    messageType: message.messageType.slice(0, 40),
    text: message.text ?? null,
    buttonId: message.buttonId ?? null,
    receivedAt: message.occurredAt,
  }).onConflictDoNothing();
  return true;
}

async function canCreateMissions(tx: OrgTx, orgId: string, userId: string): Promise<boolean> {
  const [membership] = await tx.select({ role: schema.member.role }).from(schema.member)
    .where(and(eq(schema.member.organizationId, orgId), eq(schema.member.userId, userId))).limit(1);
  const role = roleOf(membership?.role);
  if (!role) return false;
  // Na mesma transação: o webhook chama isto com a conversa já aberta.
  return canHandleInformatives({ role, leadsAnyClan: (await listLedClanIds(tx, orgId, userId)).length > 0 });
}

function roleOf(value: string | undefined): OrgRole | null {
  return value === "owner" || value === "admin" || value === "member" ? value : null;
}

type Claim = Readonly<{ id: string; orgId: string; claimToken: string }>;
type Command = typeof schema.memberWhatsAppCommands.$inferSelect;

async function claimCommands(limit: number): Promise<Claim[]> {
  const result = await db.execute<{ command_id: string; org_id: string; claim_token: string }>(sql`SELECT * FROM public.claim_member_whatsapp_commands(${limit})`);
  return result.rows.map((row) => ({ id: row.command_id, orgId: row.org_id, claimToken: row.claim_token }));
}

function doneWhere(claimed: Claim) {
  return and(
    eq(schema.memberWhatsAppCommands.orgId, claimed.orgId),
    eq(schema.memberWhatsAppCommands.id, claimed.id),
    eq(schema.memberWhatsAppCommands.lockToken, claimed.claimToken),
  );
}

async function markDone(tx: OrgTx, claimed: Claim): Promise<void> {
  await tx.update(schema.memberWhatsAppCommands)
    .set({ status: "done", processedAt: new Date(), lockedAt: null, lockToken: null })
    .where(doneWhere(claimed));
}

/** Responde e marca a mensagem como lida na mesma transação. */
async function replyAndFinish(claimed: Claim, command: Command, text: string, buttons?: { id: string; title: string }[], suffix = "reply"): Promise<void> {
  await withOrgTx(claimed.orgId, async (tx) => {
    await enqueueMemberReply(tx, { orgId: claimed.orgId, userId: command.userId, dedupeKey: `whatsapp-command:${command.id}:${suffix}`, text, ...(buttons ? { buttons } : {}) });
    await markDone(tx, claimed);
  });
}

async function loadCommand(claimed: Claim): Promise<{ command: Command; actor: InformativeActor | null } | null> {
  return withOrgTx(claimed.orgId, async (tx) => {
    const command = await tx.query.memberWhatsAppCommands.findFirst({ where: and(doneWhere(claimed), eq(schema.memberWhatsAppCommands.status, "processing")) });
    if (!command) return null;
    const [membership] = await tx.select({ role: schema.member.role }).from(schema.member)
      .where(and(eq(schema.member.organizationId, claimed.orgId), eq(schema.member.userId, command.userId))).limit(1);
    const role = roleOf(membership?.role);
    return { command, actor: role ? { orgId: claimed.orgId, userId: command.userId, role } : null };
  });
}

async function handleButton(claimed: Claim, command: Command, actor: InformativeActor): Promise<void> {
  const button = parseMemberButton(command.buttonId);
  if (!button) {
    await replyAndFinish(claimed, command, "Não reconheci esse botão. Abra a missão na Guilda para continuar.");
    return;
  }
  if (button.type === "draft") {
    if (!(await withOrgTx(claimed.orgId, (tx) => canCreateMissions(tx, claimed.orgId, actor.userId)))) {
      await replyAndFinish(claimed, command, "Só líder de clã, admin ou dono confirma missões por aqui.");
      return;
    }
    const options = { whatsappConnectionId: command.connectionId };
    const result = button.decision === "confirm"
      ? await confirmInformative(actor, button.draftId, options)
      : await cancelInformative(actor, button.draftId, options);
    await replyAndFinish(claimed, command, result.message);
    return;
  }
  const result = await transitionTaskForActor({
    actor,
    taskId: button.taskId,
    ...(button.action === "approve"
      ? { to: "completed" as const, allowedFrom: ["awaiting_approval" as const], creditXp: true }
      : { to: "in_progress" as const, allowedFrom: ["pending" as const, "rejected" as const] }),
  });
  if (!result.ok) {
    await replyAndFinish(claimed, command, result.error);
    return;
  }
  const [task] = await withOrgTx(claimed.orgId, (tx) => tx.select({ title: schema.tasks.title }).from(schema.tasks)
    .where(and(eq(schema.tasks.orgId, claimed.orgId), eq(schema.tasks.id, button.taskId))).limit(1));
  await replyAndFinish(claimed, command, `${task?.title ?? "Missão"}\n${STATUS_LABEL[result.data!.status]}`);
}

async function handleText(claimed: Claim, command: Command, actor: InformativeActor, fetchImpl: typeof fetch): Promise<void> {
  const text = command.text?.trim() ?? "";
  if (!(await withOrgTx(claimed.orgId, (tx) => canCreateMissions(tx, claimed.orgId, actor.userId)))) {
    await replyAndFinish(claimed, command, memberGuidance());
    return;
  }
  // O aviso de "analisando" sai antes da IA, que leva alguns segundos.
  await withOrgTx(claimed.orgId, (tx) => enqueueMemberReply(tx, { orgId: claimed.orgId, userId: command.userId, dedupeKey: `whatsapp-command:${command.id}:ack`, text: "Analisando o pedido e conferindo os responsáveis…" }));
  await runMemberWhatsAppNotificationCycle(5, fetchImpl).catch(() => undefined);

  const draft = await buildInformativeDraft(actor, text);
  if (!draft.ok) {
    await replyAndFinish(claimed, command, draft.message);
    return;
  }
  const blocked = draftIsBlocked(draft.payload);
  const count = draft.payload.tasks.length;
  await withOrgTx(claimed.orgId, async (tx) => {
    const saved = await saveInformativeDraftTx(tx, {
      actor,
      payload: draft.payload,
      model: draft.model,
      sourceText: text,
      source: "whatsapp",
      whatsappConnectionId: command.connectionId,
    });
    await enqueueMemberReply(tx, { orgId: claimed.orgId, userId: command.userId, dedupeKey: `whatsapp-command:${command.id}:preview`, text: draftPreview(draft.payload) });
    await enqueueMemberReply(tx, {
      orgId: claimed.orgId,
      userId: command.userId,
      dedupeKey: `whatsapp-command:${command.id}:decision`,
      text: blocked
        ? "Esta prévia tem pendências e não pode ser confirmada por aqui. Abra Informativos na Guilda para resolver, ou cancele."
        : count === 0 ? "Confirmar a prévia?" : `Criar ${count === 1 ? "esta missão" : `estas ${count} missões`}?`,
      buttons: [
        ...(blocked ? [] : [{ id: draftButtonId("confirm", saved.id), title: count === 0 ? "Confirmar" : count === 1 ? "Criar 1 missão" : `Criar ${count} missões` }]),
        { id: draftButtonId("cancel", saved.id), title: "Cancelar" },
      ],
    });
    await markDone(tx, claimed);
  });
}

async function processCommand(claimed: Claim, fetchImpl: typeof fetch): Promise<void> {
  const loaded = await loadCommand(claimed);
  if (!loaded) return;
  const { command, actor } = loaded;
  if (!actor) {
    await replyAndFinish(claimed, command, "Seu acesso à Guilda não está mais ativo.");
    return;
  }
  if (command.kind === "button") return handleButton(claimed, command, actor);
  if (command.kind === "text") return handleText(claimed, command, actor, fetchImpl);
  const canCreate = await withOrgTx(claimed.orgId, (tx) => canCreateMissions(tx, claimed.orgId, actor.userId));
  await replyAndFinish(claimed, command, canCreate ? `Por enquanto eu leio só texto. ${MISSION_GUIDANCE}` : memberGuidance());
}

async function fail(claimed: Claim, error: unknown): Promise<void> {
  const detail = (error instanceof Error ? error.message : "falha desconhecida").slice(0, 500);
  await withOrgTx(claimed.orgId, (tx) => tx.update(schema.memberWhatsAppCommands)
    .set({ status: sql`CASE WHEN ${schema.memberWhatsAppCommands.attemptCount} >= 3 THEN 'failed' ELSE 'pending' END`, lastError: detail, lockedAt: null, lockToken: null })
    .where(doneWhere(claimed))).catch(() => undefined);
}

export async function runMemberCommandCycle(limit = 10, fetchImpl: typeof fetch = fetch): Promise<{ claimed: number; failed: number }> {
  const claims = await claimCommands(Math.max(1, Math.min(100, limit)));
  let failed = 0;
  for (const claimed of claims) {
    try {
      await processCommand(claimed, fetchImpl);
    } catch (error) {
      console.error("Falha ao responder mensagem de integrante no WhatsApp", {
        orgId: claimed.orgId,
        error: error instanceof Error ? error.message : "erro desconhecido",
      });
      await fail(claimed, error);
      failed++;
    }
  }
  return { claimed: claims.length, failed };
}
