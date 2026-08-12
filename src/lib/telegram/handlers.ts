import "server-only";

import { and, asc, desc, eq, gte, lt, lte, notInArray, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { authorizeTransition, type OrgRole } from "@/domain/task-state";
import { levelProgress } from "@/domain/xp";
import { getLeaderboard, getUserXpTotal } from "@/lib/xp-queries";

import { runTelegramTaskAction } from "./actions";
import {
  encodeTaskCallback,
  parseBotCommand,
  parseTaskCallback,
  type InlineKeyboardButton,
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

function brDate(value: Date | string | null): string {
  if (!value) return "sem prazo";
  const date = typeof value === "string" ? new Date(`${value}T12:00:00Z`) : value;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function localDateKey(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function saoPauloDayBounds(now = new Date()): { start: Date; end: Date } {
  // America/Sao_Paulo não observa horário de verão desde 2019. Esses
  // limites mantêm a semântica de prazo local usada pelo produto.
  const key = localDateKey(now);
  return {
    start: new Date(`${key}T03:00:00.000Z`),
    end: new Date(new Date(`${key}T03:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000),
  };
}

type TaskListItem = {
  id: string;
  title: string;
  dueDate: Date | null;
  status: (typeof schema.tasks.$inferSelect)["status"];
  xpValue: number;
  creatorId: string;
  assigneeId: string;
};

const STATUS_LABEL: Record<TaskListItem["status"], string> = {
  pending: "Pendente",
  in_progress: "Em andamento",
  awaiting_approval: "Aguardando aprovação",
  completed: "Concluída",
  rejected: "Devolvida",
  cancelled: "Cancelada",
};

function taskButtons(
  task: TaskListItem,
  actor: { userId: string; role: OrgRole },
): InlineKeyboardButton[][] {
  const context = {
    actor: { id: actor.userId, role: actor.role },
    task: {
      creatorId: task.creatorId,
      assigneeId: task.assigneeId,
      status: task.status,
    },
  };
  const row: InlineKeyboardButton[] = [];
  if (
    (task.status === "pending" || task.status === "rejected") &&
    authorizeTransition("in_progress", context).allowed
  ) {
    row.push({
      text: task.status === "rejected" ? "Retomar" : "Iniciar",
      callback_data: encodeTaskCallback("start", task.id),
    });
  }
  if (task.status === "in_progress") {
    if (authorizeTransition("completed", context).allowed) {
      row.push({ text: "Concluir", callback_data: encodeTaskCallback("complete", task.id) });
    } else if (authorizeTransition("awaiting_approval", context).allowed) {
      row.push({ text: "Enviar", callback_data: encodeTaskCallback("submit", task.id) });
    }
  }
  if (
    task.status === "awaiting_approval" &&
    authorizeTransition("completed", context).allowed
  ) {
    row.push({ text: "Aprovar", callback_data: encodeTaskCallback("approve", task.id) });
    row.push({ text: "Rejeitar", callback_data: encodeTaskCallback("reject", task.id) });
  }
  if (
    task.status !== "completed" &&
    task.status !== "cancelled" &&
    authorizeTransition("cancelled", context).allowed
  ) {
    row.push({ text: "Cancelar", callback_data: encodeTaskCallback("cancel", task.id) });
  }
  const open = { text: "Abrir na Guilda", url: appUrl(`/tasks/${task.id}`) };
  return row.length ? [row, [open]] : [[open]];
}

async function sendTaskList(
  api: TelegramApi,
  chatId: number,
  actor: { orgId: string; userId: string; role: OrgRole },
  title: string,
  mode: "mine" | "today" | "overdue" | "approval",
): Promise<void> {
  const now = new Date();
  const { start, end } = saoPauloDayBounds(now);
  const tasks = await withOrgTx(actor.orgId, (tx) => {
    const conditions = [eq(schema.tasks.orgId, actor.orgId)];
    if (mode === "mine") {
      conditions.push(
        eq(schema.tasks.assigneeId, actor.userId),
        notInArray(schema.tasks.status, ["completed", "cancelled"]),
      );
    } else if (mode === "today") {
      conditions.push(
        eq(schema.tasks.assigneeId, actor.userId),
        gte(schema.tasks.dueDate, start),
        lt(schema.tasks.dueDate, end),
        notInArray(schema.tasks.status, ["completed", "cancelled"]),
      );
    } else if (mode === "overdue") {
      conditions.push(
        eq(schema.tasks.assigneeId, actor.userId),
        lt(schema.tasks.dueDate, start),
        notInArray(schema.tasks.status, ["completed", "cancelled"]),
      );
    } else {
      conditions.push(eq(schema.tasks.status, "awaiting_approval"));
      if (actor.role === "member") {
        conditions.push(eq(schema.tasks.creatorId, actor.userId));
      }
    }
    return tx
      .select({
        id: schema.tasks.id,
        title: schema.tasks.title,
        dueDate: schema.tasks.dueDate,
        status: schema.tasks.status,
        xpValue: schema.tasks.xpValue,
        creatorId: schema.tasks.creatorId,
        assigneeId: schema.tasks.assigneeId,
      })
      .from(schema.tasks)
      .where(and(...conditions))
      .orderBy(asc(schema.tasks.dueDate), desc(schema.tasks.createdAt))
      .limit(10);
  });

  if (!tasks.length) {
    await api.sendMessage(chatId, `${title}\n\nNenhuma missão encontrada.`);
    return;
  }
  await api.sendMessage(
    chatId,
    `${title}\n\n${tasks.length === 10 ? "Mostrando as 10 primeiras." : `${tasks.length} encontrada(s).`}`,
  );
  for (const task of tasks) {
    await api.sendMessage(
      chatId,
      `${task.title}\n${STATUS_LABEL[task.status]} · ${brDate(task.dueDate)} · ${task.xpValue} XP`,
      { replyMarkup: { inline_keyboard: taskButtons(task, actor) } },
    );
  }
}

async function handleConnectedCommand(
  api: TelegramApi,
  message: TelegramMessage,
  connection: Connection,
  parsed: Exclude<ReturnType<typeof parseBotCommand>, null>,
): Promise<void> {
  const actor = await activeActor(connection);
  if (!actor) {
    await api.sendMessage(message.chat.id, "Seu vínculo não tem mais acesso à guilda. Reconecte pelo seu perfil.");
    return;
  }
  const chatId = message.chat.id;
  const command = parsed.command;
  if (command === "rejeitar" || command === "cancelar") {
    const match = parsed.argument?.match(
      /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\s+([\s\S]+))?$/i,
    );
    if (!match || (command === "rejeitar" && (!match[2] || match[2].trim().length < 3))) {
      await api.sendMessage(
        chatId,
        command === "rejeitar"
          ? "Use /rejeitar <id-da-missão> <motivo>. Toque novamente em Rejeitar para receber o comando pronto."
          : "Use /cancelar <id-da-missão> [motivo]. Toque novamente em Cancelar para receber o comando pronto.",
      );
      return;
    }
    const result = await runTelegramTaskAction({
      orgId: actor.orgId,
      userId: actor.userId,
      taskId: match[1],
      action: command === "rejeitar" ? "reject" : "cancel",
      note: match[2]?.trim(),
    });
    await api.sendMessage(
      chatId,
      result.ok ? `${result.title}\n${STATUS_LABEL[result.status]}` : result.error,
    );
    return;
  }
  if (command === "minhas") return sendTaskList(api, chatId, actor, "Minhas missões", "mine");
  if (command === "hoje") return sendTaskList(api, chatId, actor, "Missões de hoje", "today");
  if (command === "atrasadas") return sendTaskList(api, chatId, actor, "Missões atrasadas", "overdue");
  if (command === "aprovar") return sendTaskList(api, chatId, actor, "Fila de aprovação", "approval");

  if (command === "ranking") {
    const rows = await getLeaderboard(actor.orgId, "week");
    const text = rows.length
      ? rows.slice(0, 10).map((row, index) => `${index + 1}. ${row.name} — ${row.periodXp} XP`).join("\n")
      : "Ninguém pontuou nesta semana.";
    await api.sendMessage(chatId, `Ranking da semana\n\n${text}`, {
      replyMarkup: { inline_keyboard: [[{ text: "Ver ranking", url: appUrl("/leaderboard") }]] },
    });
    return;
  }

  if (command === "perfil") {
    const totalXp = await getUserXpTotal(actor.orgId, actor.userId);
    const progress = levelProgress(totalXp);
    await api.sendMessage(
      chatId,
      `Seu perfil\n\nNível ${progress.level}\n${totalXp} XP no total\nFaltam ${progress.nextLevelXp - progress.totalXp} XP para o próximo nível.`,
      { replyMarkup: { inline_keyboard: [[{ text: "Abrir perfil", url: appUrl("/profile") }]] } },
    );
    return;
  }

  if (command === "fechamentos" || command === "bloqueados") {
    const today = localDateKey();
    const closings = await withOrgTx(actor.orgId, (tx) =>
      tx
        .select({
          title: schema.accountingClosings.title,
          dueDate: schema.accountingClosings.dueDate,
          status: schema.accountingClosings.status,
          clientName: schema.clients.name,
        })
        .from(schema.accountingClosings)
        .innerJoin(schema.clients, eq(schema.accountingClosings.clientId, schema.clients.id))
        .where(
          and(
            eq(schema.accountingClosings.orgId, actor.orgId),
            command === "bloqueados"
              ? eq(schema.accountingClosings.status, "blocked")
              : or(
                  eq(schema.accountingClosings.status, "blocked"),
                  and(
                    eq(schema.accountingClosings.status, "pending"),
                    lte(schema.accountingClosings.dueDate, today),
                  ),
                ),
          ),
        )
        .orderBy(asc(schema.accountingClosings.dueDate))
        .limit(15),
    );
    const text = closings.length
      ? closings
          .map((item) => `${item.status === "blocked" ? "🚫" : "⏳"} ${item.clientName} · ${item.title} · ${brDate(item.dueDate)}`)
          .join("\n")
      : "Nenhum fechamento encontrado.";
    await api.sendMessage(chatId, `${command === "bloqueados" ? "Fechamentos bloqueados" : "Fechamentos pendentes"}\n\n${text}`, {
      replyMarkup: { inline_keyboard: [[{ text: "Abrir fechamentos", url: appUrl("/closings") }]] },
    });
    return;
  }

  if (command === "campanhas") {
    const [templateCount] = await withOrgTx(actor.orgId, (tx) =>
      tx
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.missionTemplates)
        .where(eq(schema.missionTemplates.orgId, actor.orgId)),
    );
    await api.sendMessage(
      chatId,
      `Campanhas\n\nA execução de campanhas ainda está em preparação. Sua guilda possui ${templateCount?.count ?? 0} template(s) pronto(s).`,
      { replyMarkup: { inline_keyboard: [[{ text: "Abrir campanhas", url: appUrl("/campaigns") }]] } },
    );
    return;
  }

  await sendHelp(api, chatId);
}

async function sendHelp(api: TelegramApi, chatId: number): Promise<void> {
  await api.sendMessage(
    chatId,
    [
      "Comandos da Guilda",
      "",
      "/minhas — suas missões abertas",
      "/hoje — missões com prazo hoje",
      "/atrasadas — suas missões vencidas",
      "/aprovar — fila de aprovação",
      "/ranking — ranking semanal",
      "/perfil — XP e nível",
      "/fechamentos — pendências operacionais",
      "/bloqueados — fechamentos bloqueados",
      "/campanhas — campanhas da guilda",
      "/rejeitar — devolve uma missão com motivo",
      "/cancelar — cancela uma missão autorizada",
      "/ajuda — esta mensagem",
    ].join("\n"),
  );
}

async function handleMessage(api: TelegramApi, message: TelegramMessage): Promise<void> {
  if (!message.from || message.from.is_bot || !message.text) return;
  // Dados operacionais nunca são publicados em grupos.
  if (message.chat.type !== "private") {
    const parsed = parseBotCommand(message.text);
    if (parsed) await api.sendMessage(message.chat.id, "Por segurança, fale comigo em uma conversa privada.");
    return;
  }
  const parsed = parseBotCommand(message.text);
  const telegramUserId = String(message.from.id);

  if (parsed?.command === "start" && parsed.argument) {
    const linked = await consumeTelegramLinkToken(parsed.argument, {
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
        ? "Telegram conectado à Guilda com sucesso. Use /ajuda para ver os comandos."
        : "Este link é inválido, expirou ou já foi usado. Gere outro no seu perfil.",
    );
    return;
  }

  const connection = await getActiveTelegramConnectionByTelegramUserId(telegramUserId);
  if (!connection) {
    await api.sendMessage(message.chat.id, "Conecte o Telegram pelo seu perfil na Guilda antes de usar o bot.");
    return;
  }
  await touchTelegramConnection(connection, String(message.chat.id));
  if (!parsed || parsed.command === "start") {
    await sendHelp(api, message.chat.id);
    return;
  }
  await handleConnectedCommand(api, message, connection, parsed);
}

async function handleCallback(
  api: TelegramApi,
  callback: NonNullable<TelegramUpdate["callback_query"]>,
): Promise<void> {
  const parsed = callback.data && parseTaskCallback(callback.data);
  if (!parsed || !callback.message || callback.message.chat.type !== "private") {
    await api.answerCallbackQuery(callback.id, { text: "Ação inválida.", showAlert: true });
    return;
  }
  const connection = await getActiveTelegramConnectionByTelegramUserId(String(callback.from.id));
  if (!connection || String(callback.message.chat.id) !== connection.chatId) {
    await api.answerCallbackQuery(callback.id, { text: "Reconecte seu Telegram pelo perfil.", showAlert: true });
    return;
  }
  if (parsed.action === "reject" || parsed.action === "cancel") {
    const command = parsed.action === "reject" ? "rejeitar" : "cancelar";
    await api.answerCallbackQuery(callback.id, {
      text:
        parsed.action === "reject"
          ? "Envie o motivo na mensagem preparada."
          : "Confirme enviando o comando preparado.",
    });
    await api.sendMessage(
      callback.message.chat.id,
      `Copie, complete e envie:\n/${command} ${parsed.taskId}${parsed.action === "reject" ? " motivo da rejeição" : " motivo opcional"}`,
    );
    return;
  }
  const result = await runTelegramTaskAction({
    orgId: connection.orgId,
    userId: connection.userId,
    taskId: parsed.taskId,
    action: parsed.action,
  });
  await api.answerCallbackQuery(callback.id, {
    text: result.ok ? "Missão atualizada." : result.error,
    showAlert: !result.ok,
  });
  if (result.ok) {
    await api.sendMessage(callback.message.chat.id, `${result.title}\n${STATUS_LABEL[result.status]}`);
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
