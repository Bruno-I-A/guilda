"use client";

import { AlertTriangle, Download, FilePenLine, LoaderCircle, MoreHorizontal, Pencil, RotateCcw, Send, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatCnpj } from "@/domain/cnpj";
import { clientNfseMonthDescription } from "@/domain/client-nfse";
import {
  NFSE_CANCEL_REASON_CODES,
  NFSE_CANCEL_REASON_LABELS,
  NFSE_CANCEL_TEXT_MAX,
  NFSE_CANCEL_TEXT_MIN,
  type NfseCancelReasonCode,
  type NfseInvoiceStatus,
} from "@/domain/nfse";
import type { ClientNfseNoteView } from "@/lib/client-nfse/loaders";
import { formatBRLCurrency } from "@/lib/currency";
import { formatAppDate } from "@/lib/date-time";
import { cn } from "@/lib/utils";

import { adjustNote, cancelInvoice, retryInvoice } from "./client-nfse-actions";

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

export function clientNfsePdfHref(clanId: string, year: number, month: number, scope: { issuerId?: string; invoiceId?: string } = {}): string {
  const extra = scope.invoiceId ? `&invoiceId=${scope.invoiceId}` : scope.issuerId ? `&issuerId=${scope.issuerId}` : "";
  return `/api/nfse/clientes/pdf?clanId=${clanId}&year=${year}&month=${month}${extra}`;
}

/** Sem nota pedida neste mês (ou só cancelada): valor e texto ainda se ajustam. */
export function noteIsOpen(note: ClientNfseNoteView): boolean {
  return !note.invoice || note.invoice.status === "cancelled";
}

/** A nota da linha: detalhes, PDF, cancelar e tentar de novo. */
function InvoiceDialog({
  clanId,
  period,
  note,
  open,
  onOpenChange,
  startCancelling,
}: {
  clanId: string;
  period: { year: number; month: number };
  note: ClientNfseNoteView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  startCancelling: boolean;
}) {
  const router = useRouter();
  const invoice = note.invoice!;
  const [cancelling, setCancelling] = useState(startCancelling);
  const [reason, setReason] = useState<NfseCancelReasonCode>(1);
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();
  const length = text.trim().length;

  function run(action: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error ?? "Não deu certo.");
        return;
      }
      toast.success(success);
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (next) setCancelling(startCancelling); onOpenChange(next); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nota para {note.takerName}</DialogTitle>
          <DialogDescription>
            {STATUS_LABELS[invoice.status]} · {formatBRLCurrency(note.amount)}
            {invoice.nfseNumber ? ` · nº ${invoice.nfseNumber}` : ""}
            {invoice.issuedAt ? ` · ${formatAppDate(invoice.issuedAt)}` : ""} · DPS {invoice.dpsSeries}/{invoice.dpsNumber}
          </DialogDescription>
        </DialogHeader>
        {invoice.lastError ? <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{invoice.lastError}</p> : null}
        {cancelling ? (
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor={`cn-cancel-reason-${invoice.id}`}>Motivo do cancelamento</Label>
              <Select value={String(reason)} onValueChange={(value) => setReason(Number(value) as NfseCancelReasonCode)}>
                <SelectTrigger id={`cn-cancel-reason-${invoice.id}`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {NFSE_CANCEL_REASON_CODES.map((code) => <SelectItem key={code} value={String(code)}>{NFSE_CANCEL_REASON_LABELS[code]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`cn-cancel-text-${invoice.id}`}>Justificativa</Label>
              <Textarea id={`cn-cancel-text-${invoice.id}`} rows={3} maxLength={NFSE_CANCEL_TEXT_MAX} value={text} onChange={(event) => setText(event.target.value)} />
              <span className={cn("text-xs", length < NFSE_CANCEL_TEXT_MIN ? "text-muted-foreground" : "text-success")}>
                {length}/{NFSE_CANCEL_TEXT_MAX} — mínimo {NFSE_CANCEL_TEXT_MIN}. O cancelamento vai ao Sistema Nacional e não tem volta.
              </span>
            </div>
          </div>
        ) : null}
        <DialogFooter>
          {cancelling ? (
            <>
              <Button type="button" variant="outline" onClick={() => setCancelling(false)}>Voltar</Button>
              <Button
                type="button"
                variant="destructive"
                disabled={pending || length < NFSE_CANCEL_TEXT_MIN}
                onClick={() => run(() => cancelInvoice({ clanId, invoiceId: invoice.id, reasonCode: reason, reasonText: text }), "Cancelamento pedido. O Sistema Nacional responde em instantes.")}
              >
                {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <XCircle aria-hidden />} Cancelar a nota
              </Button>
            </>
          ) : (
            <>
              {invoice.status === "failed" ? (
                <Button type="button" disabled={pending} onClick={() => run(() => retryInvoice({ clanId, id: invoice.id }), "Nota de volta à fila.")}>
                  {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <RotateCcw aria-hidden />} Tentar de novo
                </Button>
              ) : null}
              {invoice.status === "issued" ? (
                <>
                  <Button type="button" variant="outline" onClick={() => setCancelling(true)}><XCircle aria-hidden /> Cancelar a nota</Button>
                  <Button asChild><a href={clientNfsePdfHref(clanId, period.year, period.month, { invoiceId: invoice.id })}><Download aria-hidden /> Baixar PDF</a></Button>
                </>
              ) : null}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Uma nota do mês. Valor e texto se ajustam clicando neles (só este mês); o
 * "Emitir" da linha emite só ela; o menu leva à nota padrão e à nota emitida.
 */
export function ClientNfseNoteRow({
  clanId,
  period,
  note,
  canManage,
  emissible,
  selected,
  onToggle,
  onEmit,
  onEditStandard,
}: {
  clanId: string;
  period: { year: number; month: number };
  note: ClientNfseNoteView;
  canManage: boolean;
  emissible: boolean;
  selected: boolean;
  onToggle: () => void;
  onEmit: () => void;
  onEditStandard: () => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(note.amount);
  const [text, setText] = useState(note.description);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [cancelFirst, setCancelFirst] = useState(false);
  const [saving, startSaving] = useTransition();
  const open = noteIsOpen(note);
  const editable = canManage && open;
  const invoice = note.invoice;
  const working = invoice?.status === "queued" || invoice?.status === "cancel_requested";
  const standard = clientNfseMonthDescription(note.model.description, period, note.model.reference);
  const adjusted = Boolean(note.itemId) && (note.amount !== note.model.amount || note.description !== standard);

  function startEditing() {
    if (!editable) return;
    setAmount(note.amount);
    setText(note.description);
    setEditing(true);
  }

  function save() {
    startSaving(async () => {
      const result = await adjustNote({ clanId, year: period.year, month: period.month, modelId: note.modelId, amount, description: text });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Ajustado só neste mês.");
      setEditing(false);
      router.refresh();
    });
  }

  function showInvoice(cancel: boolean) {
    setCancelFirst(cancel);
    setInvoiceOpen(true);
  }

  return (
    <li className={cn("grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center", selected && "bg-primary/5")}>
      <input
        type="checkbox"
        className="size-4 accent-primary disabled:opacity-30"
        checked={selected}
        disabled={!emissible}
        onChange={onToggle}
        aria-label={`Escolher a nota de ${note.takerName}`}
      />
      {editing ? (
        <div className="col-span-1 grid min-w-0 gap-2 sm:col-span-2 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-start">
          <p className="text-sm sm:col-span-3">
            <span className="font-medium">{note.takerName}</span> <span className="text-xs text-muted-foreground">· ajuste só deste mês; a nota padrão continua igual</span>
          </p>
          <Textarea aria-label={`Descrição da nota de ${note.takerName} neste mês`} rows={2} maxLength={2000} value={text} onChange={(event) => setText(event.target.value)} autoFocus />
          <CurrencyInput aria-label={`Valor da nota de ${note.takerName} neste mês`} value={amount} onValueChange={setAmount} />
          <div className="flex gap-1">
            <Button type="button" size="sm" disabled={saving || !amount || !text.trim()} onClick={save}>
              {saving ? <LoaderCircle className="animate-spin" aria-hidden /> : null} Salvar
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancelar</Button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid min-w-0 gap-0.5 text-sm">
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <span className="truncate font-medium">{note.takerName}</span>
              <span className="font-mono text-xs text-muted-foreground">{formatCnpj(note.takerDocument)}</span>
              {adjusted ? <Badge variant="outline" className="text-xs">ajustada neste mês</Badge> : null}
              {!note.model.active ? <Badge variant="outline" className="text-xs">pausada</Badge> : null}
            </span>
            {editable ? (
              <button type="button" onClick={startEditing} className="line-clamp-2 text-left text-xs text-muted-foreground decoration-dashed underline-offset-4 hover:text-foreground hover:underline" title="Ajustar o texto só neste mês">
                {note.description}
              </button>
            ) : (
              <span className="line-clamp-2 text-xs text-muted-foreground">{note.description}</span>
            )}
          </div>
          <div className="col-start-2 flex flex-wrap items-center gap-2 sm:col-start-3 sm:justify-end">
            {editable ? (
              <button type="button" onClick={startEditing} className="font-mono text-sm tabular-nums decoration-dashed underline-offset-4 hover:underline" title="Ajustar o valor só neste mês">
                {formatBRLCurrency(note.amount)}
              </button>
            ) : (
              <span className="font-mono text-sm tabular-nums">{formatBRLCurrency(note.amount)}</span>
            )}
            {invoice && invoice.status !== "cancelled" ? (
              <button
                type="button"
                onClick={() => showInvoice(false)}
                className={cn("inline-flex min-h-8 items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-xs tabular-nums transition-colors hover:brightness-125", STATUS_CLASSES[invoice.status])}
                aria-label={`Nota de ${note.takerName}: ${STATUS_LABELS[invoice.status]}. Abrir detalhes.`}
              >
                {working ? <LoaderCircle className="size-3 animate-spin" aria-hidden /> : null}
                {invoice.status === "issued" && invoice.nfseNumber ? `Nº ${invoice.nfseNumber}` : STATUS_LABELS[invoice.status]}
              </button>
            ) : note.blocked ? (
              <span className="flex max-w-56 items-start gap-1 text-xs text-warning" title={note.blocked}>
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> <span className="line-clamp-2">{note.blocked}</span>
              </span>
            ) : emissible ? (
              <Button type="button" size="sm" variant="outline" onClick={onEmit}>
                <Send aria-hidden /> Emitir
              </Button>
            ) : null}
            {invoice?.status === "cancelled" ? <span className="text-xs text-muted-foreground">anterior cancelada</span> : null}
            {canManage ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="icon-sm" className="touch-target" aria-label={`Mais ações da nota de ${note.takerName}`}>
                    <MoreHorizontal aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {editable ? <DropdownMenuItem onSelect={startEditing}><Pencil aria-hidden /> Ajustar só este mês</DropdownMenuItem> : null}
                  <DropdownMenuItem onSelect={onEditStandard}><FilePenLine aria-hidden /> Editar nota padrão</DropdownMenuItem>
                  {invoice?.status === "issued" ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem asChild><a href={clientNfsePdfHref(clanId, period.year, period.month, { invoiceId: invoice.id })}><Download aria-hidden /> Baixar PDF</a></DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => showInvoice(true)}><XCircle aria-hidden /> Cancelar a nota</DropdownMenuItem>
                    </>
                  ) : null}
                  {invoice?.status === "failed" ? (
                    <DropdownMenuItem onSelect={() => showInvoice(false)}><RotateCcw aria-hidden /> Ver erro e tentar de novo</DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </>
      )}
      {invoice && invoice.status !== "cancelled" ? (
        <InvoiceDialog clanId={clanId} period={period} note={note} open={invoiceOpen} onOpenChange={setInvoiceOpen} startCancelling={cancelFirst} />
      ) : null}
    </li>
  );
}
