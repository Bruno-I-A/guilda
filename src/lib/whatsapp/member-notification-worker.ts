import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";

import { loadWhatsAppChannelAccess } from "./channel-repository";
import { getWhatsAppConfig } from "./config";
import { MetaGraphError, sendWhatsAppTemplate, sendWhatsAppText, type MetaServerConfig } from "./meta-client";
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

function payload(value: unknown): MemberNotificationPayload | MemberSupportPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.version === 2 && v.kind === "support_conversation") {
    return typeof v.contactName === "string" && typeof v.clanName === "string" && typeof v.url === "string"
      ? { version: 2, kind: "support_conversation", contactName: v.contactName, clanName: v.clanName, summary: typeof v.summary === "string" ? v.summary : "", url: v.url }
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

async function load(claimed: Claim) {
  return withOrgTx(claimed.orgId, async (tx) => {
    const outbox = await tx.query.memberWhatsAppOutbox.findFirst({
      where: and(eq(schema.memberWhatsAppOutbox.id, claimed.id), eq(schema.memberWhatsAppOutbox.orgId, claimed.orgId), eq(schema.memberWhatsAppOutbox.status, "processing"), eq(schema.memberWhatsAppOutbox.lockToken, claimed.claimToken)),
    });
    if (!outbox) return null;
    const [connection, channel, config] = await Promise.all([
      tx.query.memberWhatsAppConnections.findFirst({ where: and(eq(schema.memberWhatsAppConnections.orgId, claimed.orgId), eq(schema.memberWhatsAppConnections.userId, outbox.userId), eq(schema.memberWhatsAppConnections.enabled, true)) }),
      tx.query.supportWhatsAppChannels.findFirst({ where: and(eq(schema.supportWhatsAppChannels.orgId, claimed.orgId), eq(schema.supportWhatsAppChannels.status, "active")), orderBy: (c, { desc }) => [desc(c.updatedAt)] }),
      tx.query.memberWhatsAppNotificationConfig.findFirst({ where: eq(schema.memberWhatsAppNotificationConfig.orgId, claimed.orgId) }),
    ]);
    return { outbox, connection, channel, config, payload: payload(outbox.payload) };
  });
}

async function deliver(claimed: Claim, config: MetaServerConfig, fetchImpl: typeof fetch): Promise<boolean> {
  const item = await load(claimed);
  if (!item?.connection || !item.channel || !item.payload) {
    await finish(claimed, true, null);
    return false;
  }
  try {
    const access = await loadWhatsAppChannelAccess({ orgId: claimed.orgId, channelId: item.channel.id });
    if (!access) throw new Error("Canal do WhatsApp indisponível.");
    const to = item.connection.phoneE164.slice(1);
    if (hasOpenMemberWhatsAppWindow(item.connection.lastInboundAt)) {
      const text = item.payload.version === 2 ? memberSupportHandoffMessage(item.payload) : memberNewClientMessage(item.payload);
      await sendWhatsAppText({ phoneNumberId: access.channel.phoneNumberId, accessToken: access.accessToken, to, text }, config, fetchImpl);
    } else if (item.payload.version === 2) {
      // O modelo aprovado fala de "novo cliente": conversa do Atendimento só sai dentro da janela.
      await finish(claimed, true, "Janela fechada: aviso de conversa do Atendimento ainda sem modelo aprovado.");
      return false;
    } else {
      if (item.config?.templateStatus !== "APPROVED") {
        // Não gastamos tentativas: a pessoa pode abrir a janela ou o admin aprovar o template depois.
        await finish(claimed, true, "Janela fechada e modelo Utility ainda não aprovado.");
        return false;
      }
      await sendWhatsAppTemplate({ phoneNumberId: access.channel.phoneNumberId, accessToken: access.accessToken, to, name: item.config.templateName || MEMBER_NEW_CLIENT_TEMPLATE, language: item.config.templateLanguage, bodyParams: memberNewClientTemplateParams(item.payload) }, config, fetchImpl);
    }
    await finish(claimed, true, null);
    return true;
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
