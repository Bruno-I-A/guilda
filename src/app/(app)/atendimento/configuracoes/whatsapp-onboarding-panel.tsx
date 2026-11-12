"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Link2,
  LoaderCircle,
  MessageCircle,
  RefreshCw,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import Script from "next/script";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { WhatsAppChannelSummary } from "@/lib/whatsapp/channel-repository";
import {
  embeddedSignupLoginOptions,
  isTrustedFacebookOrigin,
  parseEmbeddedSignupMessage,
  type EmbeddedSignupClientConfig,
  type EmbeddedSignupSessionInfo,
} from "@/lib/whatsapp/embedded-signup";
import { cn } from "@/lib/utils";

type FacebookLoginResponse = {
  authResponse?: { code?: unknown };
};

type FacebookSdk = {
  init(options: {
    appId: string;
    autoLogAppEvents: boolean;
    xfbml: boolean;
    version: string;
  }): void;
  login(
    callback: (response: FacebookLoginResponse) => void,
    options: ReturnType<typeof embeddedSignupLoginOptions>,
  ): void;
};

declare global {
  interface Window {
    FB?: FacebookSdk;
    __guildaFacebookAppId?: string;
  }
}

type ApiResponse =
  | { ok: true; channel: WhatsAppChannelSummary }
  | {
      ok: false;
      error?: string;
      retryable?: boolean;
      channel?: WhatsAppChannelSummary;
    };

type Feedback = Readonly<{
  tone: "success" | "warning" | "error";
  message: string;
}>;

const statusPresentation: Record<
  WhatsAppChannelSummary["status"],
  { label: string; className: string }
> = {
  active: {
    label: "Conectado",
    className: "border-success/40 bg-success/10 text-success",
  },
  pending: {
    label: "Aguardando ativação",
    className: "border-warning/40 bg-warning/10 text-warning",
  },
  paused: {
    label: "Pausado",
    className: "border-border bg-muted text-muted-foreground",
  },
  disconnected: {
    label: "Desconectado",
    className: "border-destructive/40 bg-destructive/10 text-destructive",
  },
};

function upsertChannel(
  channels: WhatsAppChannelSummary[],
  next: WhatsAppChannelSummary,
): WhatsAppChannelSummary[] {
  return [next, ...channels.filter((channel) => channel.id !== next.id)];
}

async function readApiResponse(response: Response): Promise<ApiResponse> {
  const body: unknown = await response.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "A Guilda recebeu uma resposta inválida." };
  }
  return body as ApiResponse;
}

export function WhatsAppOnboardingPanel({
  config,
  initialChannels,
}: {
  config: EmbeddedSignupClientConfig | null;
  initialChannels: WhatsAppChannelSummary[];
}) {
  const router = useRouter();
  const [channels, setChannels] = useState(initialChannels);
  const [sdkReady, setSdkReady] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const codeRef = useRef<string | null>(null);
  const sessionInfoRef = useRef<EmbeddedSignupSessionInfo | null>(null);
  const completingRef = useRef(false);

  const completeConnection = useCallback(async (allowMissingSession = false) => {
    const code = codeRef.current;
    const sessionInfo = sessionInfoRef.current;
    if (!code || (!sessionInfo && !allowMissingSession) || completingRef.current) return;

    completingRef.current = true;
    codeRef.current = null;
    sessionInfoRef.current = null;
    try {
      const response = await fetch("/api/atendimento/meta/onboarding", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, ...(sessionInfo ? { sessionInfo } : {}) }),
      });
      const result = await readApiResponse(response);
      if (!result.ok) {
        if (result.channel) {
          const pendingChannel = result.channel;
          setChannels((current) => upsertChannel(current, pendingChannel));
        }
        const message = result.error ?? "A Meta não concluiu a conexão.";
        setFeedback({
          tone: result.retryable ? "warning" : "error",
          message,
        });
        if (result.retryable) toast.warning(message);
        else toast.error(message);
        return;
      }
      if (!response.ok) {
        throw new Error("A Meta não concluiu a conexão.");
      }
      setChannels((current) => upsertChannel(current, result.channel));
      setFeedback({
        tone: "success",
        message: "WhatsApp conectado. O canal já pode receber eventos da Meta.",
      });
      toast.success("WhatsApp conectado à Guilda.");
      router.refresh();
    } catch {
      const message = "A conexão caiu antes de a Guilda concluir o cadastro.";
      setFeedback({ tone: "error", message });
      toast.error(message);
    } finally {
      completingRef.current = false;
      setConnecting(false);
    }
  }, [router]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!isTrustedFacebookOrigin(event.origin)) return;
      const sessionInfo = parseEmbeddedSignupMessage(event.data);
      if (!sessionInfo) return;
      sessionInfoRef.current = sessionInfo;
      void completeConnection();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [completeConnection]);

  useEffect(() => {
    if (!connecting) return;
    const timeout = window.setTimeout(() => {
      if (completingRef.current) return;
      codeRef.current = null;
      sessionInfoRef.current = null;
      setConnecting(false);
      setFeedback({
        tone: "warning",
        message: "O fluxo da Meta expirou. Abra a conexão novamente para continuar.",
      });
    }, 180_000);
    return () => window.clearTimeout(timeout);
  }, [connecting]);

  const initializeSdk = useCallback(() => {
    if (!config || !window.FB) {
      setSdkReady(false);
      return;
    }
    if (window.__guildaFacebookAppId !== config.appId) {
      window.FB.init({
        appId: config.appId,
        autoLogAppEvents: false,
        xfbml: false,
        version: config.graphApiVersion,
      });
      window.__guildaFacebookAppId = config.appId;
    }
    setSdkReady(true);
  }, [config]);

  const launchSignup = () => {
    if (!config || !window.FB || !sdkReady) {
      toast.error("O conector da Meta ainda está carregando.");
      return;
    }
    codeRef.current = null;
    sessionInfoRef.current = null;
    setFeedback(null);
    setConnecting(true);
    window.FB.login((response) => {
      const code = response.authResponse?.code;
      if (typeof code !== "string" || code.length < 10) {
        setConnecting(false);
        setFeedback({
          tone: "warning",
          message: "A conexão foi cancelada antes da autorização.",
        });
        return;
      }
      codeRef.current = code;
      void completeConnection();
      // A v5 da Meta pode devolver o code sem publicar WA_EMBEDDED_SIGNUP.
      // Nesse caso o servidor identifica a conta pela permissão concedida.
      window.setTimeout(() => void completeConnection(true), 3_000);
    }, embeddedSignupLoginOptions(config));
  };

  const retryActivation = async (channelId: string) => {
    setRetryingId(channelId);
    setFeedback(null);
    try {
      const response = await fetch(
        `/api/atendimento/meta/channels/${encodeURIComponent(channelId)}/activate`,
        { method: "POST", credentials: "same-origin" },
      );
      const result = await readApiResponse(response);
      if (!result.ok) {
        throw new Error(result.error ?? "A Meta não confirmou a ativação.");
      }
      if (!response.ok) throw new Error("A Meta não confirmou a ativação.");
      setChannels((current) => upsertChannel(current, result.channel));
      setFeedback({
        tone: "success",
        message: "Assinatura confirmada. O canal está ativo.",
      });
      toast.success("Canal do WhatsApp ativado.");
      router.refresh();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Não foi possível repetir a ativação.";
      setFeedback({ tone: "error", message });
      toast.error(message);
    } finally {
      setRetryingId(null);
    }
  };

  const connectLabel = connecting
    ? "Conectando..."
    : config && !sdkReady
      ? "Carregando Meta..."
      : channels.length > 0
        ? "Conectar outro número"
        : "Conectar WhatsApp";

  return (
    <section
      className="panel-cut grid gap-5 border border-border bg-card p-5"
      aria-busy={connecting || retryingId !== null}
    >
      {config ? (
        <Script
          src="https://connect.facebook.net/pt_BR/sdk.js"
          strategy="afterInteractive"
          onReady={initializeSdk}
          onError={() => {
            setSdkReady(false);
            setFeedback({
              tone: "error",
              message: "Não foi possível carregar o conector da Meta.",
            });
          }}
        />
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center border border-primary/30 bg-primary/10 text-primary">
            <MessageCircle className="size-5" aria-hidden />
          </div>
          <div>
            <h2>Atendimento no WhatsApp</h2>
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">
              Conecte o número pelo fluxo oficial da Meta. O WhatsApp Business
              continua no celular e as conversas entram na Guilda.
            </p>
          </div>
        </div>
        <Button
          type="button"
          onClick={launchSignup}
          disabled={!config || !sdkReady || connecting}
        >
          {connecting || (config !== null && !sdkReady) ? (
            <LoaderCircle className="animate-spin" aria-hidden />
          ) : (
            <Link2 aria-hidden />
          )}
          {connectLabel}
        </Button>
      </div>

      {!config ? (
        <div className="flex gap-3 border border-warning/40 bg-warning/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <div>
            <p className="font-medium text-foreground">Configuração da Meta pendente</p>
            <p className="mt-1 max-w-prose text-muted-foreground">
              O app, a configuração de Embedded Signup, o webhook e o cofre de
              tokens precisam estar definidos neste ambiente antes de abrir o fluxo.
            </p>
          </div>
        </div>
      ) : null}

      {channels.length > 0 ? (
        <div className="grid gap-3">
          {channels.map((channel) => {
            const presentation = statusPresentation[channel.status];
            return (
              <article
                key={channel.id}
                className="grid gap-3 border border-border bg-background/40 p-4 sm:grid-cols-[1fr_auto] sm:items-center"
              >
                <div className="flex min-w-0 gap-3">
                  <Smartphone
                    className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate">{channel.verifiedName ?? channel.name}</h3>
                      <Badge variant="outline" className={presentation.className}>
                        {presentation.label}
                      </Badge>
                    </div>
                    <p className="mt-1 font-mono text-sm text-foreground">
                      {channel.displayPhoneNumber ?? `Número ${channel.phoneNumberId}`}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Coexistência com o aplicativo do celular habilitada.
                    </p>
                  </div>
                </div>
                {channel.status === "pending" ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void retryActivation(channel.id)}
                    disabled={retryingId !== null}
                  >
                    <RefreshCw
                      className={cn(retryingId === channel.id && "animate-spin")}
                      aria-hidden
                    />
                    Repetir ativação
                  </Button>
                ) : channel.status === "active" ? (
                  <div className="flex items-center gap-2 text-sm text-success">
                    <ShieldCheck className="size-4" aria-hidden />
                    Webhook protegido
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : config ? (
        <div className="flex gap-3 border border-dashed border-border p-4 text-sm text-muted-foreground">
          <Smartphone className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p className="max-w-prose">
            Nenhum número conectado. Tenha o WhatsApp Business instalado e o
            backup conferido antes de iniciar.
          </p>
        </div>
      ) : null}

      <div className="grid gap-2 border-t border-border pt-4 text-sm text-muted-foreground sm:grid-cols-3">
        <p className="flex gap-2">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
          Usa os logins e permissões da Guilda.
        </p>
        <p className="flex gap-2">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          O token é cifrado antes de chegar ao banco.
        </p>
        <p className="flex gap-2">
          <Smartphone className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          Responder no celular pausa a IA.
        </p>
      </div>

      {feedback ? (
        <p
          aria-live="polite"
          className={cn(
            "border p-3 text-sm",
            feedback.tone === "success" &&
              "border-success/40 bg-success/10 text-success",
            feedback.tone === "warning" &&
              "border-warning/40 bg-warning/10 text-warning",
            feedback.tone === "error" &&
              "border-destructive/40 bg-destructive/10 text-destructive",
          )}
        >
          {feedback.message}
        </p>
      ) : null}
    </section>
  );
}
