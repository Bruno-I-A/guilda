"use client";

import { Download, LoaderCircle, RotateCcw, Send, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  NFSE_CANCEL_REASON_CODES,
  NFSE_CANCEL_REASON_LABELS,
  NFSE_CANCEL_TEXT_MAX,
  NFSE_CANCEL_TEXT_MIN,
  NFSE_CERTIFICATE_WARNING_DAYS,
  NFSE_EXCLUSION_LABELS,
  nfseServiceHealth,
  type NfseCancelReasonCode,
  type NfseEmissionPreviewView,
  type NfseInvoiceKind,
  type NfseInvoiceStatus,
} from "@/domain/nfse";
import { formatBRLCurrency } from "@/lib/currency";
import { formatAppDate } from "@/lib/date-time";
import type { NfseTemplate } from "@/lib/nfse/template";
import { cn } from "@/lib/utils";

import { cancelNfseInvoice, emitNfseBatch, previewNfseEmission, retryNfseInvoice } from "./nfse-actions";
import { NfseSettingsDialog } from "./nfse-settings-dialog";

export interface NfseInvoiceView {
  id: string;
  controlPeriodId: string;
  clientName: string;
  kind: NfseInvoiceKind;
  amount: string;
  status: NfseInvoiceStatus;
  nfseNumber: string | null;
  issuedAt: string | null;
  lastError: string | null;
  environment: number | null;
}

export interface NfseSettingsPanelView {
  providerCnpj: string;
  dpsSeries: string;
  template: NfseTemplate | null;
  serviceSeenAt: string | null;
  serviceEnvironment: number | null;
  certificateValidUntil: string | null;
  serviceError: string | null;
}

const STATUS_LABELS: Record<NfseInvoiceStatus, string> = {
  queued: "Na fila",
  issued: "Emitida",
  failed: "Com erro",
  cancel_requested: "Cancelando",
  cancelled: "Cancelada",
};

const STATUS_CLASSES: Record<NfseInvoiceStatus, string> = {
  queued: "border-warning/40 bg-warning/10 text-warning",
  issued: "border-success/40 bg-success/10 text-success",
  failed: "border-destructive/50 bg-destructive/10 text-destructive",
  cancel_requested: "border-warning/40 bg-warning/10 text-warning",
  cancelled: "border-border text-muted-foreground",
};

export function nfsePdfHref(clanId: string, year: number, month: number, invoiceId?: string): string {
  return `/api/nfse/pdfs?clanId=${clanId}&year=${year}&month=${month}${invoiceId ? `&invoiceId=${invoiceId}` : ""}`;
}

export function nfseHealth(settings: NfseSettingsPanelView | null) {
  return nfseServiceHealth({
    configured: Boolean(settings?.template),
    serviceSeenAt: settings?.serviceSeenAt ? new Date(settings.serviceSeenAt) : null,
    serviceError: settings?.serviceError ?? null,
    certificateValidUntil: settings?.certificateValidUntil ? new Date(settings.certificateValidUntil) : null,
    now: new Date(),
  });
}

function cents(value: number): string {
  return formatBRLCurrency((value / 100).toFixed(2));
}

/**
 * Só aparece quando algo impede ou ameaça a emissão. Com tudo certo, a tela
 * fica quieta — o ambiente de teste vira uma etiqueta no cabeçalho do mês.
 */
export function NfseNotice({ clanId, settings, isAdmin }: { clanId: string; settings: NfseSettingsPanelView | null; isAdmin: boolean }) {
  const health = nfseHealth(settings);
  const lines: ReactNode[] = [];
  if (health.state === "unconfigured") {
    lines.push(
      isAdmin ? (
        <>Para emitir as notas pela Guilda, configure o modelo da nota em <Link className="text-primary underline-offset-4 hover:underline" href={`/clans/${clanId}?tab=fees&feeView=base`}>Cadastro de honorários</Link>.</>
      ) : (
        "Um admin ainda precisa configurar o modelo da nota para emitir pela Guilda."
      ),
    );
  } else if (health.state === "offline") {
    lines.push("O serviço fiscal não respondeu nos últimos minutos. Os pedidos esperam na fila até ele voltar.");
  } else if (health.state === "error") {
    lines.push(`O serviço fiscal está com problema: ${settings?.serviceError ?? ""}`);
  }
  if (health.certificateDaysLeft !== null && health.certificateDaysLeft <= NFSE_CERTIFICATE_WARNING_DAYS) {
    lines.push(`O certificado do escritório vence em ${Math.max(0, health.certificateDaysLeft)} dias.`);
  }
  if (lines.length === 0) return null;
  return (
    <div className="grid gap-1 text-sm text-warning">
      {lines.map((line, index) => <p key={index} className="max-w-prose">{line}</p>)}
    </div>
  );
}

/** Cartão da visão de cadastro: onde fica a configuração, longe da rotina do mês. */
export function NfseSetupCard({ clanId, settings, isAdmin }: { clanId: string; settings: NfseSettingsPanelView | null; isAdmin: boolean }) {
  const health = nfseHealth(settings);
  const status = {
    unconfigured: "Ainda não configurada. Com o modelo preenchido, as notas do mês saem por um clique em Mês a mês.",
    offline: "Configurada, mas o serviço fiscal não está respondendo.",
    error: `Configurada, com problema no serviço fiscal: ${settings?.serviceError ?? ""}`,
    ready: settings?.serviceEnvironment === 2 ? "Configurada, no ambiente de TESTE: as notas não têm valor fiscal." : "Configurada, emitindo no Sistema Nacional.",
  }[health.state];
  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card/50 p-3" aria-labelledby="nfse-setup-title">
      <div className="grid min-w-0 gap-0.5">
        <h3 id="nfse-setup-title">Emissão de notas</h3>
        <p className={cn("max-w-prose text-sm", health.state === "ready" ? "text-muted-foreground" : "text-warning")}>{status}</p>
      </div>
      {isAdmin ? <NfseSettingsDialog clanId={clanId} settings={settings} /> : null}
    </section>
  );
}

export function NfseEmitDialog({ clanId, year, month, monthLabel, disabledReason }: { clanId: string; year: number; month: number; monthLabel: string; disabledReason: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [includeAdditional, setIncludeAdditional] = useState(false);
  const [preview, setPreview] = useState<NfseEmissionPreviewView | null>(null);
  const [loading, startLoading] = useTransition();
  const [sending, startSending] = useTransition();

  function load(nextInclude: boolean) {
    startLoading(async () => {
      const result = await previewNfseEmission({ clanId, year, month, includeAdditional: nextInclude });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setPreview(result.data ?? null);
    });
  }

  function emit() {
    if (!preview) return;
    startSending(async () => {
      const result = await emitNfseBatch({ clanId, year, month, includeAdditional, expectedCount: preview.items.length, expectedTotalCents: preview.totalCents });
      if (!result.ok) {
        toast.error(result.error);
        load(includeAdditional);
        return;
      }
      toast.success(`${result.data?.queued ?? preview.items.length} notas na fila. Elas saem em instantes.`);
      setOpen(false);
      router.refresh();
    });
  }

  const count = preview?.items.length ?? 0;
  return (
    <>
      <Button type="button" disabled={disabledReason !== null} title={disabledReason ?? undefined} onClick={() => { setOpen(true); load(includeAdditional); }}>
        <Send aria-hidden /> Emitir notas
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Notas de honorário · {monthLabel}</DialogTitle>
            <DialogDescription>Confira antes de emitir: nota emitida só se desfaz com cancelamento formal.</DialogDescription>
          </DialogHeader>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-primary" checked={includeAdditional} disabled={loading || sending} onChange={(event) => { setIncludeAdditional(event.target.checked); load(event.target.checked); }} />
            Incluir a PA (parcela adicional) de quem cobra
          </label>
          {loading && !preview ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" aria-hidden /> Montando a prévia…</p>
          ) : preview ? (
            <div className="grid min-w-0 grid-cols-1 gap-3">
              <div className="max-h-72 overflow-auto rounded-md border">
                <ul className="divide-y">
                  {preview.items.map((item) => (
                    <li key={`${item.controlPeriodId}-${item.kind}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span className="min-w-0 truncate">{item.clientName}{item.kind === "additional_installment" ? <span className="ml-2 text-xs text-muted-foreground">PA</span> : null}</span>
                      <span className="font-mono tabular-nums">{cents(item.amountCents)}</span>
                    </li>
                  ))}
                  {preview.items.length === 0 ? <li className="px-3 py-2 text-sm text-muted-foreground">Nenhuma nota a emitir: todas já saíram ou estão na fila.</li> : null}
                </ul>
              </div>
              {preview.excluded.length > 0 ? (
                <section className="grid gap-1">
                  <p className="hud-label">Ficam de fora ({preview.excluded.length})</p>
                  <ul className="grid gap-1 text-xs text-muted-foreground">
                    {preview.excluded.map((item) => (
                      <li key={`${item.controlPeriodId}-${item.kind}`}>{item.clientName}{item.kind === "additional_installment" ? " (PA)" : ""} — {NFSE_EXCLUSION_LABELS[item.reason]}</li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {preview.companiesWithoutFee > 0 ? (
                <p className="text-xs text-warning">{preview.companiesWithoutFee} empresas ativas ainda não têm honorário cadastrado e não entram.</p>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Voltar</Button>
            <Button type="button" disabled={!preview || count === 0 || loading || sending} onClick={emit}>
              {sending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Send aria-hidden />}
              Emitir {count} {count === 1 ? "nota" : "notas"} · <span className="font-mono tabular-nums">{cents(preview?.totalCents ?? 0)}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** A nota de uma linha do controle: situação na própria célula, ações ao abrir. */
export function NfseInvoiceCell({ clanId, year, month, invoice, canManage }: { clanId: string; year: number; month: number; invoice: NfseInvoiceView; canManage: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState<NfseCancelReasonCode>(1);
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();
  const working = invoice.status === "queued" || invoice.status === "cancel_requested";
  const label = invoice.status === "issued" && invoice.nfseNumber ? `Nº ${invoice.nfseNumber}` : STATUS_LABELS[invoice.status];
  const length = text.trim().length;

  function run(action: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error ?? "Não deu certo.");
        return;
      }
      toast.success(success);
      setOpen(false);
      setCancelling(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setCancelling(false); }}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-xs tabular-nums transition-colors hover:brightness-125", STATUS_CLASSES[invoice.status])}
        aria-label={`Nota de ${invoice.clientName}: ${STATUS_LABELS[invoice.status]}. Abrir detalhes.`}
      >
        {working ? <LoaderCircle className="size-3 animate-spin" aria-hidden /> : null}
        {label}
      </button>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{invoice.kind === "additional_installment" ? "PA" : "Nota"} de {invoice.clientName}</DialogTitle>
          <DialogDescription>
            {STATUS_LABELS[invoice.status]} · {formatBRLCurrency(invoice.amount)}
            {invoice.nfseNumber ? ` · nº ${invoice.nfseNumber}` : ""}
            {invoice.issuedAt ? ` · ${formatAppDate(invoice.issuedAt)}` : ""}
            {invoice.environment === 2 ? " · ambiente de teste" : ""}
          </DialogDescription>
        </DialogHeader>
        {invoice.lastError ? <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{invoice.lastError}</p> : null}
        {cancelling ? (
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor={`nfse-cancel-reason-${invoice.id}`}>Motivo do cancelamento</Label>
              <Select value={String(reason)} onValueChange={(value) => setReason(Number(value) as NfseCancelReasonCode)}>
                <SelectTrigger id={`nfse-cancel-reason-${invoice.id}`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {NFSE_CANCEL_REASON_CODES.map((code) => <SelectItem key={code} value={String(code)}>{NFSE_CANCEL_REASON_LABELS[code]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`nfse-cancel-text-${invoice.id}`}>Justificativa</Label>
              <Textarea id={`nfse-cancel-text-${invoice.id}`} rows={3} maxLength={NFSE_CANCEL_TEXT_MAX} value={text} onChange={(event) => setText(event.target.value)} />
              <span className={cn("text-xs", length < NFSE_CANCEL_TEXT_MIN ? "text-muted-foreground" : "text-success")}>{length}/{NFSE_CANCEL_TEXT_MAX} — mínimo {NFSE_CANCEL_TEXT_MIN}. O cancelamento vai ao Sistema Nacional e não tem volta.</span>
            </div>
          </div>
        ) : null}
        <DialogFooter>
          {cancelling ? (
            <>
              <Button type="button" variant="outline" onClick={() => setCancelling(false)}>Voltar</Button>
              <Button type="button" variant="destructive" disabled={pending || length < NFSE_CANCEL_TEXT_MIN} onClick={() => run(() => cancelNfseInvoice({ clanId, invoiceId: invoice.id, reasonCode: reason, reasonText: text }), "Cancelamento pedido. O Sistema Nacional responde em instantes.")}>
                {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <XCircle aria-hidden />} Cancelar a nota
              </Button>
            </>
          ) : (
            <>
              {canManage && invoice.status === "failed" ? (
                <Button type="button" disabled={pending} onClick={() => run(() => retryNfseInvoice({ clanId, invoiceId: invoice.id }), "Nota de volta à fila.")}>
                  {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <RotateCcw aria-hidden />} Tentar de novo
                </Button>
              ) : null}
              {canManage && invoice.status === "issued" ? (
                <>
                  <Button type="button" variant="outline" onClick={() => setCancelling(true)}><XCircle aria-hidden /> Cancelar a nota</Button>
                  <Button asChild><a href={nfsePdfHref(clanId, year, month, invoice.id)}><Download aria-hidden /> Baixar PDF</a></Button>
                </>
              ) : null}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
