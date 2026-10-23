"use client";

import {
  AlertTriangle,
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  LoaderCircle,
  Pencil,
  RotateCcw,
  Send,
  Trash2,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

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
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatCnpj } from "@/domain/cnpj";
import { CLIENT_NFSE_EXCLUSION_LABELS, type ClientNfseBatch } from "@/domain/client-nfse";
import {
  NFSE_CANCEL_REASON_CODES,
  NFSE_CANCEL_REASON_LABELS,
  NFSE_CANCEL_TEXT_MAX,
  NFSE_CANCEL_TEXT_MIN,
  type NfseCancelReasonCode,
  type NfseInvoiceStatus,
} from "@/domain/nfse";
import type { ClientNfseMonthIssuerView, ClientNfseMonthItemView } from "@/lib/client-nfse/loaders";
import { formatBRLCurrency } from "@/lib/currency";
import { formatAppDate } from "@/lib/date-time";
import { cn } from "@/lib/utils";

import { cancelInvoice, emitBatch, openMonth, previewEmission, removeItem, retryInvoice, updateItem } from "./client-nfse-actions";

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

function cents(value: number): string {
  return formatBRLCurrency((value / 100).toFixed(2));
}

function adjacentPeriod(year: number, month: number, delta: number) {
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

function monthHref(clanId: string, year: number, month: number): string {
  return `/clans/${clanId}?tab=client-notes&fiscalYear=${year}&fiscalMonth=${month}`;
}

export function clientNfsePdfHref(clanId: string, year: number, month: number, scope: { issuerId?: string; invoiceId?: string } = {}): string {
  const extra = scope.invoiceId ? `&invoiceId=${scope.invoiceId}` : scope.issuerId ? `&issuerId=${scope.issuerId}` : "";
  return `/api/nfse/clientes/pdf?clanId=${clanId}&year=${year}&month=${month}${extra}`;
}

/** A nota já pedida segura o item: sem ela (ou cancelada), o item ainda se ajusta e entra no lote. */
function itemIsOpen(item: ClientNfseMonthItemView): boolean {
  return !item.invoice || item.invoice.status === "cancelled";
}

function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function run(action: () => Promise<{ ok: boolean; error?: string }>, success: string, after?: () => void) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error ?? "Não deu certo.");
        return;
      }
      toast.success(success);
      after?.();
      router.refresh();
    });
  }
  return { pending, run };
}

/** Valor e descrição deste mês; a nota padrão não muda. */
function ItemEditDialog({ clanId, item, open, onOpenChange }: { clanId: string; item: ClientNfseMonthItemView; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { pending, run } = useRun();
  const [amount, setAmount] = useState(item.amount);
  const [text, setText] = useState(item.description);
  return (
    <Dialog open={open} onOpenChange={(next) => { if (next) { setAmount(item.amount); setText(item.description); } onOpenChange(next); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nota deste mês · {item.takerName}</DialogTitle>
          <DialogDescription>Muda só esta nota do mês. A nota padrão continua igual para os próximos meses.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor={`item-amount-${item.itemId}`}>Valor</Label>
            <CurrencyInput id={`item-amount-${item.itemId}`} value={amount} onValueChange={setAmount} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`item-text-${item.itemId}`}>Descrição</Label>
            <Textarea id={`item-text-${item.itemId}`} rows={4} maxLength={2000} value={text} onChange={(event) => setText(event.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Voltar</Button>
          <Button
            type="button"
            disabled={pending || !amount || !text.trim()}
            onClick={() => run(() => updateItem({ clanId, itemId: item.itemId, amount, description: text }), "Nota do mês ajustada.", () => onOpenChange(false))}
          >
            {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : null} Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A situação da nota na própria linha; detalhes, PDF, cancelar e tentar de novo ao abrir. */
function InvoiceCell({ clanId, year, month, item, canManage }: { clanId: string; year: number; month: number; item: ClientNfseMonthItemView; canManage: boolean }) {
  const invoice = item.invoice!;
  const [open, setOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState<NfseCancelReasonCode>(1);
  const [text, setText] = useState("");
  const { pending, run } = useRun();
  const working = invoice.status === "queued" || invoice.status === "cancel_requested";
  const label = invoice.status === "issued" && invoice.nfseNumber ? `Nº ${invoice.nfseNumber}` : STATUS_LABELS[invoice.status];
  const length = text.trim().length;
  const close = () => { setOpen(false); setCancelling(false); };
  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setCancelling(false); }}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn("inline-flex min-h-8 items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-xs tabular-nums transition-colors hover:brightness-125", STATUS_CLASSES[invoice.status])}
        aria-label={`Nota de ${item.takerName}: ${STATUS_LABELS[invoice.status]}. Abrir detalhes.`}
      >
        {working ? <LoaderCircle className="size-3 animate-spin" aria-hidden /> : null}
        {label}
      </button>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nota para {item.takerName}</DialogTitle>
          <DialogDescription>
            {STATUS_LABELS[invoice.status]} · {formatBRLCurrency(item.amount)}
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
                onClick={() => run(() => cancelInvoice({ clanId, invoiceId: invoice.id, reasonCode: reason, reasonText: text }), "Cancelamento pedido. O Sistema Nacional responde em instantes.", close)}
              >
                {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <XCircle aria-hidden />} Cancelar a nota
              </Button>
            </>
          ) : (
            <>
              {canManage && invoice.status === "failed" ? (
                <Button type="button" disabled={pending} onClick={() => run(() => retryInvoice({ clanId, id: invoice.id }), "Nota de volta à fila.", close)}>
                  {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <RotateCcw aria-hidden />} Tentar de novo
                </Button>
              ) : null}
              {canManage && invoice.status === "issued" ? (
                <>
                  <Button type="button" variant="outline" onClick={() => setCancelling(true)}><XCircle aria-hidden /> Cancelar a nota</Button>
                  <Button asChild><a href={clientNfsePdfHref(clanId, year, month, { invoiceId: invoice.id })}><Download aria-hidden /> Baixar PDF</a></Button>
                </>
              ) : null}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ItemRow({ clanId, year, month, item, canManage }: { clanId: string; year: number; month: number; item: ClientNfseMonthItemView; canManage: boolean }) {
  const [editing, setEditing] = useState(false);
  const { pending, run } = useRun();
  const open = itemIsOpen(item);
  return (
    <li className="grid min-w-0 gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="grid min-w-0 gap-0.5 text-sm">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate font-medium">{item.takerName}</span>
          <span className="shrink-0 font-mono text-xs text-muted-foreground">{formatCnpj(item.takerDocument)}</span>
        </span>
        <span className="line-clamp-2 text-xs text-muted-foreground">{item.description}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <span className="font-mono text-sm tabular-nums">{formatBRLCurrency(item.amount)}</span>
        {item.invoice ? <InvoiceCell clanId={clanId} year={year} month={month} item={item} canManage={canManage} /> : <span className="text-xs text-muted-foreground">a emitir</span>}
        {canManage && open ? (
          <>
            <Button type="button" variant="ghost" size="icon-sm" className="touch-target" aria-label={`Ajustar a nota de ${item.takerName} neste mês`} onClick={() => setEditing(true)}>
              <Pencil aria-hidden />
            </Button>
            {!item.invoice ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="touch-target text-destructive"
                disabled={pending}
                aria-label={`Tirar a nota de ${item.takerName} deste mês`}
                onClick={() => {
                  if (!window.confirm(`Tirar a nota de ${item.takerName} deste mês? A nota padrão continua; abrir o mês de novo a recoloca.`)) return;
                  run(() => removeItem({ clanId, id: item.itemId }), "Nota tirada deste mês.");
                }}
              >
                <Trash2 aria-hidden />
              </Button>
            ) : null}
            <ItemEditDialog clanId={clanId} item={item} open={editing} onOpenChange={setEditing} />
          </>
        ) : null}
      </div>
    </li>
  );
}

/** Prévia agrupada por empresa: marca, confere o total e emite. */
function EmitDialog({ clanId, year, month, monthLabel, disabledReason }: { clanId: string; year: number; month: number; monthLabel: string; disabledReason: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<ClientNfseBatch | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [loading, startLoading] = useTransition();
  const [sending, startSending] = useTransition();

  function load() {
    startLoading(async () => {
      const result = await previewEmission({ clanId, year, month });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setPreview(result.data ?? null);
      setSelected(new Set((result.data?.items ?? []).map((item) => item.itemId)));
    });
  }

  function toggle(ids: readonly string[], on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  const groups = useMemo(() => {
    const map = new Map<string, { name: string; items: ClientNfseBatch["items"] }>();
    for (const item of preview?.items ?? []) {
      const group = map.get(item.issuerId) ?? { name: item.issuerName, items: [] };
      group.items.push(item);
      map.set(item.issuerId, group);
    }
    return [...map.entries()];
  }, [preview]);
  const chosen = preview?.items.filter((item) => selected.has(item.itemId)) ?? [];
  const chosenTotal = chosen.reduce((sum, item) => sum + item.amountCents, 0);

  function emit() {
    startSending(async () => {
      const result = await emitBatch({ clanId, year, month, selected: chosen.map((item) => item.itemId), expectedCount: chosen.length, expectedTotalCents: chosenTotal });
      if (!result.ok) {
        toast.error(result.error);
        load();
        return;
      }
      toast.success(`${result.data?.queued ?? chosen.length} notas na fila. Elas saem em instantes.`);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button type="button" disabled={disabledReason !== null} title={disabledReason ?? undefined} onClick={() => { setOpen(true); load(); }}>
        <Send aria-hidden /> Emitir notas
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Notas dos clientes · {monthLabel}</DialogTitle>
            <DialogDescription>Cada nota sai pelo CNPJ da empresa, com o certificado dela. Nota emitida só se desfaz com cancelamento formal.</DialogDescription>
          </DialogHeader>
          {loading && !preview ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" aria-hidden /> Montando a prévia…</p>
          ) : preview ? (
            <div className="grid min-w-0 gap-3">
              {groups.length === 0 ? (
                <p className="rounded-md border p-3 text-sm text-muted-foreground">Nenhuma nota a emitir: todas já saíram, estão na fila ou ficaram de fora pelos motivos abaixo.</p>
              ) : (
                groups.map(([issuerId, group]) => {
                  const ids = group.items.map((item) => item.itemId);
                  const all = ids.every((id) => selected.has(id));
                  return (
                    <section key={issuerId} className="grid gap-1 rounded-md border">
                      <label className="flex items-center gap-3 border-b bg-muted/30 px-3 py-2 text-sm font-medium">
                        <input type="checkbox" className="size-4 accent-primary" checked={all} disabled={sending} onChange={(event) => toggle(ids, event.target.checked)} />
                        <span className="min-w-0 flex-1 truncate">{group.name}</span>
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">{group.items.length} nota(s)</span>
                      </label>
                      <ul className="divide-y">
                        {group.items.map((item) => (
                          <li key={item.itemId}>
                            <label className={cn("flex cursor-pointer items-start gap-3 px-3 py-2 text-sm hover:bg-muted/30", !selected.has(item.itemId) && "text-muted-foreground")}>
                              <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-primary" checked={selected.has(item.itemId)} disabled={sending} onChange={(event) => toggle([item.itemId], event.target.checked)} />
                              <span className="grid min-w-0 flex-1">
                                <span className="truncate">{item.takerName}</span>
                                <span className="line-clamp-1 text-xs text-muted-foreground">{item.description}</span>
                              </span>
                              <span className="font-mono tabular-nums">{cents(item.amountCents)}</span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    </section>
                  );
                })
              )}
              {preview.excluded.length > 0 ? (
                <section className="grid gap-1">
                  <p className="hud-label">Ficam de fora ({preview.excluded.length})</p>
                  <ul className="grid gap-1 text-xs text-muted-foreground">
                    {preview.excluded.map((item) => (
                      <li key={item.itemId}>
                        {item.issuerName} → {item.takerName} — {CLIENT_NFSE_EXCLUSION_LABELS[item.reason]}
                        {item.detail ? `: ${item.detail}` : ""}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Voltar</Button>
            <Button type="button" disabled={!preview || chosen.length === 0 || loading || sending} onClick={emit}>
              {sending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Send aria-hidden />}
              Emitir {chosen.length} {chosen.length === 1 ? "nota" : "notas"} · <span className="font-mono tabular-nums">{cents(chosenTotal)}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * O mês das notas dos clientes como sequência: cadastro → abrir o mês →
 * emitir. O botão principal é sempre o próximo passo, como nos Honorários.
 */
export function ClientNfseMonth({
  clanId,
  year,
  month,
  canManage,
  activeModels,
  issuers,
  serviceReady,
}: {
  clanId: string;
  year: number;
  month: number;
  canManage: boolean;
  activeModels: number;
  issuers: readonly ClientNfseMonthIssuerView[];
  /** O serviço fiscal publicou a chave do cofre (sem ela, ninguém abre certificado). */
  serviceReady: boolean;
}) {
  const router = useRouter();
  const [opening, startOpening] = useTransition();
  const monthName = MONTHS[month - 1];
  const title = `${monthName.charAt(0).toUpperCase()}${monthName.slice(1)} de ${year}`;
  const previous = adjacentPeriod(year, month, -1);
  const next = adjacentPeriod(year, month, 1);
  const items = issuers.flatMap((issuer) => issuer.items);
  const issued = items.filter((item) => item.invoice?.status === "issued").length;
  const working = items.some((item) => item.invoice?.status === "queued" || item.invoice?.status === "cancel_requested");
  const toEmit = items.filter(itemIsOpen).length;

  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => router.refresh(), 5_000);
    return () => clearInterval(timer);
  }, [working, router]);

  const steps = [
    { key: "register", label: "Cadastro", detail: activeModels === 1 ? "1 nota padrão ativa" : `${activeModels} notas padrão ativas`, done: activeModels > 0 },
    { key: "open", label: `Abrir ${monthName}`, detail: items.length > 0 ? `${items.length} nota(s) no mês` : "ainda não aberto", done: items.length > 0 },
    { key: "emit", label: "Emitir", detail: `${issued} de ${items.length} emitidas`, done: items.length > 0 && issued === items.length },
  ];
  const current = steps.find((step) => !step.done)?.key ?? null;

  function open() {
    startOpening(async () => {
      const result = await openMonth({ clanId, year, month });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const created = result.data?.created ?? 0;
      toast.success(created > 0 ? `${created} nota(s) adicionada(s) a ${monthName}.` : `Nada novo: ${monthName} já tem todas as notas padrão ativas.`);
      router.refresh();
    });
  }

  const emitBlocked = !canManage
    ? "Só integrantes do Fiscal e admins emitem notas."
    : !serviceReady
      ? "O serviço fiscal ainda não está pronto para abrir os certificados."
      : toEmit === 0
        ? "Nada a emitir neste mês."
        : null;

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button asChild variant="outline" size="icon-sm">
            <Link href={monthHref(clanId, previous.year, previous.month)} aria-label="Mês anterior"><ChevronLeft aria-hidden /></Link>
          </Button>
          <h2 className="px-2">{title}</h2>
          <Button asChild variant="outline" size="icon-sm">
            <Link href={monthHref(clanId, next.year, next.month)} aria-label="Próximo mês"><ChevronRight aria-hidden /></Link>
          </Button>
        </div>
        {issued > 0 ? (
          <Button asChild variant="outline" size="sm">
            <a href={clientNfsePdfHref(clanId, year, month)}><Download aria-hidden /> PDFs do mês ({issued})</a>
          </Button>
        ) : null}
      </div>

      <ol className="grid grid-cols-1 gap-2 sm:grid-cols-3" aria-label="Passos do mês">
        {steps.map((step, index) => {
          const isCurrent = step.key === current;
          return (
            <li
              key={step.key}
              aria-current={isCurrent ? "step" : undefined}
              className={cn(
                "grid gap-0.5 rounded-md border p-3 text-sm",
                step.done && "border-success/40 bg-success/10 text-success",
                isCurrent && "border-primary text-primary ring-1 ring-primary",
                !step.done && !isCurrent && "text-muted-foreground",
              )}
            >
              <span className="flex items-center gap-1.5 font-medium">
                {step.done ? <Check className="size-3.5" aria-hidden /> : <span className="font-mono text-xs">{index + 1}.</span>}
                {step.label}
              </span>
              <span className="font-mono text-xs tabular-nums">{step.detail}</span>
            </li>
          );
        })}
      </ol>

      {canManage ? (
        <div className="flex flex-wrap items-center gap-2" aria-busy={opening}>
          {current === "register" ? (
            <Button asChild><Link href={`/clans/${clanId}?tab=client-notes&nfseView=base`}>Ir ao cadastro</Link></Button>
          ) : (
            <Button type="button" variant={current === "open" ? "default" : "outline"} disabled={opening || activeModels === 0} onClick={open}>
              {opening ? <LoaderCircle className="animate-spin" aria-hidden /> : <CalendarPlus aria-hidden />}
              {items.length > 0 ? "Trazer notas padrão novas" : `Abrir ${monthName}`}
            </Button>
          )}
          {items.length > 0 ? <EmitDialog clanId={clanId} year={year} month={month} monthLabel={title} disabledReason={emitBlocked} /> : null}
        </div>
      ) : null}

      {!serviceReady ? (
        <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning" role="status">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          O serviço fiscal ainda não publicou a chave do cofre. Sem ela, o certificado das empresas não abre e nenhuma nota sai.
        </p>
      ) : null}

      {items.length === 0 ? (
        <div className="grid justify-items-center gap-2 rounded-lg border border-dashed p-8 text-center text-sm">
          <p className="font-medium">{activeModels > 0 ? `${title} ainda não foi aberto.` : "Nenhuma nota padrão cadastrada."}</p>
          <p className="max-w-prose text-muted-foreground">
            {activeModels > 0
              ? "Abrir o mês cria uma nota para cada nota padrão ativa, com o valor e a descrição do padrão. Depois dá para ajustar uma a uma e emitir em lote."
              : "No Cadastro, adicione a empresa emissora, os tomadores dela e as notas que se repetem todo mês."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4" aria-live="polite">
          {issuers.map((issuer) => {
            const total = issuer.items.reduce((sum, item) => sum + Number(item.amount), 0);
            const issuerIssued = issuer.items.filter((item) => item.invoice?.status === "issued").length;
            return (
              <section key={issuer.issuerId} className="grid min-w-0 gap-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-1">
                  <h3 className="min-w-0 truncate">
                    {issuer.name} <span className="font-mono text-xs font-normal text-muted-foreground">{issuer.cnpj ? formatCnpj(issuer.cnpj) : ""}</span>
                  </h3>
                  <span className="flex items-center gap-2 font-mono text-xs tabular-nums text-muted-foreground">
                    {issuer.items.length} nota(s) · {formatBRLCurrency(total.toFixed(2))}
                    {issuerIssued > 1 ? (
                      <a className="text-primary underline-offset-4 hover:underline" href={clientNfsePdfHref(clanId, year, month, { issuerId: issuer.issuerId })}>PDFs</a>
                    ) : null}
                  </span>
                </div>
                {issuer.problem ? (
                  <p className="flex items-start gap-1.5 text-xs text-warning"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {issuer.problem}</p>
                ) : null}
                <ul className="grid min-w-0 divide-y">
                  {issuer.items.map((item) => (
                    <ItemRow key={item.itemId} clanId={clanId} year={year} month={month} item={item} canManage={canManage} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
