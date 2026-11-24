"use client";

import { CheckCircle2, ExternalLink, LoaderCircle, MessageCircleMore, RefreshCw, Save, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { APP_TIME_ZONE } from "@/lib/date-time";

import { saveMemberWhatsAppSettings, startWhatsAppVerification, type VerificationStart } from "./whatsapp-actions";

export type WhatsAppConnectionView = {
  phone: string;
  enabled: boolean;
  /** Já formatados no servidor. */
  verifiedAt: string | null;
  windowOpenUntil: string | null;
};

function timeLabel(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: APP_TIME_ZONE }).format(new Date(iso));
}

/**
 * O número do integrante e a prova de que é dele (2026-11-24). Sem confirmar,
 * nada de aviso nem de missão por mensagem: o número digitado não prova nada.
 */
export function WhatsAppSettings({ connection }: { connection: WhatsAppConnectionView | null }) {
  const router = useRouter();
  const [phone, setPhone] = useState(connection?.phone ?? "");
  const [enabled, setEnabled] = useState(connection?.enabled ?? true);
  const [verification, setVerification] = useState<VerificationStart | null>(null);
  const [saving, startSave] = useTransition();
  const [starting, startVerification] = useTransition();
  const [refreshing, startRefresh] = useTransition();
  const verified = Boolean(connection?.verifiedAt);

  function save() {
    startSave(async () => {
      const result = await saveMemberWhatsAppSettings({ phone, enabled });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setVerification(null);
      toast.success(result.data?.needsVerification ? "Número salvo. Agora confirme que ele é seu." : "WhatsApp salvo.");
    });
  }

  function verify() {
    startVerification(async () => {
      const result = await startWhatsAppVerification();
      if (result.ok && result.data) setVerification(result.data);
      else if (!result.ok) toast.error(result.error);
    });
  }

  return (
    <Card className="panel-cut rounded-none border-0 ring-0">
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <CardTitle asChild>
              <h2 className="flex items-center gap-2">
                <MessageCircleMore className="size-4 text-whatsapp" aria-hidden />
                WhatsApp
              </h2>
            </CardTitle>
            <CardDescription>
              Os avisos das suas missões chegam pelo WhatsApp do escritório, e por lá você pede missão por texto, áudio, foto ou PDF.
            </CardDescription>
          </div>
          <Badge variant={verified ? "secondary" : "outline"}>
            {!connection ? "Sem número" : verified ? "Confirmado" : "Falta confirmar"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="grid gap-5">
        <div className="grid gap-2">
          <Label htmlFor="member-whatsapp">Seu WhatsApp</Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="member-whatsapp"
              className="min-w-0 flex-1 basis-48"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="(54) 99999-0000"
              inputMode="tel"
              autoComplete="tel"
            />
            <Button disabled={saving || !phone.trim()} onClick={save}>
              {saving ? <LoaderCircle className="animate-spin" aria-hidden /> : <Save aria-hidden />}
              Salvar
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Com DDD. O 55 do Brasil é opcional.</p>
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 p-3 transition-colors hover:bg-muted/40">
          <input className="mt-0.5 size-4 shrink-0 accent-primary" type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          <span className="grid gap-0.5">
            <span className="font-medium">Avisos ativos</span>
            <span className="text-xs text-muted-foreground">Desligue quando estiver fora. Vale depois de salvar.</span>
          </span>
        </label>

        {connection && verified ? (
          <div className="grid gap-1 text-sm">
            <p className="flex items-center gap-1.5 text-success">
              <CheckCircle2 className="size-4 shrink-0" aria-hidden />
              Número confirmado em {connection.verifiedAt}.
            </p>
            <p className="text-xs text-muted-foreground">
              {connection.windowOpenUntil
                ? `Conversa aberta até ${connection.windowOpenUntil}: os avisos chegam com os botões.`
                : "Fora das 24 horas depois da sua última mensagem ao escritório, os avisos chegam pelos modelos aprovados pela Meta."}
            </p>
          </div>
        ) : null}

        {connection && !verified ? (
          <section className="panel-cut panel-cut-sm grid gap-3 bg-warning/10 p-4" aria-labelledby="whatsapp-verify-title">
            <div>
              <h3 id="whatsapp-verify-title">Confirme que o número é seu</h3>
              <p className="mt-1 max-w-prose text-sm text-muted-foreground">
                Sem a confirmação, nenhum aviso chega. Gere o código e envie pelo seu WhatsApp; ele vale por 30 minutos.
              </p>
            </div>
            {verification ? (
              <div className="grid gap-3">
                <p className="font-mono text-2xl font-semibold tracking-[0.3em] tabular-nums">{verification.code}</p>
                <div className="flex flex-wrap gap-2">
                  {verification.link ? (
                    <Button asChild>
                      <a href={verification.link} target="_blank" rel="noreferrer">
                        Abrir o WhatsApp <ExternalLink aria-hidden />
                      </a>
                    </Button>
                  ) : null}
                  <Button type="button" variant="outline" disabled={refreshing} onClick={() => startRefresh(() => router.refresh())}>
                    <RefreshCw className={refreshing ? "animate-spin" : undefined} aria-hidden />
                    Já enviei
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  No computador, envie <span className="font-mono">GUILDA {verification.code}</span> do seu WhatsApp para {verification.officePhone}. Vale até {timeLabel(verification.expiresAt)}.
                </p>
              </div>
            ) : (
              <div>
                <Button type="button" disabled={starting} onClick={verify}>
                  {starting ? <LoaderCircle className="animate-spin" aria-hidden /> : <ShieldCheck aria-hidden />}
                  Confirmar pelo WhatsApp
                </Button>
              </div>
            )}
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}
