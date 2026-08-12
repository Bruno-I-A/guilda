"use client";

import {
  BellRing,
  Bot,
  CheckCircle2,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  Send,
  Unplug,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useTransition } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import {
  createTelegramLink,
  disconnectTelegram,
  updateTelegramPreferences,
} from "./telegram-actions";
import type {
  TelegramActionState,
  TelegramConnectionView,
  TelegramPreferencesView,
} from "./telegram-types";

const INITIAL_STATE: TelegramActionState = { status: "idle" };

const NOTIFICATION_OPTIONS = [
  {
    name: "taskNotifications",
    label: "Missões",
    description: "Novas atribuições e mudanças de estado.",
  },
  {
    name: "approvalNotifications",
    label: "Aprovações",
    description: "Fila para aprovar, devoluções e decisões.",
  },
  {
    name: "deadlineReminders",
    label: "Prazos",
    description: "Lembretes de entregas próximas ou atrasadas.",
  },
  {
    name: "xpNotifications",
    label: "XP e níveis",
    description: "Créditos de XP e progressão de nível.",
  },
  {
    name: "closingNotifications",
    label: "Fechamentos",
    description: "Pendências, bloqueios e conclusões contábeis.",
  },
  {
    name: "campaignNotifications",
    label: "Campanhas",
    description: "Início, andamento e conclusão de campanhas.",
  },
] as const;

const TIMEZONES = [
  ["America/Sao_Paulo", "Brasília (São Paulo)"],
  ["America/Manaus", "Amazonas (Manaus)"],
  ["America/Cuiaba", "Mato Grosso (Cuiabá)"],
  ["America/Rio_Branco", "Acre (Rio Branco)"],
  ["America/Noronha", "Fernando de Noronha"],
  ["UTC", "UTC"],
] as const;

function ActionMessage({ state }: { state: TelegramActionState }) {
  if (state.status === "idle" || !state.message) return null;
  return (
    <p
      aria-live="polite"
      className={cn(
        "text-sm",
        state.status === "error" ? "text-destructive" : "text-emerald-600",
      )}
    >
      {state.message}
    </p>
  );
}

function PreferenceToggle({
  name,
  label,
  description,
  defaultChecked,
}: {
  name: keyof TelegramPreferencesView;
  label: string;
  description: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 p-3 transition-colors hover:bg-muted/40">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="mt-0.5 size-4 shrink-0 accent-primary"
      />
      <span className="grid gap-0.5">
        <span className="font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}

export function TelegramSettings({
  connection,
  preferences,
  configured,
  botUsername,
}: {
  connection: TelegramConnectionView | null;
  preferences: TelegramPreferencesView;
  configured: boolean;
  botUsername: string | null;
}) {
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();
  const [linkState, linkAction, linkPending] = useActionState(
    createTelegramLink,
    INITIAL_STATE,
  );
  const [disconnectState, disconnectAction, disconnectPending] = useActionState(
    disconnectTelegram,
    INITIAL_STATE,
  );
  const [preferencesState, preferencesAction, preferencesPending] =
    useActionState(updateTelegramPreferences, INITIAL_STATE);

  const hasKnownTimezone = TIMEZONES.some(([value]) => value === preferences.timezone);

  return (
    <Card className="panel-cut">
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <CardTitle className="flex items-center gap-2">
              <Send className="size-4 text-[#2AABEE]" aria-hidden />
              Telegram
            </CardTitle>
            <CardDescription>
              Receba alertas e acompanhe a Guilda pelo bot, sem usar IA.
            </CardDescription>
          </div>
          <Badge variant={connection ? "secondary" : "outline"}>
            {connection ? "Conectado" : "Não conectado"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="grid gap-6">
        {!configured && (
          <Alert>
            <Bot aria-hidden />
            <AlertTitle>Bot aguardando configuração</AlertTitle>
            <AlertDescription>
              A integração ficará disponível quando TELEGRAM_BOT_TOKEN for
              definido e válido no servidor. As demais áreas
              da Guilda continuam funcionando normalmente.
            </AlertDescription>
          </Alert>
        )}

        {connection ? (
          <section className="grid gap-3" aria-labelledby="telegram-account-title">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 p-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#2AABEE]/15 text-[#2AABEE]">
                  <CheckCircle2 className="size-5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <h3 id="telegram-account-title" className="font-medium">
                    {connection.username
                      ? `@${connection.username}`
                      : connection.displayName ?? "Conta do Telegram"}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Vinculada em {connection.connectedAt}
                  </p>
                </div>
              </div>
              {connection.username && (
                <Button asChild variant="outline" size="sm">
                  <a
                    href={`https://t.me/${connection.username}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Ver perfil <ExternalLink aria-hidden />
                  </a>
                </Button>
              )}
            </div>

            <form action={disconnectAction} className="flex flex-wrap items-center gap-3">
              <Button type="submit" variant="destructive" disabled={disconnectPending}>
                {disconnectPending ? (
                  <LoaderCircle className="animate-spin" aria-hidden />
                ) : (
                  <Unplug aria-hidden />
                )}
                {disconnectPending ? "Desconectando…" : "Desconectar Telegram"}
              </Button>
              <ActionMessage state={disconnectState} />
            </form>
          </section>
        ) : (
          <section className="grid gap-3" aria-labelledby="telegram-connect-title">
            <div>
              <h3 id="telegram-connect-title" className="font-medium">
                Conectar sua conta
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Gere um link temporário, abra o bot e toque em Iniciar. O link
                expira em 10 minutos e só pode ser usado uma vez.
              </p>
            </div>

            <form action={linkAction} className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={!configured || linkPending}>
                {linkPending ? (
                  <LoaderCircle className="animate-spin" aria-hidden />
                ) : (
                  <Send aria-hidden />
                )}
                {linkPending ? "Gerando link…" : "Conectar Telegram"}
              </Button>
              {botUsername && (
                <span className="text-xs text-muted-foreground">@{botUsername}</span>
              )}
            </form>
            <ActionMessage state={linkState} />

            {linkState.status === "success" && linkState.link && (
              <div className="panel-cut panel-cut-sm grid gap-3 bg-[#2AABEE]/10 p-4 shadow-[inset_0_0_0_1px_color-mix(in_oklab,#2AABEE_35%,transparent)]">
                <div>
                  <p className="font-medium">Seu link está pronto</p>
                  {linkState.expiresAt && (
                    <p className="text-xs text-muted-foreground">
                      Válido até{" "}
                      {new Intl.DateTimeFormat("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      }).format(new Date(linkState.expiresAt))}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button asChild>
                    <a href={linkState.link} target="_blank" rel="noreferrer">
                      Abrir o Telegram <ExternalLink aria-hidden />
                    </a>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isRefreshing}
                    onClick={() => startRefresh(() => router.refresh())}
                  >
                    <RefreshCw
                      className={cn(isRefreshing && "animate-spin")}
                      aria-hidden
                    />
                    Já conectei — verificar
                  </Button>
                </div>
              </div>
            )}
          </section>
        )}

        <section className="grid gap-4 border-t pt-6" aria-labelledby="telegram-preferences-title">
          <div>
            <h3 id="telegram-preferences-title" className="flex items-center gap-2 font-medium">
              <BellRing className="size-4 text-gold" aria-hidden />
              Preferências de notificação
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Escolha quais eventos podem chegar à sua conversa privada.
            </p>
          </div>

          <form action={preferencesAction} className="grid gap-4">
            <div className="grid gap-2 sm:grid-cols-2">
              {NOTIFICATION_OPTIONS.map((option) => (
                <PreferenceToggle
                  key={option.name}
                  {...option}
                  defaultChecked={preferences[option.name]}
                />
              ))}
            </div>

            <div className="grid gap-4 rounded-lg border p-4">
              <PreferenceToggle
                name="dailySummary"
                label="Resumo diário"
                description="Visão compacta das missões, aprovações e fechamentos do dia."
                defaultChecked={preferences.dailySummary}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="dailySummaryTime">Horário do resumo</Label>
                  <Input
                    id="dailySummaryTime"
                    name="dailySummaryTime"
                    type="time"
                    defaultValue={preferences.dailySummaryTime.slice(0, 5)}
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="telegramTimezone">Fuso horário</Label>
                  <select
                    id="telegramTimezone"
                    name="timezone"
                    defaultValue={preferences.timezone}
                    className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    required
                  >
                    {!hasKnownTimezone && (
                      <option value={preferences.timezone}>{preferences.timezone}</option>
                    )}
                    {TIMEZONES.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid gap-4 border-t pt-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="quietHoursStart">Silenciar a partir de</Label>
                  <Input
                    id="quietHoursStart"
                    name="quietHoursStart"
                    type="time"
                    defaultValue={preferences.quietHoursStart?.slice(0, 5) ?? ""}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="quietHoursEnd">Voltar a notificar às</Label>
                  <Input
                    id="quietHoursEnd"
                    name="quietHoursEnd"
                    type="time"
                    defaultValue={preferences.quietHoursEnd?.slice(0, 5) ?? ""}
                  />
                </div>
                <p className="text-xs text-muted-foreground sm:col-span-2">
                  Preencha os dois horários para pausar mensagens nesse período.
                  Intervalos que atravessam a meia-noite são aceitos.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={preferencesPending}>
                {preferencesPending && (
                  <LoaderCircle className="animate-spin" aria-hidden />
                )}
                {preferencesPending ? "Salvando…" : "Salvar preferências"}
              </Button>
              <ActionMessage state={preferencesState} />
            </div>
          </form>
        </section>
      </CardContent>
    </Card>
  );
}
