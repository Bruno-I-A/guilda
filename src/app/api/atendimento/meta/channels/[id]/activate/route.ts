import { z } from "zod";

import { requireMemberContext } from "@/lib/action-context";
import { isSameOriginRequest } from "@/lib/request-security";
import { isAdminRole } from "@/lib/session";
import { MetaGraphError } from "@/lib/whatsapp/meta-client";
import { retryWhatsAppChannelActivation } from "@/lib/whatsapp/onboarding";

export const runtime = "nodejs";

function json(payload: unknown, status = 200): Response {
  return Response.json(payload, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return json({ ok: false, error: ctx.error }, 401);
  if (!isAdminRole(ctx.role)) {
    return json({ ok: false, error: "Apenas admin/owner pode ativar o canal." }, 403);
  }
  if (!isSameOriginRequest(request)) {
    return json({ ok: false, error: "Origem da solicitação recusada." }, 403);
  }
  const parsed = z.uuid().safeParse((await context.params).id);
  if (!parsed.success) return json({ ok: false, error: "Canal inválido." }, 400);

  try {
    const channel = await retryWhatsAppChannelActivation({
      orgId: ctx.orgId,
      channelId: parsed.data,
    });
    return channel
      ? json({ ok: true, channel })
      : json({ ok: false, error: "Canal não encontrado." }, 404);
  } catch (error) {
    if (error instanceof MetaGraphError) {
      console.error("Falha segura ao reativar webhook do WhatsApp", {
        operation: error.operation,
        httpStatus: error.httpStatus,
        graphCode: error.graphCode,
      });
      return json({ ok: false, error: "A Meta não confirmou a assinatura do webhook." }, 502);
    }
    console.error("Falha interna ao reativar webhook do WhatsApp", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return json({ ok: false, error: "Não foi possível ativar o canal." }, 500);
  }
}
