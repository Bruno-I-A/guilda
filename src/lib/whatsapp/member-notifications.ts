import "server-only";

import { and, eq } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";

export const MEMBER_NEW_CLIENT_TEMPLATE = "guilda_novo_cliente";
const WINDOW_MS = (24 * 60 - 10) * 60 * 1000;

export type MemberNotificationPayload = Readonly<{
  version: 1;
  title: string;
  companyName: string;
  clanName: string;
  url: string;
}>;

export function normalizeWhatsAppPhone(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  return /^[1-9][0-9]{7,14}$/.test(digits) ? `+${digits}` : null;
}

/** Text and parameters are deliberately short: the same content works as normal text or Utility template. */
export function memberNewClientMessage(payload: MemberNotificationPayload): string {
  return [
    "Novo cliente na Guilda",
    "",
    `Empresa: ${payload.companyName}`,
    `Clã: ${payload.clanName}`,
    "",
    `Abrir: ${payload.url}`,
  ].join("\n");
}

export function memberNewClientTemplateParams(payload: MemberNotificationPayload): string[] {
  return [payload.companyName.slice(0, 80), payload.clanName.slice(0, 60), payload.url.slice(0, 200)];
}

export function hasOpenMemberWhatsAppWindow(lastInboundAt: Date | null, now = new Date()): boolean {
  return Boolean(lastInboundAt && now.getTime() - lastInboundAt.getTime() < WINDOW_MS);
}

/**
 * Enfileira para cada integrante ativo do clã. A unicidade por fluxo+usuário
 * evita aviso duplicado quando o formulário é reenviado.
 */
export async function enqueueMemberNewClientNotifications(
  tx: OrgTx,
  input: { orgId: string; clanId: string; companyFlowId: string; companyName: string; clanName: string },
): Promise<void> {
  const members = await tx
    .selectDistinct({ userId: schema.clanMemberships.userId })
    .from(schema.clanMemberships)
    .innerJoin(schema.member, and(
      eq(schema.member.organizationId, schema.clanMemberships.orgId),
      eq(schema.member.userId, schema.clanMemberships.userId),
    ))
    .innerJoin(schema.memberWhatsAppConnections, and(
      eq(schema.memberWhatsAppConnections.orgId, schema.clanMemberships.orgId),
      eq(schema.memberWhatsAppConnections.userId, schema.clanMemberships.userId),
      eq(schema.memberWhatsAppConnections.enabled, true),
    ))
    .where(and(
      eq(schema.clanMemberships.orgId, input.orgId),
      eq(schema.clanMemberships.clanId, input.clanId),
    ));

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
  const payload: MemberNotificationPayload = {
    version: 1,
    title: "Novo cliente",
    companyName: input.companyName.slice(0, 180),
    clanName: input.clanName.slice(0, 100),
    url: appUrl ? `${appUrl}/clans/${input.clanId}?flow=${input.companyFlowId}` : "Abra a Guilda para ver o novo cliente.",
  };
  for (const member of members) {
    await tx.insert(schema.memberWhatsAppOutbox).values({
      orgId: input.orgId,
      userId: member.userId,
      companyFlowId: input.companyFlowId,
      dedupeKey: `company-flow:${input.companyFlowId}:user:${member.userId}`,
      payload,
    }).onConflictDoNothing();
  }
}

export async function recordMemberWhatsAppInbound(
  tx: OrgTx,
  input: { orgId: string; phoneE164: string; occurredAt: Date },
): Promise<boolean> {
  const result = await tx.update(schema.memberWhatsAppConnections)
    .set({ lastInboundAt: input.occurredAt, updatedAt: new Date() })
    .where(and(
      eq(schema.memberWhatsAppConnections.orgId, input.orgId),
      eq(schema.memberWhatsAppConnections.phoneE164, input.phoneE164),
      eq(schema.memberWhatsAppConnections.enabled, true),
    ))
    .returning({ id: schema.memberWhatsAppConnections.id });
  return result.length > 0;
}

export async function isActiveMemberWhatsAppPhone(tx: OrgTx, input: { orgId: string; phoneE164: string }): Promise<boolean> {
  const row = await tx.query.memberWhatsAppConnections.findFirst({
    where: and(eq(schema.memberWhatsAppConnections.orgId, input.orgId), eq(schema.memberWhatsAppConnections.phoneE164, input.phoneE164), eq(schema.memberWhatsAppConnections.enabled, true)),
    columns: { id: true },
  });
  return Boolean(row);
}

export async function activeMemberWhatsAppConnection(tx: OrgTx, input: { orgId: string; userId: string }) {
  return tx.query.memberWhatsAppConnections.findFirst({
    where: and(eq(schema.memberWhatsAppConnections.orgId, input.orgId), eq(schema.memberWhatsAppConnections.userId, input.userId), eq(schema.memberWhatsAppConnections.enabled, true)),
  });
}
