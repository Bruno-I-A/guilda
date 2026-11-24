import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { preferenceEnabled } from "@/lib/notices/enqueue";
import { appBaseUrl } from "@/lib/notices/links";
import {
  NOTICE_TEMPLATES,
  noticeButtons,
  noticeTemplate,
  noticeText,
  parseMemberV3Payload,
  type MemberTemplateKey,
  type MemberV3Payload,
} from "@/lib/notices/notice";
import { isQuietMinute, zonedMinute } from "@/lib/notices/schedule-time";

import { loadWhatsAppChannelAccess } from "./channel-repository";
import { getWhatsAppConfig } from "./config";
import {
  getWhatsAppTemplate,
  MetaGraphError,
  sendWhatsAppButtons,
  sendWhatsAppTemplate,
  sendWhatsAppText,
  type MetaServerConfig,
  type WhatsAppTemplateButtonParam,
} from "./meta-client";
import {
  hasOpenMemberWhatsAppWindow,
  memberNewClientMessage,
  memberNewClientTemplateParams,
  memberSupportHandoffMessage,
  MEMBER_NEW_CLIENT_TEMPLATE,
  type MemberNotificationPayload,
  type MemberSupportPayload,
} from "./member-notifications";

type Claim = Readonly<{ id: string; orgId: string; claimToken: string }>;
type Payload = MemberNotificationPayload | MemberSupportPayload | MemberV3Payload;

/** Modelo pendente é reconsultado na Meta no máximo a cada 15 minutos. */
const TEMPLATE_RECHECK_MS = 15 * 60 * 1000;
const QUIET_DEFER_MINUTES = 15;

function payload(value: unknown): Payload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.version === 3) return parseMemberV3Payload(v);
  if (v.version === 2 && v.kind === "support_conversation") {
    return typeof v.contactName === "string" && typeof v.clanName === "string"
      ? { version: 2, kind: "support_conversation", contactName: v.contactName, clanName: v.clanName, summary: typeof v.summary === "string" ? v.summary : "" }
      : null;
  }
  return v.version === 1 && typeof v.companyName === "string" && typeof v.clanName === "string" && typeof v.url === "string"
    ? { version: 1, title: typeof v.title === "string" ? v.title : "Novo cliente", companyName: v.companyName, clanName: v.clanName, url: v.url }
    : null;
}

async function claim(limit: number): Promise<Claim[]> {
  const result = await db.execute<{ outbox_id: string; org_id: string; claim_token: string }>(sql`SELECT * FROM public.claim_member_whatsapp_outbox(${limit})`);
  return result.rows.map((row) => ({ id: row.outbox_id, orgId: row.org_id, claimToken: row.claim_token }));
}

async function finish(claimed: Claim, success: boolean, detail: string | null): Promise<void> {
  await db.execute(sql`SELECT public.finish_member_whatsapp_outbox(${claimed.id}::uuid, ${claimed.claimToken}::uuid, ${success}, ${detail})`);
}

async function defer(claimed: Claim, minutes: number): Promise<void> {
  await db.execute(sql`SELECT public.defer_member_whatsapp_outbox(${claimed.id}::uuid, ${claimed.claimToken}::uuid, ${minutes})`);
}

async function load(claimed: Claim) {
  return withOrgTx(claimed.orgId, async (tx) => {
    const outbox = await tx.query.memberWhatsAppOutbox.findFirst({
      where: and(eq(schema.memberWhatsAppOutbox.id, claimed.id), eq(schema.memberWhatsAppOutbox.orgId, claimed.orgId), eq(schema.memberWhatsAppOutbox.status, "processing"), eq(schema.memberWhatsAppOutbox.lockToken, claimed.claimToken)),
    });
    if (!outbox) return null;
    const [connection, channel, preferences, templates] = await Promise.all([
      tx.query.memberWhatsAppConnections.findFirst({ where: and(eq(schema.memberWhatsAppConnections.orgId, claimed.orgId), eq(schema.memberWhatsAppConnections.userId, outbox.userId)) }),
      tx.query.supportWhatsAppChannels.findFirst({ where: and(eq(schema.supportWhatsAppChannels.orgId, claimed.orgId), eq(schema.supportWhatsAppChannels.status, "active")), orderBy: (c, { desc }) => [desc(c.updatedAt)] }),
      tx.query.memberNotificationPreferences.findFirst({ where: and(eq(schema.memberNotificationPreferences.orgId, claimed.orgId), eq(schema.memberNotificationPreferences.userId, outbox.userId)) }),
      tx.query.memberWhatsAppTemplates.findMany({ where: eq(schema.memberWhatsAppTemplates.orgId, claimed.orgId) }),
    ]);
    return { outbox, connection, channel, preferences, templates, payload: payload(outbox.payload) };
  });
}

type Loaded = NonNullable<Awaited<ReturnType<typeof load>>>;
type Access = NonNullable<Awaited<ReturnType<typeof loadWhatsAppChannelAccess>>>;

/**
 * Modelo que o aviso precisa. Pendente e consultado há mais de 15 minutos,
 * pergunta à Meta de novo: aprovado lá, passa a sair sem ninguém clicar.
 */
async function approvedTemplate(item: Loaded, access: Access, key: MemberTemplateKey, config: MetaServerConfig, fetchImpl: typeof fetch) {
  const row = item.templates.find((template) => template.key === key);
  if (!row || row.status === "not_created") return null;
  if (row.status === "APPROVED") return row;
  if (row.checkedAt && Date.now() - row.checkedAt.getTime() < TEMPLATE_RECHECK_MS) return null;
  const current = await getWhatsAppTemplate({ wabaId: access.channel.wabaId, accessToken: access.accessToken, name: row.name }, config, fetchImpl).catch(() => null);
  await withOrgTx(item.outbox.orgId, (tx) => tx.update(schema.memberWhatsAppTemplates)
    .set({
      checkedAt: new Date(),
      ...(current ? { status: current.status, category: current.category ?? row.category, templateId: current.id ?? row.templateId, rejectedReason: current.rejectedReason ?? null, updatedAt: new Date() } : {}),
    })
    .where(and(eq(schema.memberWhatsAppTemplates.orgId, item.outbox.orgId), eq(schema.memberWhatsAppTemplates.key, key))));
  return current?.status === "APPROVED" ? { ...row, status: "APPROVED", language: current.language } : null;
}

/** Devolve o motivo quando não sai; `null` quando saiu. */
async function send(item: Loaded, access: Access, config: MetaServerConfig, fetchImpl: typeof fetch): Promise<string | null> {
  const p = item.payload!;
  const connection = item.connection!;
  const base = { phoneNumberId: access.channel.phoneNumberId, accessToken: access.accessToken, to: connection.phoneE164.slice(1) };
  const open = hasOpenMemberWhatsAppWindow(connection.lastInboundAt);

  if (p.version === 3 && p.kind === "reply") {
    if (p.buttons?.length) await sendWhatsAppButtons({ ...base, text: p.text, buttons: p.buttons }, config, fetchImpl);
    else await sendWhatsAppText({ ...base, text: p.text }, config, fetchImpl);
    return null;
  }
  if (p.version === 3) {
    if (open) {
      const text = noticeText(p.notice, appBaseUrl());
      const buttons = noticeButtons(p.notice);
      if (buttons.length) await sendWhatsAppButtons({ ...base, text, buttons }, config, fetchImpl);
      else await sendWhatsAppText({ ...base, text }, config, fetchImpl);
      return null;
    }
    const call = noticeTemplate(p.notice);
    const template = await approvedTemplate(item, access, call.key, config, fetchImpl);
    if (!template) return `Janela fechada e modelo ${NOTICE_TEMPLATES[call.key].name} ainda não aprovado.`;
    const buttons: WhatsAppTemplateButtonParam[] = call.quickReplyPayload
      ? [{ type: "quick_reply", index: 0, payload: call.quickReplyPayload }, { type: "url", index: 1, text: call.urlRef }]
      : [{ type: "url", index: 0, text: call.urlRef }];
    await sendWhatsAppTemplate({ ...base, name: template.name, language: template.language, bodyParams: call.bodyParams, buttons }, config, fetchImpl);
    return null;
  }
  if (open) {
    const text = p.version === 2 ? memberSupportHandoffMessage(p) : memberNewClientMessage(p);
    await sendWhatsAppText({ ...base, text }, config, fetchImpl);
    return null;
  }
  // O modelo aprovado fala de "novo cliente": conversa do Atendimento só sai dentro da janela.
  if (p.version === 2) return "Janela fechada: aviso de conversa do Atendimento ainda sem modelo aprovado.";
  const template = await approvedTemplate(item, access, "novo_cliente", config, fetchImpl);
  if (!template) return "Janela fechada e modelo Utility ainda não aprovado.";
  await sendWhatsAppTemplate({ ...base, name: template.name || MEMBER_NEW_CLIENT_TEMPLATE, language: template.language, bodyParams: memberNewClientTemplateParams(p) }, config, fetchImpl);
  return null;
}

async function deliver(claimed: Claim, config: MetaServerConfig, fetchImpl: typeof fetch): Promise<boolean> {
  const item = await load(claimed);
  const isReply = item?.payload?.version === 3 && item.payload.kind === "reply";
  // Aviso exige número confirmado e avisos ligados (2026-11-24: o número
  // digitado não prova de quem é). Resposta vai ao número que acabou de
  // escrever, inclusive a do código que não conferiu.
  const allowed = item?.connection && (isReply || (item.connection.verifiedAt && item.connection.enabled));
  if (!item || !allowed || !item.channel || !item.payload) {
    await finish(claimed, true, null);
    return false;
  }
  if (item.payload.version === 3 && item.payload.kind === "notice") {
    if (!preferenceEnabled(item.payload.preference, item.preferences)) {
      await finish(claimed, true, "Preferência desligada.");
      return false;
    }
    const prefs = item.preferences;
    if (prefs && isQuietMinute(zonedMinute(new Date(), prefs.timezone).minutes, prefs.quietHoursStart, prefs.quietHoursEnd)) {
      await defer(claimed, QUIET_DEFER_MINUTES);
      return false;
    }
  }
  try {
    const access = await loadWhatsAppChannelAccess({ orgId: claimed.orgId, channelId: item.channel.id });
    if (!access) throw new Error("Canal do WhatsApp indisponível.");
    const skipped = await send(item, access, config, fetchImpl);
    // Não gastamos tentativas: a pessoa pode abrir a janela ou a Meta aprovar o modelo depois.
    await finish(claimed, true, skipped);
    return skipped === null;
  } catch (error) {
    const detail = error instanceof MetaGraphError ? `Meta ${error.httpStatus}/${error.graphCode ?? "-"}` : "Falha ao enviar";
    await finish(claimed, false, detail);
    return false;
  }
}

export async function runMemberWhatsAppNotificationCycle(limit = 20, fetchImpl: typeof fetch = fetch): Promise<{ claimed: number; sent: number }> {
  const whatsapp = getWhatsAppConfig();
  if (!whatsapp.appId || !whatsapp.appSecret) return { claimed: 0, sent: 0 };
  const config: MetaServerConfig = { appId: whatsapp.appId, appSecret: whatsapp.appSecret, graphApiVersion: whatsapp.graphApiVersion };
  const claims = await claim(Math.max(1, Math.min(100, limit)));
  let sent = 0;
  for (const item of claims) if (await deliver(item, config, fetchImpl)) sent++;
  return { claimed: claims.length, sent };
}
