"use client";

import { Download, FileText, LoaderCircle, RotateCcw, Send, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"] as const;

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

const KIND_LABELS: Record<NfseInvoiceKind, string> = { monthly: "Mensal", additional_installment: "PA" };

function cents(value: number): string {
  return formatBRLCurrency((value / 100).toFixed(2));
}

function StatusChip({ status }: { status: NfseInvoiceStatus }) {
  const working = status === "queued" || status === "cancel_requested";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium", STATUS_CLASSES[status])}>
      {working ? <LoaderCircle className="size-3 animate-spin" aria-hidden /> : null}
      {STATUS_LABELS[status]}
    </span>
  );
}

function EmitDialog({ clanId, year, month, monthLabel, disabled, disabledReason }: { clanId: string; year: number; month: number; monthLabel: string; disabled: boolean; disabledReason: string | null }) {
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
      <Button type="button" disabled={disabled} title={disabledReason ?? undefined} onClick={() => { setOpen(true); load(includeAdditional); }}>
        <Send aria-hidden /> Emitir notas de {monthLabel}
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
                  {preview.items.length === 0 ? <li className="px-3 py-2 text-sm text-muted-foreground">Nenhuma nota a emitir.</li> : null}
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

function CancelDialog({ clanId, invoice, onClose }: { clanId: string; invoice: NfseInvoiceView; onClose: () => void }) {
  const router = useRouter();
  const [reason, setReason] = useState<NfseCancelReasonCode>(1);
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();
  const length = text.trim().length;
  function submit() {
    startTransition(async () => {
      const result = await cancelNfseInvoice({ clanId, invoiceId: invoice.id, reasonCode: reason, reasonText: text });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Cancelamento pedido. O Sistema Nacional responde em instantes.");
      onClose();
      router.refresh();
    });
  }
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Cancelar a nota {invoice.nfseNumber ?? ""}</DialogTitle>
          <DialogDescription>{invoice.clientName} · {formatBRLCurrency(invoice.amount)}. O cancelamento vai ao Sistema Nacional e não tem volta.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="nfse-cancel-reason">Motivo</Label>
          <Select value={String(reason)} onValueChange={(value) => setReason(Number(value) as NfseCancelReasonCode)}>
            <SelectTrigger id="nfse-cancel-reason"><SelectValue /></SelectTrigger>
            <SelectContent>
              {NFSE_CANCEL_REASON_CODES.map((code) => <SelectItem key={code} value={String(code)}>{NFSE_CANCEL_REASON_LABELS[code]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="nfse-cancel-text">Justificativa</Label>
          <Textarea id="nfse-cancel-text" rows={3} maxLength={NFSE_CANCEL_TEXT_MAX} value={text} onChange={(event) => setText(event.target.value)} />
          <span className={cn("text-xs", length < NFSE_CANCEL_TEXT_MIN ? "text-muted-foreground" : "text-success")}>{length}/{NFSE_CANCEL_TEXT_MAX} — mínimo {NFSE_CANCEL_TEXT_MIN}</span>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Voltar</Button>
          <Button type="button" variant="destructive" disabled={pending || length < NFSE_CANCEL_TEXT_MIN} onClick={submit}>
            {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <XCircle aria-hidden />} Cancelar a nota
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RetryButton({ clanId, invoiceId }: { clanId: string; invoiceId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => startTransition(async () => {
      const result = await retryNfseInvoice({ clanId, invoiceId });
      if (!result.ok) { toast.error(result.error); return; }
      router.refresh();
    })}>
      {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <RotateCcw aria-hidden />} Tentar de novo
    </Button>
  );
}

export function NfsePanel({ clanId, year, month, canManage, isAdmin, settings, invoices }: { clanId: string; year: number; month: number; canManage: boolean; isAdmin: boolean; settings: NfseSettingsPanelView | null; invoices: readonly NfseInvoiceView[] }) {
  const router = useRouter();
  const [cancelling, setCancelling] = useState<NfseInvoiceView | null>(null);
  const monthLabel = MONTHS[month - 1];
  const pendingWork = invoices.some((invoice) => invoice.status === "queued" || invoice.status === "cancel_requested");

  useEffect(() => {
    if (!pendingWork) return;
    const timer = setInterval(() => router.refresh(), 5_000);
    return () => clearInterval(timer);
  }, [pendingWork, router]);

  const health = nfseServiceHealth({
    configured: Boolean(settings?.template),
    serviceSeenAt: settings?.serviceSeenAt ? new Date(settings.serviceSeenAt) : null,
    serviceError: settings?.serviceError ?? null,
    certificateValidUntil: settings?.certificateValidUntil ? new Date(settings.certificateValidUntil) : null,
    now: new Date(),
  });
  const statusText = {
    unconfigured: "O modelo da nota ainda não foi configurado. Um admin preenche em \"Modelo da nota\".",
    offline: "O serviço fiscal não respondeu nos últimos minutos. Os pedidos esperam na fila até ele voltar.",
    error: `O serviço fiscal está com problema: ${settings?.serviceError ?? ""}`,
    ready: settings?.serviceEnvironment === 2 ? "Ambiente de TESTE (produção restrita): as notas não têm valor fiscal." : "Emissão no Sistema Nacional, com o certificado do escritório.",
  }[health.state];
  const issuedCount = invoices.filter((invoice) => invoice.status === "issued").length;
  const disabledReason = !canManage ? "Só integrantes do Fiscal e admins emitem notas." : health.state !== "ready" ? statusText : null;
  const pdfHref = `/api/nfse/pdfs?clanId=${clanId}&year=${year}&month=${month}`;

  return (
    <section className="panel-cut grid min-w-0 grid-cols-1 gap-4 p-4" aria-labelledby="nfse-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <h2 id="nfse-title">Notas de honorário</h2>
          <p className={cn("max-w-prose text-sm", health.state === "ready" ? "text-muted-foreground" : "text-warning")}>{statusText}</p>
          {health.certificateDaysLeft !== null && health.certificateDaysLeft <= NFSE_CERTIFICATE_WARNING_DAYS ? (
            <p className="text-sm text-warning">O certificado do escritório vence em {Math.max(0, health.certificateDaysLeft)} dias.</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {isAdmin ? <NfseSettingsDialog clanId={clanId} settings={settings} /> : null}
          {issuedCount > 0 && canManage ? (
            <Button asChild variant="outline"><a href={pdfHref}><Download aria-hidden /> Baixar PDFs ({issuedCount})</a></Button>
          ) : (
            <Button type="button" variant="outline" disabled><Download aria-hidden /> Baixar PDFs</Button>
          )}
          <EmitDialog clanId={clanId} year={year} month={month} monthLabel={monthLabel} disabled={disabledReason !== null} disabledReason={disabledReason} />
        </div>
      </div>
      {invoices.length > 0 ? (
        <div className="min-w-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Empresa</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Nº</TableHead>
                <TableHead><span className="sr-only">Ações</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell className="max-w-64">
                    <span className="block truncate">{invoice.clientName}</span>
                    {invoice.lastError ? <span className="block text-xs whitespace-normal text-destructive">{invoice.lastError}</span> : null}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{KIND_LABELS[invoice.kind]}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatBRLCurrency(invoice.amount)}</TableCell>
                  <TableCell><StatusChip status={invoice.status} /></TableCell>
                  <TableCell className="font-mono text-xs tabular-nums">
                    {invoice.nfseNumber ?? "—"}
                    {invoice.issuedAt ? <span className="block text-muted-foreground">{formatAppDate(invoice.issuedAt)}</span> : null}
                  </TableCell>
                  <TableCell className="text-right">
                    {canManage && invoice.status === "failed" ? <RetryButton clanId={clanId} invoiceId={invoice.id} /> : null}
                    {canManage && invoice.status === "issued" ? (
                      <span className="inline-flex gap-1">
                        <Button asChild variant="ghost" size="icon-sm" aria-label={`PDF da nota de ${invoice.clientName}`}>
                          <a href={`${pdfHref}&invoiceId=${invoice.id}`}><FileText aria-hidden /></a>
                        </Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => setCancelling(invoice)}><XCircle aria-hidden /> Cancelar</Button>
                      </span>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Nenhuma nota de {monthLabel} emitida pela Guilda ainda.</p>
      )}
      {cancelling ? <CancelDialog clanId={clanId} invoice={cancelling} onClose={() => setCancelling(null)} /> : null}
    </section>
  );
}
