import "server-only";

import { and, eq, inArray, isNotNull } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";

// O v1 foi classificado como Marketing; o v2 é somente atualização operacional.
export const MEMBER_NEW_CLIENT_TEMPLATE = "guilda_novo_cliente_v2";
/** Janela de 24 horas da Meta, com 10 minutos de folga. */
export const MEMBER_WINDOW_MS = (24 * 60 - 10) * 60 * 1000;

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
 * Sem link, a pedido do Bruno: o aviso só avisa.
 */
export type MemberSupportPayload = Readonly<{
  version: 2;
  kind: "support_conversation";
  contactName: string;
  clanName: string;
  summary: string;
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
  return [payload.companyName.slice(0, 80), payload.clanName.slice(0, 60)];
}

export function memberSupportHandoffMessage(payload: MemberSupportPayload): string {
  return [
    "Nova conversa no Atendimento",
    "",
    `Cliente: ${payload.contactName}`,
    `Clã: ${payload.clanName}`,
    ...(payload.summary ? [`Assunto: ${payload.summary}`] : []),
  ].join("\n");
}

/**
 * Enfileira o aviso de conversa encaminhada pelo agente para quem foi escolhido
 * (a pessoa do assunto, o líder ou o clã inteiro, em routing.ts). Só recebe
 * quem conectou o WhatsApp e ainda é da organização. A chave inclui a rodada:
 * encaminhar de novo numa rodada nova avisa de novo; repetir a gravação, não.
 */
export async function enqueueMemberSupportHandoffNotifications(
  tx: OrgTx,
  input: {
    orgId: string;
    userIds: readonly string[];
    conversationId: string;
    roundKey: string;
    clanName: string;
    contactName: string;
    summary: string;
    /** Fora do expediente, a abertura (2026-11-23); sem ele, sai na hora. */
    scheduledFor?: Date | null;
  },
): Promise<void> {
  if (input.userIds.length === 0) return;
  const members = await tx
    .select({ userId: schema.memberWhatsAppConnections.userId })
    .from(schema.memberWhatsAppConnections)
    .innerJoin(schema.member, and(
      eq(schema.member.organizationId, schema.memberWhatsAppConnections.orgId),
      eq(schema.member.userId, schema.memberWhatsAppConnections.userId),
    ))
    .where(and(
      eq(schema.memberWhatsAppConnections.orgId, input.orgId),
      inArray(schema.memberWhatsAppConnections.userId, [...input.userIds]),
      eq(schema.memberWhatsAppConnections.enabled, true),
      isNotNull(schema.memberWhatsAppConnections.verifiedAt),
    ));
  const payload: MemberSupportPayload = {
    version: 2,
    kind: "support_conversation",
    contactName: input.contactName.slice(0, 120),
    clanName: input.clanName.slice(0, 100),
    summary: input.summary.slice(0, 280),
  };
  for (const member of members) {
    await tx.insert(schema.memberWhatsAppOutbox).values({
      orgId: input.orgId,
      userId: member.userId,
      supportConversationId: input.conversationId,
      dedupeKey: `support-conversation:${input.conversationId}:${input.roundKey}:user:${member.userId}`,
      payload,
      ...(input.scheduledFor ? { scheduledFor: input.scheduledFor } : {}),
    }).onConflictDoNothing();
  }
}

export function hasOpenMemberWhatsAppWindow(lastInboundAt: Date | null, now = new Date()): boolean {
  return Boolean(lastInboundAt && now.getTime() - lastInboundAt.getTime() < MEMBER_WINDOW_MS);
}
