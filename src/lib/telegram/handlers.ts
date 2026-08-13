import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import * as schema from "@/db/schema";
import type { OrgRole } from "@/domain/task-state";

import {
  createInformativeDraft,
  decideInformativeDraft,
} from "./ai-informative";
import { runTelegramTaskAction } from "./actions";
import {
  parseDraftCallback,
  parseTaskCallback,
  parseTelegramStartToken,
  type TelegramApi,
  type TelegramMessage,
  type TelegramUpdate,
} from "./endpoint";
import {
  consumeTelegramLinkToken,
  getActiveTelegramConnectionByTelegramUserId,
  touchTelegramConnection,
} from "./endpoint-repository";

type Connection = NonNullable<
  Awaited<ReturnType<typeof getActiveTelegramConnectionByTelegramUserId>>
>;

const STATUS_LABEL: Record<(typeof schema.tasks.$inferSelect)["status"], string> = {
  pending: "Pendente",
  in_progress: "Em andamento",
  awaiting_approval: "Aguardando aprovação",
  completed: "Concluída",
  rejected: "Devolvida",
  cancelled: "Cancelada",
};

const NATURAL_MISSION_GUIDANCE =
  "Envie a nova missão em uma única mensagem, do seu jeito. Diga o que precisa ser feito, quem será o responsável e, quando houver, a empresa e o prazo. A ordem e a formatação não importam.";

function appUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL;
  if (!base) return path;
  return new URL(path, base.endsWith("/") ? base : `${base}/`).toString();
}

function roleOf(value: string): OrgRole | null {
  return value === "owner" || value === "admin" || value === "member" ? value : null;
}

async function activeActor(connection: Connection) {
  const membership = await db.query.member.findFirst({
    where: and(
      eq(schema.member.organizationId, connection.orgId),
      eq(schema.member.userId, connection.userId),
    ),
    columns: { role: true },
  });
  const role = membership && roleOf(membership.role);
  return role ? { orgId: connection.orgId, userId: connection.userId, role } : null;
}

async function handleMessage(api: TelegramApi, message: TelegramMessage): Promise<void> {
  if (!message.from || message.from.is_bot || !message.text) return;

  if (message.chat.type !== "private") {
    return;
  }

  const telegramUserId = String(message.from.id);
  const startToken = parseTelegramStartToken(message.text);
  if (startToken) {
    const linked = await consumeTelegramLinkToken(startToken, {
      telegramUserId,
      chatId: String(message.chat.id),
      username: message.from.username,
      firstName: message.from.first_name,
      lastName: message.from.last_name,
      languageCode: message.from.language_code,
    });
    await api.sendMessage(
      message.chat.id,
      linked
        ? `Telegram conectado à Guilda. Agora você pode criar missões escrevendo normalmente.\n\n${NATURAL_MISSION_GUIDANCE}`
        : "Este link é inválido, expirou ou já foi usado. Gere outro no seu perfil.",
    );
    return;
  }

  const connection = await getActiveTelegramConnectionByTelegramUserId(telegramUserId);
  if (!connection) {
    await api.sendMessage(
      message.chat.id,
      "Conecte o Telegram pelo seu perfil na Guilda antes de criar missões.",
    );
    return;
  }
  await touchTelegramConnection(connection, String(message.chat.id));

  const actor = await activeActor(connection);
  if (!actor) {
    await api.sendMessage(
      message.chat.id,
      "Seu vínculo não tem mais acesso à guilda. Reconecte pelo seu perfil.",
    );
    return;
  }
  try {
    await createInformativeDraft(
      api,
      message.chat.id,
      connection.id,
      actor,
      message.text,
    );
  } catch (error) {
    console.error("Falha ao interpretar solicitação do Telegram", {
      orgId: actor.orgId,
      userId: actor.userId,
      error: error instanceof Error ? error.message : error,
    });
    await api.sendMessage(
      message.chat.id,
      `Não consegui analisar a solicitação: ${error instanceof Error ? error.message : "falha desconhecida"}`,
    );
  }
}

async function handleCallback(
  api: TelegramApi,
  callback: NonNullable<TelegramUpdate["callback_query"]>,
): Promise<void> {
  const taskCallback = callback.data && parseTaskCallback(callback.data);
  const draftCallback = callback.data && parseDraftCallback(callback.data);
  if ((!taskCallback && !draftCallback) || !callback.message || callback.message.chat.type !== "private") {
    await api.answerCallbackQuery(callback.id, { text: "Ação inválida.", showAlert: true });
    return;
  }

  const connection = await getActiveTelegramConnectionByTelegramUserId(
    String(callback.from.id),
  );
  if (!connection || String(callback.message.chat.id) !== connection.chatId) {
    await api.answerCallbackQuery(callback.id, {
      text: "Reconecte seu Telegram pelo perfil.",
      showAlert: true,
    });
    return;
  }

  if (draftCallback) {
    const actor = await activeActor(connection);
    if (!actor) {
      await api.answerCallbackQuery(callback.id, {
        text: "Seu acesso à Guilda não está ativo.",
        showAlert: true,
      });
      return;
    }
    const result = await decideInformativeDraft(
      actor,
      connection.id,
      draftCallback.draftId,
      draftCallback.action,
    );
    await api.answerCallbackQuery(callback.id, {
      text: result.message.slice(0, 200),
      showAlert: !result.ok,
    });
    await api.sendMessage(callback.message.chat.id, result.message);
    return;
  }

  if (!taskCallback) return;
  if (taskCallback.action === "reject" || taskCallback.action === "cancel") {
    await api.answerCallbackQuery(callback.id, {
      text: "Abra a missão no painel para informar o motivo.",
      showAlert: true,
    });
    await api.sendMessage(callback.message.chat.id, "Conclua esta ação no painel da Guilda.", {
      replyMarkup: {
        inline_keyboard: [[
          { text: "Abrir missão", url: appUrl(`/tasks/${taskCallback.taskId}`) },
        ]],
      },
    });
    return;
  }

  const result = await runTelegramTaskAction({
    orgId: connection.orgId,
    userId: connection.userId,
    taskId: taskCallback.taskId,
    action: taskCallback.action,
  });
  await api.answerCallbackQuery(callback.id, {
    text: result.ok ? "Missão atualizada." : result.error,
    showAlert: !result.ok,
  });
  if (result.ok) {
    await api.sendMessage(
      callback.message.chat.id,
      `${result.title}\n${STATUS_LABEL[result.status]}`,
    );
  }
}

export async function processTelegramUpdate(
  api: TelegramApi,
  update: TelegramUpdate,
): Promise<void> {
  if (update.callback_query) {
    await handleCallback(api, update.callback_query);
    return;
  }
  if (update.message) await handleMessage(api, update.message);
}
