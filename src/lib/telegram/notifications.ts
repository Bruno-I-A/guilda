import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";

import type { TelegramNotificationPayload } from "./notification-payload";

export async function enqueueTelegramNotification(
  tx: OrgTx,
  input: {
    orgId: string;
    userId: string;
    eventType: string;
    dedupeKey: string;
    payload: TelegramNotificationPayload;
    scheduledFor?: Date;
  },
): Promise<void> {
  await tx
    .insert(schema.telegramOutbox)
    .values({
      orgId: input.orgId,
      userId: input.userId,
      eventType: input.eventType.slice(0, 80),
      dedupeKey: input.dedupeKey.slice(0, 255),
      payload: input.payload,
      scheduledFor: input.scheduledFor,
    })
    .onConflictDoNothing();
}

export async function enqueueTelegramNotificationIfEnabled(
  tx: OrgTx,
  input: {
    orgId: string;
    userId: string;
    eventType: string;
    dedupeKey: string;
    payload: TelegramNotificationPayload;
    scheduledFor?: Date;
  },
): Promise<void> {
  const connection = await tx.query.telegramConnections.findFirst({
    where: and(
      eq(schema.telegramConnections.orgId, input.orgId),
      eq(schema.telegramConnections.userId, input.userId),
      isNull(schema.telegramConnections.revokedAt),
    ),
    columns: { id: true },
  });
  if (!connection) return;

  const preferences = await tx.query.telegramPreferences.findFirst({
    where: and(
      eq(schema.telegramPreferences.orgId, input.orgId),
      eq(schema.telegramPreferences.userId, input.userId),
    ),
  });
  const preferenceEnabled =
    input.payload.preference === "tasks"
      ? preferences?.taskNotifications ?? true
      : input.payload.preference === "approvals"
        ? preferences?.approvalNotifications ?? true
        : input.payload.preference === "deadlines"
          ? preferences?.deadlineReminders ?? true
          : input.payload.preference === "xp"
            ? preferences?.xpNotifications ?? true
            : input.payload.preference === "closings"
              ? preferences?.closingNotifications ?? true
              : input.payload.preference === "campaigns"
                ? preferences?.campaignNotifications ?? true
                : input.payload.preference === "mural"
                  ? preferences?.muralNotifications ?? true
                  : preferences?.dailySummary ?? false;
  if (!preferenceEnabled) return;

  await tx
    .insert(schema.telegramOutbox)
    .values({
      orgId: input.orgId,
      userId: input.userId,
      connectionId: connection.id,
      eventType: input.eventType.slice(0, 80),
      dedupeKey: input.dedupeKey.slice(0, 255),
      payload: input.payload,
      scheduledFor: input.scheduledFor,
    })
    .onConflictDoNothing();
}

export function notificationPayload(
  preference: TelegramNotificationPayload["preference"],
  text: string,
  keyboard?: TelegramNotificationPayload["keyboard"],
): TelegramNotificationPayload {
  return {
    version: 1,
    text: text.slice(0, 4096),
    preference,
    ...(keyboard?.length ? { keyboard } : {}),
  };
}

export async function enqueueTelegramOrgBroadcast(
  tx: OrgTx,
  input: {
    orgId: string;
    eventType: string;
    dedupeKey: string;
    payload: TelegramNotificationPayload;
  },
): Promise<void> {
  // O INNER JOIN com `member` é a trava: quem saiu da organização para de
  // receber mesmo que a conexão do bot tenha sobrevivido por algum caminho.
  // O offboarding já revoga (cleanupRemovedOrganizationMemberClans), mas o
  // broadcast enumera conexões, e enumerar sem provar o vínculo é o que
  // fazia um ex-integrante continuar recebendo o Mural e os fechamentos.
  const connections = await tx
    .select({ userId: schema.telegramConnections.userId })
    .from(schema.telegramConnections)
    .innerJoin(
      schema.member,
      and(
        eq(schema.member.organizationId, schema.telegramConnections.orgId),
        eq(schema.member.userId, schema.telegramConnections.userId),
      ),
    )
    .where(
      and(
        eq(schema.telegramConnections.orgId, input.orgId),
        isNull(schema.telegramConnections.revokedAt),
        eq(schema.member.organizationId, input.orgId),
      ),
    );
  for (const connection of connections) {
    await enqueueTelegramNotificationIfEnabled(tx, {
      ...input,
      userId: connection.userId,
      dedupeKey: `${input.dedupeKey}:user:${connection.userId}`,
    });
  }
}

/**
 * Avisa TODOS os integrantes ativos de um clã.
 *
 * `createTaskRecord` já notifica missão de clã, mas só para a liderança — faz
 * sentido quando a missão vai ser distribuída pela Mesa. Quando o aviso é "algo
 * novo chegou para o clã", quem precisa saber é a equipe inteira.
 *
 * Os três INNER JOIN são a trava, pela mesma razão do broadcast da organização:
 * a conexão do Telegram sobrevive a mudanças de vínculo, então enumerar
 * conexões sem provar que a pessoa ainda está na organização E no clã é o que
 * faz ex-integrante continuar recebendo. Clã inativo não notifica ninguém.
 */
export async function enqueueTelegramClanBroadcast(
  tx: OrgTx,
  input: {
    orgId: string;
    clanId: string;
    eventType: string;
    dedupeKey: string;
    payload: TelegramNotificationPayload;
    /** Não avisa quem já recebeu a missão nominalmente. */
    exceptUserId?: string;
  },
): Promise<void> {
  const destinatarios = await tx
    .selectDistinct({ userId: schema.telegramConnections.userId })
    .from(schema.telegramConnections)
    .innerJoin(
      schema.member,
      and(
        eq(schema.member.organizationId, schema.telegramConnections.orgId),
        eq(schema.member.userId, schema.telegramConnections.userId),
      ),
    )
    .innerJoin(
      schema.clanMemberships,
      and(
        eq(schema.clanMemberships.orgId, schema.telegramConnections.orgId),
        eq(schema.clanMemberships.userId, schema.telegramConnections.userId),
        eq(schema.clanMemberships.clanId, input.clanId),
      ),
    )
    .innerJoin(
      schema.clans,
      and(
        eq(schema.clans.orgId, schema.clanMemberships.orgId),
        eq(schema.clans.id, schema.clanMemberships.clanId),
        eq(schema.clans.active, true),
      ),
    )
    .where(
      and(
        eq(schema.telegramConnections.orgId, input.orgId),
        isNull(schema.telegramConnections.revokedAt),
      ),
    );

  for (const destinatario of destinatarios) {
    if (destinatario.userId === input.exceptUserId) continue;
    await enqueueTelegramNotificationIfEnabled(tx, {
      orgId: input.orgId,
      eventType: input.eventType,
      dedupeKey: `${input.dedupeKey}:user:${destinatario.userId}`,
      payload: input.payload,
      userId: destinatario.userId,
    });
  }
}
