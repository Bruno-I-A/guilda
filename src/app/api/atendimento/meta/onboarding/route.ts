import { z } from "zod";

import { isAdminRole } from "@/lib/session";
import { requireMemberContext } from "@/lib/action-context";
import { isSameOriginRequest } from "@/lib/request-security";
import { MetaGraphError } from "@/lib/whatsapp/meta-client";
import {
  completeEmbeddedSignup,
  getReadyEmbeddedSignupConfig,
  WhatsAppOnboardingActivationError,
} from "@/lib/whatsapp/onboarding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 32_000;
const metaId = z.string().regex(/^\d{1,32}$/);
const bodySchema = z.object({
  code: z.string().trim().min(10).max(4096),
  sessionInfo: z.object({
    type: z.literal("WA_EMBEDDED_SIGNUP"),
    event: z.enum(["FINISH", "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"]),
    data: z.object({
      waba_id: metaId,
      phone_number_id: metaId.optional(),
    }).passthrough(),
  }).passthrough().optional(),
});

function json(payload: unknown, status = 200): Response {
  return Response.json(payload, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

type MemberContext = Extract<
  Awaited<ReturnType<typeof requireMemberContext>>,
  { ok: true }
>;

async function requireAdmin(): Promise<
  | { ok: true; ctx: MemberContext }
  | { ok: false; response: Response }
> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) {
    return { ok: false, response: json({ ok: false, error: ctx.error }, 401) };
  }
  if (!isAdminRole(ctx.role)) {
    return {
      ok: false,
      response: json({ ok: false, error: "Apenas admin/owner pode conectar o WhatsApp." }, 403),
    };
  }
  return { ok: true, ctx };
}

export async function GET(): Promise<Response> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const config = getReadyEmbeddedSignupConfig();
  return json({ ok: true, configured: Boolean(config), ...(config ? { config } : {}) });
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  if (!isSameOriginRequest(request)) {
    return json({ ok: false, error: "Origem da solicitação recusada." }, 403);
  }
  if (!getReadyEmbeddedSignupConfig()) {
    return json({ ok: false, error: "Onboarding do WhatsApp ainda não configurado." }, 503);
  }
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return json({ ok: false, error: "Solicitação grande demais." }, 413);
  }
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return json({ ok: false, error: "Solicitação inválida." }, 400);
  }
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return json({ ok: false, error: "Solicitação grande demais." }, 413);
  }
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ ok: false, error: "Solicitação inválida." }, 400);
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return json({ ok: false, error: "Retorno do Embedded Signup inválido." }, 400);
  }

  try {
    const channel = await completeEmbeddedSignup({
      orgId: auth.ctx.orgId,
      userId: auth.ctx.userId,
      code: parsed.data.code,
      ...(parsed.data.sessionInfo?.data.waba_id
        ? { wabaId: parsed.data.sessionInfo.data.waba_id }
        : {}),
      ...(parsed.data.sessionInfo?.data.phone_number_id
        ? { phoneNumberId: parsed.data.sessionInfo.data.phone_number_id }
        : {}),
    });
    return json({ ok: true, channel });
  } catch (error) {
    if (error instanceof WhatsAppOnboardingActivationError) {
      return json(
        {
          ok: false,
          error: "Número salvo, mas a assinatura do webhook precisa ser repetida.",
          retryable: true,
          channel: error.channel,
        },
        502,
      );
    }
    if (error instanceof MetaGraphError) {
      console.error("Falha segura no onboarding do WhatsApp", {
        operation: error.operation,
        httpStatus: error.httpStatus,
        graphCode: error.graphCode,
        graphType: error.graphType,
      });
      return error.operation === "resolve_waba" && error.httpStatus === 409
        ? json(
            {
              ok: false,
              error: "Não foi possível identificar uma única conta do WhatsApp nessa autorização.",
            },
            409,
          )
        : error.operation === "list_phones" && error.httpStatus === 409
        ? json(
            {
              ok: false,
              error: "Não foi possível identificar um único número em coexistência nessa conta.",
            },
            409,
          )
        : json({ ok: false, error: "A Meta não concluiu a conexão do WhatsApp." }, 502);
    }
    const cause = (error as { cause?: { code?: string } } | null)?.cause;
    if (cause?.code === "23505") {
      return json(
        { ok: false, error: "Este número já está conectado a outro escritório." },
        409,
      );
    }
    console.error("Falha interna no onboarding do WhatsApp", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return json({ ok: false, error: "Não foi possível salvar o canal do WhatsApp." }, 500);
  }
}
