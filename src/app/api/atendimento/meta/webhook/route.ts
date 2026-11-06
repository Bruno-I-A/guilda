import { getWhatsAppConfig } from "@/lib/whatsapp/config";
import {
  parseWhatsAppWebhook,
  verifyMetaChallenge,
  verifyMetaSignature,
  webhookChangeFingerprint,
} from "@/lib/whatsapp/webhook";
import {
  enqueueWhatsAppChange,
  lookupWhatsAppChannel,
} from "@/lib/whatsapp/webhook-repository";

export const runtime = "nodejs";

const MAX_WEBHOOK_BYTES = 1_000_000;

export async function GET(request: Request): Promise<Response> {
  const { webhookVerifyToken } = getWhatsAppConfig();
  if (!webhookVerifyToken) return new Response("WhatsApp indisponível", { status: 503 });
  const challenge = verifyMetaChallenge(new URL(request.url).searchParams, webhookVerifyToken);
  return challenge === null
    ? new Response("Verificação recusada", { status: 403 })
    : new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
}

export async function POST(request: Request): Promise<Response> {
  const { appSecret } = getWhatsAppConfig();
  if (!appSecret) return Response.json({ ok: false }, { status: 503 });

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BYTES) {
    return Response.json({ ok: false }, { status: 413 });
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BYTES) {
    return Response.json({ ok: false }, { status: 413 });
  }
  if (!verifyMetaSignature(rawBody, request.headers.get("x-hub-signature-256"), appSecret)) {
    return Response.json({ ok: false }, { status: 401 });
  }

  const changes = parseWhatsAppWebhook(rawBody);
  if (!changes) return Response.json({ ok: false }, { status: 400 });

  try {
    let queued = 0;
    let duplicate = 0;
    let unknownChannel = 0;
    for (const [index, change] of changes.entries()) {
      const route = await lookupWhatsAppChannel(change.phoneNumberId);
      if (!route) {
        unknownChannel += 1;
        continue;
      }
      const result = await enqueueWhatsAppChange({
        route,
        change,
        fingerprint: webhookChangeFingerprint(rawBody, index),
      });
      if (result === "queued") queued += 1;
      else duplicate += 1;
    }
    return Response.json({ ok: true, queued, duplicate, unknownChannel });
  } catch (error) {
    // Nunca registrar payload, assinatura, telefone ou conteúdo de mensagem.
    console.error("Falha ao enfileirar webhook do WhatsApp", {
      error: error instanceof Error ? error.message : "erro desconhecido",
    });
    return Response.json({ ok: false }, { status: 500 });
  }
}
