import "server-only";

import { and, eq, inArray } from "drizzle-orm";

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

/**
 * Conversa do Atendimento que o agente encaminhou ao clã (2026-11-19). Só sai
 * dentro da janela de 24 horas: o modelo Utility aprovado fala de "novo
 * cliente", e o de conversa fica para quando o agente atender cliente real.
 */
export type MemberSupportPayload = Readonly<{
  version: 2;
  kind: "support_conversation";
  contactName: string;
  clanName: string;
  summary: string;
  url: string;
}>

export function normalizeWhatsAppPhone(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  return /^[1-9][0-9]{7,14}$/.test(digits) ? `+${digits}` : null;
}

/**
 * O número que a pessoa digita no Perfil. Sem o "+", DDD e número (10 ou 11
 * dígitos) são do Brasil: "(54) 99999-0000" virava +54…, um número da
 * Argentina. Com o "+", vale o código de país escrito. Número do Brasil precisa
 * ter DDD e 8 ou 9 dígitos.
 */
export function normalizeMemberPhoneInput(value: unknown): string | null {
  const text = String(value ?? "").trim();
  const digits = text.replace(/\D/g, "");
  const national = text.startsWith("+") ? digits : digits.replace(/^0+/, "");
  const withCountry = !text.startsWith("+") && (national.length === 10 || national.length === 11) ? `55${national}` : national;
  const phone = normalizeWhatsAppPhone(withCountry);
  if (phone?.startsWith("+55") && phone.length !== 13 && phone.length !== 14) return null;
  return phone;
}

/**
 * Celular brasileiro aparece com e sem o nono dígito: o WhatsApp manda o
 * número da conta (wa_id), que em conta antiga vem sem o 9, enquanto a pessoa
 * digita com ele. Os dois formatos são o mesmo WhatsApp. Fixo (começa com 2 a
 * 5) e outros países ficam como estão.
 */
export function whatsAppPhoneVariants(phoneE164: string): string[] {
  const withNine = /^\+55(\d{2})9(\d{8})$/.exec(phoneE164);
  if (withNine) return [phoneE164, `+55${withNine[1]}${withNine[2]}`];
  const withoutNine = /^\+55(\d{2})([6-9]\d{7})$/.exec(phoneE164);
  if (withoutNine) return [phoneE164, `+55${withoutNine[1]}9${withoutNine[2]}`];
  return [phoneE164];
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

export function memberSupportHandoffMessage(payload: MemberSupportPayload): string {
  return [
    "Nova conversa no Atendimento",
    "",
    `Cliente: ${payload.contactName}`,
    `Clã: ${payload.clanName}`,
    ...(payload.summary ? [`Assunto: ${payload.summary}`] : []),
    "",
    `Abrir: ${payload.url}`,
  ].join("\n");
}

function appBaseUrl(): string | null {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") || null;
}

/** Integrantes do clã que conectaram o WhatsApp no Perfil e deixaram os avisos ligados. */
async function clanMembersWithWhatsApp(tx: OrgTx, orgId: string, clanId: string): Promise<{ userId: string }[]> {
  return tx
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
      eq(schema.clanMemberships.orgId, orgId),
      eq(schema.clanMemberships.clanId, clanId),
    ));
}

/**
 * Enfileira o aviso de conversa encaminhada pelo agente para cada integrante
 * do clã. A chave inclui a rodada: encaminhar de novo numa rodada nova avisa
 * de novo; repetir a mesma gravação, não.
 */
export async function enqueueMemberSupportHandoffNotifications(
  tx: OrgTx,
  input: { orgId: string; clanId: string; conversationId: string; roundKey: string; clanName: string; contactName: string; summary: string },
): Promise<void> {
  const members = await clanMembersWithWhatsApp(tx, input.orgId, input.clanId);
  const appUrl = appBaseUrl();
  const payload: MemberSupportPayload = {
    version: 2,
    kind: "support_conversation",
    contactName: input.contactName.slice(0, 120),
    clanName: input.clanName.slice(0, 100),
    summary: input.summary.slice(0, 280),
    url: appUrl ? `${appUrl}/atendimento?c=${input.conversationId}` : "Abra o Atendimento da Guilda para ver a conversa.",
  };
  for (const member of members) {
    await tx.insert(schema.memberWhatsAppOutbox).values({
      orgId: input.orgId,
      userId: member.userId,
      supportConversationId: input.conversationId,
      dedupeKey: `support-conversation:${input.conversationId}:${input.roundKey}:user:${member.userId}`,
      payload,
    }).onConflictDoNothing();
  }
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
  const members = await clanMembersWithWhatsApp(tx, input.orgId, input.clanId);

  const appUrl = appBaseUrl();
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
      inArray(schema.memberWhatsAppConnections.phoneE164, whatsAppPhoneVariants(input.phoneE164)),
      eq(schema.memberWhatsAppConnections.enabled, true),
    ))
    .returning({ id: schema.memberWhatsAppConnections.id });
  return result.length > 0;
}

export async function isActiveMemberWhatsAppPhone(tx: OrgTx, input: { orgId: string; phoneE164: string }): Promise<boolean> {
  const row = await tx.query.memberWhatsAppConnections.findFirst({
    where: and(
      eq(schema.memberWhatsAppConnections.orgId, input.orgId),
      inArray(schema.memberWhatsAppConnections.phoneE164, whatsAppPhoneVariants(input.phoneE164)),
      eq(schema.memberWhatsAppConnections.enabled, true),
    ),
    columns: { id: true },
  });
  return Boolean(row);
}

export async function activeMemberWhatsAppConnection(tx: OrgTx, input: { orgId: string; userId: string }) {
  return tx.query.memberWhatsAppConnections.findFirst({
    where: and(eq(schema.memberWhatsAppConnections.orgId, input.orgId), eq(schema.memberWhatsAppConnections.userId, input.userId), eq(schema.memberWhatsAppConnections.enabled, true)),
  });
}
