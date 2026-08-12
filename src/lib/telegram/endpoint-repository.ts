import "server-only";

import { and, eq, gt, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";

import { hashTelegramLinkToken } from "./link-token";

export interface ActiveTelegramConnection {
  id: string;
  orgId: string;
  userId: string;
  telegramUserId: string;
  chatId: string;
}

export interface TelegramIdentity {
  telegramUserId: string;
  chatId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  languageCode?: string;
}

function telegramId(value: string): number | null {
  if (!/^-?\d{1,16}$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export async function claimTelegramUpdate(updateId: string): Promise<boolean> {
  const id = telegramId(updateId);
  if (id === null || id < 0) return false;
  const claimed = await db.execute<{ update_id: string | number }>(
    sql`INSERT INTO public.telegram_updates (update_id)
        VALUES (${id}::bigint)
        ON CONFLICT (update_id) DO UPDATE
        SET locked_at = statement_timestamp(),
            attempt_count = public.telegram_updates.attempt_count + 1,
            last_error = NULL
        WHERE public.telegram_updates.processed_at IS NULL
          AND (
            public.telegram_updates.last_error IS NOT NULL
            OR public.telegram_updates.locked_at < statement_timestamp() - interval '5 minutes'
          )
        RETURNING update_id`,
  );
  return claimed.rows.length === 1;
}

export async function markTelegramUpdateProcessed(updateId: string): Promise<void> {
  const id = telegramId(updateId);
  if (id === null) return;
  await db
    .update(schema.telegramUpdates)
    .set({ processedAt: new Date(), lastError: null })
    .where(eq(schema.telegramUpdates.updateId, id));
}

export async function markTelegramUpdateFailed(
  updateId: string,
  error: unknown,
): Promise<void> {
  const id = telegramId(updateId);
  if (id === null) return;
  const detail = error instanceof Error ? error.message : "Falha desconhecida";
  await db
    .update(schema.telegramUpdates)
    .set({ lastError: detail.slice(0, 2000) })
    .where(eq(schema.telegramUpdates.updateId, id));
}

type LookupConnectionRow = {
  connection_id: string;
  org_id: string;
  user_id: string;
  chat_id: string | number;
};

export async function getActiveTelegramConnectionByTelegramUserId(
  telegramUserId: string,
): Promise<ActiveTelegramConnection | null> {
  const id = telegramId(telegramUserId);
  if (id === null) return null;
  const result = await db.execute<LookupConnectionRow>(
    sql`SELECT connection_id, org_id, user_id, chat_id
        FROM public.lookup_telegram_connection(${id}::bigint)`,
  );
  const row = result.rows[0];
  return row
    ? {
        id: row.connection_id,
        orgId: row.org_id,
        userId: row.user_id,
        telegramUserId,
        chatId: String(row.chat_id),
      }
    : null;
}

export async function getActiveTelegramConnectionByUserId(
  orgId: string,
  userId: string,
): Promise<ActiveTelegramConnection | null> {
  return withOrgTx(orgId, async (tx) => {
    const connection = await tx.query.telegramConnections.findFirst({
      where: and(
        eq(schema.telegramConnections.orgId, orgId),
        eq(schema.telegramConnections.userId, userId),
        isNull(schema.telegramConnections.revokedAt),
      ),
    });
    return connection
      ? {
          id: connection.id,
          orgId,
          userId,
          telegramUserId: String(connection.telegramUserId),
          chatId: String(connection.chatId),
        }
      : null;
  });
}

type ResolveTokenRow = { token_id: string; org_id: string; user_id: string };

/** Consome o token em uma transação; nenhum token cru é persistido. */
export async function consumeTelegramLinkToken(
  rawToken: string,
  identity: TelegramIdentity,
): Promise<{ orgId: string; userId: string } | null> {
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(rawToken)) return null;
  const userId = telegramId(identity.telegramUserId);
  const chatId = telegramId(identity.chatId);
  if (userId === null || chatId === null) return null;

  // As funções SECURITY DEFINER revelam somente os IDs mínimos necessários
  // antes de conhecermos o tenant; todas as mutações seguintes passam por RLS.
  const resolved = await db.execute<ResolveTokenRow>(
    sql`SELECT token_id, org_id, user_id
        FROM public.resolve_telegram_link_token(${hashTelegramLinkToken(rawToken)})`,
  );
  const token = resolved.rows[0];
  if (!token) return null;

  const existingTelegram =
    await getActiveTelegramConnectionByTelegramUserId(identity.telegramUserId);
  if (
    existingTelegram &&
    (existingTelegram.orgId !== token.org_id || existingTelegram.userId !== token.user_id)
  ) {
    return null;
  }

  return withOrgTx(token.org_id, async (tx) => {
    const consumed = await tx
      .update(schema.telegramLinkTokens)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(schema.telegramLinkTokens.id, token.token_id),
          eq(schema.telegramLinkTokens.orgId, token.org_id),
          isNull(schema.telegramLinkTokens.consumedAt),
          gt(schema.telegramLinkTokens.expiresAt, new Date()),
        ),
      )
      .returning({ id: schema.telegramLinkTokens.id });
    if (!consumed.length) return null;

    if (existingTelegram) {
      await tx
        .update(schema.telegramConnections)
        .set({
          chatId,
          username: identity.username?.slice(0, 64) ?? null,
          firstName: identity.firstName?.slice(0, 255) ?? null,
          lastName: identity.lastName?.slice(0, 255) ?? null,
          languageCode: identity.languageCode?.slice(0, 16) ?? null,
          lastSeenAt: new Date(),
        })
        .where(
          and(
            eq(schema.telegramConnections.id, existingTelegram.id),
            eq(schema.telegramConnections.orgId, token.org_id),
          ),
        );
    } else {
      // Um novo vínculo substitui o Telegram anterior desta mesma conta.
      await tx
        .update(schema.telegramConnections)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(schema.telegramConnections.orgId, token.org_id),
            eq(schema.telegramConnections.userId, token.user_id),
            isNull(schema.telegramConnections.revokedAt),
          ),
        );
      await tx.insert(schema.telegramConnections).values({
        orgId: token.org_id,
        userId: token.user_id,
        telegramUserId: userId,
        chatId,
        username: identity.username?.slice(0, 64) ?? null,
        firstName: identity.firstName?.slice(0, 255) ?? null,
        lastName: identity.lastName?.slice(0, 255) ?? null,
        languageCode: identity.languageCode?.slice(0, 16) ?? null,
      });
    }

    await tx
      .insert(schema.telegramPreferences)
      .values({ orgId: token.org_id, userId: token.user_id })
      .onConflictDoNothing();
    return { orgId: token.org_id, userId: token.user_id };
  });
}

export async function touchTelegramConnection(
  connection: ActiveTelegramConnection,
  chatIdValue: string,
): Promise<void> {
  const chatId = telegramId(chatIdValue);
  if (chatId === null || connection.chatId !== chatIdValue) return;
  await withOrgTx(connection.orgId, (tx) =>
    tx
      .update(schema.telegramConnections)
      .set({ lastSeenAt: new Date() })
      .where(
        and(
          eq(schema.telegramConnections.id, connection.id),
          eq(schema.telegramConnections.orgId, connection.orgId),
          isNull(schema.telegramConnections.revokedAt),
        ),
      ),
  );
}
