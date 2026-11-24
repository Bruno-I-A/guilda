import "server-only";

import { and, eq, isNotNull } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";

import type { MemberNoticePayload, MemberReplyPayload, Notice, NoticeButton, NoticePreference } from "./notice";

type Preferences = typeof schema.memberNotificationPreferences.$inferSelect;

/** Sem preferência salva valem os padrões da tabela (fechamentos desligado). */
export function preferenceEnabled(preference: NoticePreference, settings: Pick<Preferences, "taskNotifications" | "approvalNotifications" | "deadlineReminders" | "xpNotifications" | "closingNotifications" | "campaignNotifications" | "muralNotifications" | "dailySummary"> | null | undefined): boolean {
  switch (preference) {
    case "tasks": return settings?.taskNotifications ?? true;
    case "approvals": return settings?.approvalNotifications ?? true;
    case "deadlines": return settings?.deadlineReminders ?? true;
    case "xp": return settings?.xpNotifications ?? true;
    case "closings": return settings?.closingNotifications ?? false;
    case "campaigns": return settings?.campaignNotifications ?? true;
    case "mural": return settings?.muralNotifications ?? true;
    case "daily_summary": return settings?.dailySummary ?? false;
  }
}

/**
 * Conexão que pode receber: número confirmado, avisos ligados e a pessoa ainda
 * na organização. O JOIN em `member` é a trava de sempre: a conexão sobrevive a
 * quem saiu, e enumerar sem provar o vínculo mandava aviso a ex-integrante.
 */
async function receivingConnection(tx: OrgTx, orgId: string, userId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: schema.memberWhatsAppConnections.id })
    .from(schema.memberWhatsAppConnections)
    .innerJoin(schema.member, and(
      eq(schema.member.organizationId, schema.memberWhatsAppConnections.orgId),
      eq(schema.member.userId, schema.memberWhatsAppConnections.userId),
    ))
    .where(and(
      eq(schema.memberWhatsAppConnections.orgId, orgId),
      eq(schema.memberWhatsAppConnections.userId, userId),
      eq(schema.memberWhatsAppConnections.enabled, true),
      isNotNull(schema.memberWhatsAppConnections.verifiedAt),
    ))
    .limit(1);
  return Boolean(row);
}

export async function enqueueMemberNotice(
  tx: OrgTx,
  input: {
    orgId: string;
    userId: string;
    dedupeKey: string;
    preference: NoticePreference;
    notice: Notice;
    scheduledFor?: Date;
  },
): Promise<void> {
  if (!(await receivingConnection(tx, input.orgId, input.userId))) return;
  const settings = await tx.query.memberNotificationPreferences.findFirst({
    where: and(
      eq(schema.memberNotificationPreferences.orgId, input.orgId),
      eq(schema.memberNotificationPreferences.userId, input.userId),
    ),
  });
  if (!preferenceEnabled(input.preference, settings)) return;
  const payload: MemberNoticePayload = { version: 3, kind: "notice", preference: input.preference, notice: input.notice };
  await tx
    .insert(schema.memberWhatsAppOutbox)
    .values({
      orgId: input.orgId,
      userId: input.userId,
      dedupeKey: input.dedupeKey.slice(0, 255),
      payload,
      ...(input.scheduledFor ? { scheduledFor: input.scheduledFor } : {}),
    })
    .onConflictDoNothing();
}

/** Aviso para toda a Guilda (Mural com ciência, fechamentos). */
export async function enqueueOrgNotice(
  tx: OrgTx,
  input: { orgId: string; dedupeKey: string; preference: NoticePreference; notice: Notice },
): Promise<void> {
  const people = await tx
    .selectDistinct({ userId: schema.memberWhatsAppConnections.userId })
    .from(schema.memberWhatsAppConnections)
    .innerJoin(schema.member, and(
      eq(schema.member.organizationId, schema.memberWhatsAppConnections.orgId),
      eq(schema.member.userId, schema.memberWhatsAppConnections.userId),
    ))
    .where(and(
      eq(schema.memberWhatsAppConnections.orgId, input.orgId),
      eq(schema.memberWhatsAppConnections.enabled, true),
      isNotNull(schema.memberWhatsAppConnections.verifiedAt),
    ));
  for (const person of people) {
    await enqueueMemberNotice(tx, { ...input, userId: person.userId, dedupeKey: `${input.dedupeKey}:user:${person.userId}` });
  }
}

/** Aviso para todos os integrantes de um clã ativo. */
export async function enqueueClanNotice(
  tx: OrgTx,
  input: {
    orgId: string;
    clanId: string;
    dedupeKey: string;
    preference: NoticePreference;
    notice: Notice;
    /** Quem já recebeu o aviso nominal, ou quem fez a ação. */
    exceptUserIds?: readonly (string | null | undefined)[];
  },
): Promise<void> {
  const people = await tx
    .selectDistinct({ userId: schema.clanMemberships.userId })
    .from(schema.clanMemberships)
    .innerJoin(schema.clans, and(
      eq(schema.clans.orgId, schema.clanMemberships.orgId),
      eq(schema.clans.id, schema.clanMemberships.clanId),
      eq(schema.clans.active, true),
    ))
    .where(and(eq(schema.clanMemberships.orgId, input.orgId), eq(schema.clanMemberships.clanId, input.clanId)));
  const except = new Set(input.exceptUserIds?.filter(Boolean));
  for (const person of people) {
    if (except.has(person.userId)) continue;
    await enqueueMemberNotice(tx, {
      orgId: input.orgId,
      userId: person.userId,
      dedupeKey: `${input.dedupeKey}:user:${person.userId}`,
      preference: input.preference,
      notice: input.notice,
    });
  }
}

/**
 * Resposta a uma mensagem do integrante. Basta o número confirmado: quem
 * desligou os avisos continua podendo usar os botões e pedir missão.
 */
export async function enqueueMemberReply(
  tx: OrgTx,
  input: { orgId: string; userId: string; dedupeKey: string; text: string; buttons?: readonly NoticeButton[] },
): Promise<void> {
  const payload: MemberReplyPayload = {
    version: 3,
    kind: "reply",
    text: input.text.slice(0, 4096),
    ...(input.buttons?.length ? { buttons: input.buttons.slice(0, 3) } : {}),
  };
  await tx
    .insert(schema.memberWhatsAppOutbox)
    .values({ orgId: input.orgId, userId: input.userId, dedupeKey: input.dedupeKey.slice(0, 255), payload })
    .onConflictDoNothing();
}
