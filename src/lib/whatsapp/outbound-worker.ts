import "server-only";

import { createHash } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { agentDeliveryBlock } from "@/domain/support-agent";
import { metaErrorMessage } from "@/domain/support-inbox";

import { loadWhatsAppChannelAccess } from "./channel-repository";
import { getWhatsAppConfig } from "./config";
import { MetaGraphError, sendWhatsAppAudio, sendWhatsAppMedia, sendWhatsAppText, type MetaServerConfig } from "./meta-client";

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
  const m = schema.supportMessages;
  return withOrgTx(claim.orgId, async (tx) => {
    const [item] = await tx
      .select({
        messageId: o.messageId,
        payload: o.payload,
        attemptCount: o.attemptCount,
        actor: m.actor,
        source: m.source,
        conversationStatus: schema.supportConversations.status,
        roundStartedAt: schema.supportConversations.aiTestStartedAt,
        agentMode: schema.supportAgentSettings.agentMode,
      })
      .from(o)
      .innerJoin(m, and(eq(m.orgId, o.orgId), eq(m.id, o.messageId)))
      .innerJoin(
        schema.supportConversations,
        and(eq(schema.supportConversations.orgId, m.orgId), eq(schema.supportConversations.id, m.conversationId)),
      )
      .leftJoin(schema.supportAgentSettings, eq(schema.supportAgentSettings.orgId, o.orgId))
      .where(and(eq(o.id, claim.id), eq(o.orgId, claim.orgId), eq(o.status, "processing"), eq(o.lockToken, claim.claimToken)))
      .limit(1);
    return item ?? null;
  });
}

/**
 * Trava de producao do piloto: mensagem com ator/origem de IA nunca chega a
 * Meta, mesmo que outro trecho crie outbox por engano. A unica excecao e a fala
 * da rodada do agente (2026-11-19; modo em 2026-11-23), conferida de novo aqui:
 * mesma rodada, agente ligado e nenhuma pessoa no comando (agentDeliveryBlock).
 */
async function blockAutomatedDelivery(claim: OutboxClaim, messageId: string, reason: string): Promise<void> {
  await withOrgTx(claim.orgId, async (tx) => {
    const o = schema.supportOutbox;
    await tx
      .update(o)
      .set({
        status: "failed",
        lockedAt: null,
        lockToken: null,
        lastError: reason,
      })
      .where(
        and(
          eq(o.id, claim.id),
          eq(o.orgId, claim.orgId),
          eq(o.status, "processing"),
          eq(o.lockToken, claim.claimToken),
        ),
      );
    await tx.insert(schema.supportMessageEvents).values({
      orgId: claim.orgId,
      messageId,
      eventType: "failed",
      detail: { message: reason },
      occurredAt: new Date(),
    });
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
  if (item.actor === "ai" || item.source === "guilda_ai") {
    const block = agentDeliveryBlock({
      payloadRound: item.payload.agentRound,
      roundStartedAt: item.roundStartedAt,
      status: item.conversationStatus,
      mode: item.agentMode ?? "off",
    });
    if (block) {
      await blockAutomatedDelivery(claim, item.messageId, block);
      return false;
    }
  }
  const to = typeof item.payload.to === "string" ? item.payload.to : "";
  const text = typeof item.payload.text === "string" ? item.payload.text : "";
  // Nota de voz (2026-11-23): o áudio já está na Meta; a saída só leva o id dele.
  const audio = item.payload.audio as { id?: unknown } | undefined;
  const audioId = typeof audio?.id === "string" && /^\d{1,32}$/.test(audio.id) ? audio.id : null;
  try {
    const access = await loadWhatsAppChannelAccess({ orgId: claim.orgId, channelId: claim.channelId });
    if (!access?.channel.phoneNumberId) throw new Error("Canal do WhatsApp sem acesso configurado.");
    const media = item.payload.media;
    const target = { phoneNumberId: access.channel.phoneNumberId, accessToken: access.accessToken, to };
    let wamid: string;
    if (audio !== undefined) {
      if (!audioId) throw new MetaGraphError("send_message", 400);
      wamid = await sendWhatsAppAudio({ ...target, mediaId: audioId }, config, fetchImpl);
    } else if (media !== undefined) {
      if (!media || typeof media !== "object" || Array.isArray(media)) throw new MetaGraphError("send_message", 400);
      const value = media as Record<string, unknown>;
      if ((value.kind !== "image" && value.kind !== "document") || typeof value.id !== "string") {
        throw new MetaGraphError("send_message", 400);
      }
      wamid = await sendWhatsAppMedia({
        ...target,
        kind: value.kind,
        mediaId: value.id,
        filename: typeof value.filename === "string" ? value.filename : undefined,
        caption: typeof value.caption === "string" ? value.caption : undefined,
      }, config, fetchImpl);
    } else {
      wamid = await sendWhatsAppText({ ...target, text }, config, fetchImpl);
    }
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
