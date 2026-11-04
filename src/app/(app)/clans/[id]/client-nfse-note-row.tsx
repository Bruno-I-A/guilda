"use client";

import { AlertTriangle, ClipboardPen, CircleSlash, Download, LoaderCircle, MapPin, MoreHorizontal, Pencil, RotateCcw, Send, Trash2, XCircle } from "lucide-react";
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
import { Input } from "@/components/ui/input";
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
  type NfseClientAddress,
  type NfseInvoiceStatus,
} from "@/domain/nfse";
import type { ClientNfseInvoiceView, ClientNfseNoteView } from "@/lib/client-nfse/loaders";
import { formatBRLCurrency } from "@/lib/currency";
import { formatAppDate } from "@/lib/date-time";
import { cn } from "@/lib/utils";

import { adjustNote, cancelInvoice, discardInvoice, fixInvoiceAddress, fixInvoiceService, retryInvoice } from "./client-nfse-actions";
import { Field } from "./nfse-settings-dialog";

export const STATUS_LABELS: Record<NfseInvoiceStatus, string> = {
  queued: "Na fila",
  issued: "Emitida",
  failed: "Com erro",
  cancel_requested: "Cancelando",
  cancelled: "Cancelada",
};

export const STATUS_CLASSES: Record<NfseInvoiceStatus, string> = {
  queued: "border-warning/40 bg-warning/10 text-warning",
  issued: "border-success/40 bg-success/10 text-success",
  failed: "border-destructive bg-destructive/15 text-foreground",
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

/** A nota pedida (fixa ou avulsa): detalhes, PDF, cancelar e tentar de novo. */
export function ClientNfseInvoiceDialog({
  clanId,
  period,
  takerName,
  takerAddress,
  amount,
  invoice,
  open,
  onOpenChange,
  startCancelling,
  canManage,
  blockedReason = null,
}: {
  clanId: string;
  period: { year: number; month: number };
  takerName: string;
  /** O endereço no cadastro do tomador, para corrigir a nota com erro. */
  takerAddress: NfseClientAddress | null;
  amount: string;
  invoice: ClientNfseInvoiceView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  startCancelling: boolean;
  canManage: boolean;
  /** Por que a empresa não emite agora. Sobra só descartar: tentar de novo falharia igual. */
  blockedReason?: string | null;
}) {
  const router = useRouter();
  const [cancelling, setCancelling] = useState(startCancelling);
  const [reason, setReason] = useState<NfseCancelReasonCode>(1);
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();
  const length = text.trim().length;
  const canFix = canManage && !blockedReason;
  // Erro que fala de endereço já abre o formulário: é o conserto que falta.
  const [fixing, setFixing] = useState(invoice.status === "failed" && canFix && /cep|endere/i.test(invoice.lastError ?? ""));
  const [address, setAddress] = useState(() => ({
    zipCode: takerAddress?.zipCode ?? "",
    street: takerAddress?.street ?? "",
    number: takerAddress?.number ?? "",
    complement: takerAddress?.complement ?? "",
    district: takerAddress?.district ?? "",
    city: takerAddress?.city ?? "",
    state: takerAddress?.state ?? "",
  }));
  // Erro que aponta o código do serviço já abre a correção dele.
  const [fixingService, setFixingService] = useState(invoice.status === "failed" && canFix && !fixing && /E03\d\d|c[oó]digo de tributa|NBS/i.test(invoice.lastError ?? ""));
  const [service, setService] = useState({
    nationalTaxCode: invoice.service?.nationalTaxCode ?? "",
    municipalTaxCode: invoice.service?.municipalTaxCode ?? "",
    nbsCode: invoice.service?.nbsCode ?? "",
  });
  const [applyToIssuer, setApplyToIssuer] = useState(true);
  const [discarding, setDiscarding] = useState(false);
  const field = (key: keyof typeof address) => (event: React.ChangeEvent<HTMLInputElement>) => setAddress((current) => ({ ...current, [key]: event.target.value }));
  const blank = (value: string) => value.trim() || null;

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
    <Dialog open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next); }}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nota para {takerName}</DialogTitle>
          <DialogDescription>
            {STATUS_LABELS[invoice.status]} · {formatBRLCurrency(amount)}
            {invoice.nfseNumber ? ` · nº ${invoice.nfseNumber}` : ""}
            {invoice.issuedAt ? ` · ${formatAppDate(invoice.issuedAt)}` : ""} · DPS {invoice.dpsSeries}/{invoice.dpsNumber}
          </DialogDescription>
        </DialogHeader>
        {invoice.lastError ? <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">{invoice.lastError}</p> : null}
        {blockedReason && canManage ? (
          <p role="status" className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <span>Esta empresa não pode emitir agora. {blockedReason} Depois de resolver, as ações desta nota voltam a aparecer.</span>
          </p>
        ) : null}
        {discarding ? (
          <p role="alert" className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
            A nota sai da lista e não será emitida. Ela não foi emitida, então não há o que cancelar no Sistema Nacional. Se ela ainda precisar sair, emita outra em Nova nota.
          </p>
        ) : null}
        {fixingService && !cancelling && !discarding ? (
          <fieldset className="grid gap-3 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">Serviço desta nota</legend>
            <p className="text-sm">
              Município gravado nesta nota: <strong>{invoice.cityLabel ?? "não identificado"}</strong>
              {invoice.cityCode ? <span className="font-mono text-xs text-muted-foreground"> · IBGE {invoice.cityCode}</span> : null}
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field id={`${invoice.id}-ctrib`} label="Tributação nacional" hint="6 dígitos."><Input id={`${invoice.id}-ctrib`} inputMode="numeric" value={service.nationalTaxCode} onChange={(event) => setService((current) => ({ ...current, nationalTaxCode: event.target.value }))} /></Field>
              <Field id={`${invoice.id}-cmun`} label="Código municipal" hint="3 dígitos ou em branco."><Input id={`${invoice.id}-cmun`} inputMode="numeric" value={service.municipalTaxCode} onChange={(event) => setService((current) => ({ ...current, municipalTaxCode: event.target.value }))} /></Field>
              <Field id={`${invoice.id}-nbs`} label="NBS" hint="9 dígitos ou em branco."><Input id={`${invoice.id}-nbs`} inputMode="numeric" value={service.nbsCode} onChange={(event) => setService((current) => ({ ...current, nbsCode: event.target.value }))} /></Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-primary" checked={applyToIssuer} onChange={(event) => setApplyToIssuer(event.target.checked)} />
              Usar também nas próximas notas desta empresa
            </label>
          </fieldset>
        ) : null}
        {fixing && !cancelling && !discarding ? (
          <fieldset className="grid gap-3 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">Endereço de {takerName}</legend>
            <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
              <Field id={`${invoice.id}-zip`} label="CEP"><Input id={`${invoice.id}-zip`} value={address.zipCode} inputMode="numeric" autoComplete="off" onChange={field("zipCode")} /></Field>
              <Field id={`${invoice.id}-street`} label="Rua"><Input id={`${invoice.id}-street`} value={address.street} autoComplete="off" onChange={field("street")} /></Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-[6rem_1fr_1fr]">
              <Field id={`${invoice.id}-number`} label="Número"><Input id={`${invoice.id}-number`} value={address.number} autoComplete="off" onChange={field("number")} /></Field>
              <Field id={`${invoice.id}-complement`} label="Complemento"><Input id={`${invoice.id}-complement`} value={address.complement} autoComplete="off" onChange={field("complement")} /></Field>
              <Field id={`${invoice.id}-district`} label="Bairro"><Input id={`${invoice.id}-district`} value={address.district} autoComplete="off" onChange={field("district")} /></Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_5rem]">
              <Field id={`${invoice.id}-city`} label="Cidade"><Input id={`${invoice.id}-city`} value={address.city} autoComplete="off" onChange={field("city")} /></Field>
              <Field id={`${invoice.id}-state`} label="UF"><Input id={`${invoice.id}-state`} value={address.state} maxLength={2} autoComplete="off" onChange={field("state")} /></Field>
            </div>
            <p className="text-xs text-muted-foreground">Fica gravado no cadastro do cliente e vale para as próximas notas dele.</p>
          </fieldset>
        ) : null}
        {cancelling && canFix ? (
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
        <DialogFooter className="sm:flex-wrap">
          {discarding ? (
            <>
              <Button type="button" variant="outline" disabled={pending} onClick={() => setDiscarding(false)}>Voltar</Button>
              <Button type="button" variant="destructive" disabled={pending} onClick={() => run(() => discardInvoice({ clanId, id: invoice.id }), "Nota descartada.")}>
                {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />} Descartar a nota
              </Button>
            </>
          ) : cancelling && canFix ? (
            <>
              <Button type="button" variant="outline" disabled={pending} onClick={() => setCancelling(false)}>Voltar</Button>
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
              {invoice.status === "failed" && canManage ? (
                <Button type="button" variant="ghost" className="touch-target mr-auto text-destructive" disabled={pending} onClick={() => setDiscarding(true)}><Trash2 aria-hidden /> Descartar</Button>
              ) : null}
              {invoice.status === "failed" && canFix && fixingService ? (
                <>
                  <Button type="button" variant="outline" disabled={pending} onClick={() => setFixingService(false)}>Voltar</Button>
                  <Button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      run(
                        () =>
                          fixInvoiceService({
                            clanId,
                            id: invoice.id,
                            service: {
                              nationalTaxCode: service.nationalTaxCode.trim(),
                              municipalTaxCode: service.municipalTaxCode.trim() || undefined,
                              nbsCode: service.nbsCode.trim() || undefined,
                            },
                            applyToIssuer,
                          }),
                        "Serviço corrigido. A nota voltou à fila.",
                      )
                    }
                  >
                    {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <RotateCcw aria-hidden />} Salvar e tentar de novo
                  </Button>
                </>
              ) : null}
              {invoice.status === "failed" && canFix && fixing ? (
                <>
                  <Button type="button" variant="outline" disabled={pending} onClick={() => setFixing(false)}>Voltar</Button>
                  <Button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      run(
                        () =>
                          fixInvoiceAddress({
                            clanId,
                            id: invoice.id,
                            address: {
                              zipCode: blank(address.zipCode),
                              street: blank(address.street),
                              number: blank(address.number),
                              complement: blank(address.complement),
                              district: blank(address.district),
                              city: blank(address.city),
                              state: blank(address.state),
                            },
                          }),
                        "Endereço corrigido. A nota voltou à fila.",
                      )
                    }
                  >
                    {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <RotateCcw aria-hidden />} Salvar e tentar de novo
                  </Button>
                </>
              ) : null}
              {invoice.status === "failed" && canFix && !fixing && !fixingService ? (
                <Button type="button" variant="outline" disabled={pending} onClick={() => setFixingService(true)}><ClipboardPen aria-hidden /> Corrigir serviço</Button>
              ) : null}
              {invoice.status === "failed" && canFix && !fixing && !fixingService ? (
                <Button type="button" variant="outline" disabled={pending} onClick={() => setFixing(true)}><MapPin aria-hidden /> Corrigir endereço</Button>
              ) : null}
              {canFix && invoice.status === "failed" && !fixing && !fixingService ? (
                <Button type="button" disabled={pending} onClick={() => run(() => retryInvoice({ clanId, id: invoice.id }), "Nota de volta à fila.")}>
                  {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <RotateCcw aria-hidden />} Tentar de novo
                </Button>
              ) : null}
              {invoice.status === "issued" ? (
                <>
                  {canFix ? <Button type="button" variant="outline" onClick={() => setCancelling(true)}><XCircle aria-hidden /> Cancelar a nota</Button> : null}
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
 * Uma nota padrão no mês. Valor e texto se ajustam clicando neles (só este
 * mês); o "Emitir" da linha emite só ela. Na tela, ela é mais uma nota prevista.
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
  onPause,
  blockedReason = null,
  autoOpen = false,
}: {
  clanId: string;
  period: { year: number; month: number };
  note: ClientNfseNoteView;
  canManage: boolean;
  emissible: boolean;
  selected: boolean;
  onToggle: () => void;
  onEmit: () => void;
  onPause: () => void;
  blockedReason?: string | null;
  /** "Resolver" da empresa: abre direto a nota com erro. */
  autoOpen?: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(note.amount);
  const [text, setText] = useState(note.description);
  const [invoiceOpen, setInvoiceOpen] = useState(autoOpen);
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
            <span className="font-medium">{note.takerName}</span> <span className="text-xs text-muted-foreground">· vale só para este mês</span>
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
                className={cn("touch-target inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs tabular-nums transition-colors hover:brightness-125", STATUS_CLASSES[invoice.status])}
                aria-label={`Nota de ${note.takerName}: ${STATUS_LABELS[invoice.status]}. Abrir detalhes.`}
              >
                {working ? <LoaderCircle className="size-3 animate-spin" aria-hidden /> : null}
                {invoice.status === "failed" ? <AlertTriangle className="size-3 text-destructive" aria-hidden /> : null}
                {invoice.status === "issued" && invoice.nfseNumber ? `Emitida · Nº ${invoice.nfseNumber}` : invoice.status === "failed" ? "Ver erro e resolver" : STATUS_LABELS[invoice.status]}
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
            {editable ? <Button type="button" size="sm" variant="ghost" onClick={startEditing}><Pencil aria-hidden /> Ajustar</Button> : null}
            {invoice?.status === "issued" ? <Button asChild size="sm" variant="outline"><a href={clientNfsePdfHref(clanId, period.year, period.month, { invoiceId: invoice.id })}><Download aria-hidden /> PDF</a></Button> : null}
            {canManage ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="icon-sm" className="touch-target" aria-label={`Mais ações da nota de ${note.takerName}`}>
                    <MoreHorizontal aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {editable ? <DropdownMenuItem onSelect={startEditing}><Pencil aria-hidden /> Ajustar só este mês</DropdownMenuItem> : null}
                  {open && note.model.active ? <DropdownMenuItem onSelect={onPause}><CircleSlash aria-hidden /> Parar de prever</DropdownMenuItem> : null}
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
      {invoice && invoice.status !== "cancelled" && invoiceOpen ? (
        <ClientNfseInvoiceDialog
          clanId={clanId}
          period={period}
          takerName={note.takerName}
          takerAddress={note.takerAddress}
          amount={note.amount}
          invoice={invoice}
          open={invoiceOpen}
          onOpenChange={setInvoiceOpen}
          startCancelling={cancelFirst}
          canManage={canManage}
          blockedReason={blockedReason}
        />
      ) : null}
    </li>
  );
}
