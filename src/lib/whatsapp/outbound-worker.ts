import "server-only";

import { createHash } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { metaErrorMessage } from "@/domain/support-inbox";

import { loadWhatsAppChannelAccess } from "./channel-repository";
import { getWhatsAppConfig } from "./config";
import { MetaGraphError, sendWhatsAppText, type MetaServerConfig } from "./meta-client";

type OutboxClaim = Readonly<{ id: string; orgId: string; channelId: string; claimToken: string }>;

const MAX_ATTEMPTS = 5;

function eventKey(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\0"), "utf8").digest("hex");
}

/** Recusa definitiva da Meta (fora das 24 horas, número inválido): tentar de novo não muda nada. */
export function isPermanentMetaFailure(error: unknown): boolean {
  if (!(error instanceof MetaGraphError)) return false;
  return error.httpStatus >= 400 && error.httpStatus < 500 && error.httpStatus !== 429;
}

async function claimOutbox(limit: number): Promise<OutboxClaim[]> {
  const result = await db.execute<{ outbox_id: string; org_id: string; channel_id: string; claim_token: string }>(
    sql`SELECT * FROM public.claim_support_outbox(${limit})`,
  );
  return result.rows.map((row) => ({ id: row.outbox_id, orgId: row.org_id, channelId: row.channel_id, claimToken: row.claim_token }));
}

async function finishOutbox(claim: OutboxClaim, success: boolean, detail: string | null): Promise<void> {
  await db.execute(sql`SELECT public.finish_support_outbox(${claim.id}::uuid, ${claim.claimToken}::uuid, ${success}, ${detail})`);
}

async function loadItem(claim: OutboxClaim) {
  const o = schema.supportOutbox;
  return withOrgTx(claim.orgId, async (tx) => {
    const [item] = await tx
      .select({ messageId: o.messageId, payload: o.payload, attemptCount: o.attemptCount })
      .from(o)
      .where(and(eq(o.id, claim.id), eq(o.orgId, claim.orgId), eq(o.status, "processing"), eq(o.lockToken, claim.claimToken)))
      .limit(1);
    return item ?? null;
  });
}

/** O id da Meta fica no evento, porque a mensagem é imutável: é por ele que os recibos a acham. */
async function recordAccepted(claim: OutboxClaim, messageId: string, wamid: string): Promise<void> {
  await withOrgTx(claim.orgId, (tx) =>
    tx
      .insert(schema.supportMessageEvents)
      .values({ orgId: claim.orgId, messageId, eventType: "accepted", providerEventKey: eventKey(wamid, "accepted"), detail: { wamid }, occurredAt: new Date() })
      .onConflictDoNothing(),
  );
}

async function recordFailed(claim: OutboxClaim, messageId: string, message: string, permanent: boolean): Promise<void> {
  await withOrgTx(claim.orgId, async (tx) => {
    await tx.insert(schema.supportMessageEvents).values({ orgId: claim.orgId, messageId, eventType: "failed", detail: { message }, occurredAt: new Date() });
    if (permanent) {
      const o = schema.supportOutbox;
      await tx.update(o).set({ status: "failed" }).where(and(eq(o.id, claim.id), eq(o.orgId, claim.orgId)));
    }
  });
}

async function deliver(claim: OutboxClaim, config: MetaServerConfig, fetchImpl: typeof fetch): Promise<boolean> {
  const item = await loadItem(claim);
  if (!item) return false;
  const to = typeof item.payload.to === "string" ? item.payload.to : "";
  const text = typeof item.payload.text === "string" ? item.payload.text : "";
  try {
    const access = await loadWhatsAppChannelAccess({ orgId: claim.orgId, channelId: claim.channelId });
    if (!access?.channel.phoneNumberId) throw new Error("Canal do WhatsApp sem acesso configurado.");
    const wamid = await sendWhatsAppText({ phoneNumberId: access.channel.phoneNumberId, accessToken: access.accessToken, to, text }, config, fetchImpl);
    await recordAccepted(claim, item.messageId, wamid);
    await finishOutbox(claim, true, null);
    return true;
  } catch (error) {
    const permanent = isPermanentMetaFailure(error);
    const code = error instanceof MetaGraphError ? error.graphCode : undefined;
    const detail = error instanceof MetaGraphError ? `Meta ${error.httpStatus}/${code ?? "-"}` : "Falha ao enviar";
    await finishOutbox(claim, false, detail);
    // Só avisa a tela quando acabou de vez: enquanto há nova tentativa, segue "Enviando".
    if (permanent || item.attemptCount >= MAX_ATTEMPTS) {
      await recordFailed(claim, item.messageId, error instanceof MetaGraphError ? metaErrorMessage(code) : "Não foi possível enviar a mensagem.", permanent);
    }
    return false;
  }
}

export async function runSupportOutboxCycle(limit = 20, fetchImpl: typeof fetch = fetch): Promise<{ claimed: number; sent: number }> {
  const whatsapp = getWhatsAppConfig();
  if (!whatsapp.appId || !whatsapp.appSecret) return { claimed: 0, sent: 0 };
  const config: MetaServerConfig = { appId: whatsapp.appId, appSecret: whatsapp.appSecret, graphApiVersion: whatsapp.graphApiVersion };
  const claims = await claimOutbox(Math.max(1, Math.min(100, limit)));
  let sent = 0;
  for (const claim of claims) {
    if (await deliver(claim, config, fetchImpl)) sent += 1;
  }
  return { claimed: claims.length, sent };
}
