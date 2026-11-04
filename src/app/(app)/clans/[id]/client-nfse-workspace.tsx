"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  Repeat,
  RotateCcw,
  Search,
  Send,
  Settings2,
  Trash2,
  Users,
  X,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  batchOutcome,
  DESK_GROUP_ORDER,
  deskScore,
  issuerDesk,
  matchesDeskFilter,
  matchesDeskQuery,
  portalReadIsStale,
  type DeskFilter,
  type DeskGroup,
  type IssuerDesk,
} from "@/lib/client-nfse/presentation";
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
import { formatCnpj } from "@/domain/cnpj";
import type { NfseClientAddress } from "@/domain/nfse";
import type { ClientNfseForecastView } from "@/lib/client-nfse/forecast-month";
import type { ClientNfseCandidateView, ClientNfseFreeNoteView, ClientNfseIssuerView, ClientNfseNoteView } from "@/lib/client-nfse/loaders";
import { formatBRLCurrency } from "@/lib/currency";
import { formatAppDate } from "@/lib/date-time";
import { cn } from "@/lib/utils";

import { deleteIssuer, emitBatch, emitForecast, pauseModel, restoreForecast, skipForecast } from "./client-nfse-actions";
import { ClientNfseAddCompany } from "./client-nfse-add-company";
import { ClientNfseTakersDialog } from "./client-nfse-customers";
import { ClientNfseEmitDialog, type EmitPrefill } from "./client-nfse-emit-dialog";
import { ClientNfseIssuerDialog } from "./client-nfse-issuer-dialog";
import { ClientNfseInvoiceDialog, ClientNfseNoteRow, clientNfsePdfHref, noteIsOpen, STATUS_CLASSES, STATUS_LABELS } from "./client-nfse-note-row";

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"] as const;

type Period = { year: number; month: number };

/** Uma nota a emitir pela conferência: nota padrão em aberto ou prevista. */
type ToEmit =
  | { kind: "model"; key: string; issuerName: string; takerName: string; amount: string; description: string; note: ClientNfseNoteView }
  | { kind: "forecast"; key: string; issuerName: string; takerName: string; amount: string; description: string; issuerId: string; requestId: string; stale: boolean };

function adjacent(period: Period, delta: number): Period {
  const date = new Date(Date.UTC(period.year, period.month - 1 + delta, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

function monthHref(clanId: string, period: Period): string {
  return `/clans/${clanId}?tab=client-notes&fiscalYear=${period.year}&fiscalMonth=${period.month}`;
}

function cents(amount: string): number {
  return Math.round(Number(amount) * 100);
}

function money(totalCents: number): string {
  return formatBRLCurrency((totalCents / 100).toFixed(2));
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function forecastPrefill(note: ClientNfseForecastView, portalReadAt: string | null): EmitPrefill {
  return {
    document: note.takerDocument,
    name: note.takerName,
    address: note.address as EmitPrefill["address"],
    amount: note.amount,
    description: note.description,
    retentions: note.retentions,
    forecast: { sourceAccessKey: note.sourceAccessKey, service: note.service, textNeedsReview: note.textNeedsReview, portalReadAt },
  };
}

function forecastToEmit(issuer: ClientNfseIssuerView, note: ClientNfseForecastView): ToEmit {
  return {
    kind: "forecast",
    key: note.sourceAccessKey,
    issuerName: issuer.name,
    takerName: note.takerName,
    amount: note.amount,
    description: note.description,
    issuerId: issuer.id,
    requestId: crypto.randomUUID(),
    stale: portalReadIsStale(issuer.forecast.portalReadAt, new Date()),
  };
}

function modelToEmit(issuer: ClientNfseIssuerView, note: ClientNfseNoteView): ToEmit {
  return { kind: "model", key: note.modelId, issuerName: issuer.name, takerName: note.takerName, amount: note.amount, description: note.description, note };
}

/** Confirmação antes de pedir: nota emitida só se desfaz com cancelamento formal. */
function EmitConfirm({ clanId, period, items, onDone, onOpenChange }: { clanId: string; period: Period; items: ToEmit[] | null; onDone: (invoiceIds: string[]) => void; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [sending, startSending] = useTransition();
  const list = useMemo(() => items ?? [], [items]);
  const total = list.reduce((sum, item) => sum + cents(item.amount), 0);
  const single = list.length === 1 ? list[0] : null;
  const companies = useMemo(() => {
    const groups = new Map<string, ToEmit[]>();
    for (const item of list) groups.set(item.issuerName, [...(groups.get(item.issuerName) ?? []), item]);
    return [...groups.entries()];
  }, [list]);
  const stale = list.some((item) => item.kind === "forecast" && item.stale);

  function emit() {
    startSending(async () => {
      const models = list.filter((item) => item.kind === "model");
      const forecasts = list.flatMap((item) => (item.kind === "forecast" ? [item] : []));
      const invoiceIds: string[] = [];
      if (models.length > 0) {
        const result = await emitBatch({
          clanId,
          year: period.year,
          month: period.month,
          selected: models.map((item) => item.key),
          expectedCount: models.length,
          expectedTotalCents: models.reduce((sum, item) => sum + cents(item.amount), 0),
        });
        if (!result.ok) {
          toast.error(result.error);
          router.refresh();
          return;
        }
        invoiceIds.push(...(result.data?.invoiceIds ?? []));
      }
      if (forecasts.length > 0) {
        const result = await emitForecast({
          clanId,
          items: forecasts.map((item) => ({ issuerId: item.issuerId, sourceAccessKey: item.key, requestId: item.requestId })),
          expectedTotalCents: forecasts.reduce((sum, item) => sum + cents(item.amount), 0),
        });
        if (!result.ok) {
          toast.error(result.error);
          router.refresh();
          return;
        }
        invoiceIds.push(...(result.data?.invoiceIds ?? []));
        for (const failure of result.data?.failures ?? []) toast.error(`${failure.takerName}: ${failure.error}`);
      }
      if (invoiceIds.length > 0) toast.success(invoiceIds.length === 1 ? "Nota na fila. Ela sai em instantes." : `${invoiceIds.length} notas na fila. Elas saem em instantes.`);
      onDone(invoiceIds);
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={items !== null} onOpenChange={(open) => { if (!sending) onOpenChange(open); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{single ? `Emitir a nota de ${single.takerName}?` : `Emitir ${list.length} notas de ${plural(companies.length, "empresa", "empresas")}?`}</DialogTitle>
          <DialogDescription>Cada nota sai pelo CNPJ da empresa, com o certificado dela. Emitida, só se desfaz com cancelamento formal.</DialogDescription>
        </DialogHeader>
        {single ? (
          <div className="grid gap-1 rounded-md border bg-muted/30 p-3 text-sm">
            <span className="hud-label">{single.issuerName}</span>
            <span>{single.description}</span>
            <span className="font-mono tabular-nums">{formatBRLCurrency(single.amount)}</span>
          </div>
        ) : (
          <div className="grid max-h-[50dvh] gap-3 overflow-auto">
            {companies.map(([name, notes]) => (
              <section key={name} className="rounded-md border text-sm" aria-label={name}>
                <p className="flex items-baseline justify-between gap-3 border-b bg-muted/30 px-3 py-1.5">
                  <span className="truncate font-medium">{name}</span>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{money(notes.reduce((sum, item) => sum + cents(item.amount), 0))}</span>
                </p>
                <ul className="divide-y">
                  {notes.map((item) => (
                    <li key={item.key} className="flex items-start justify-between gap-3 px-3 py-2">
                      <span className="grid min-w-0 gap-0.5">
                        <span className="truncate">{item.takerName}</span>
                        <span className="text-xs text-muted-foreground">{item.description}</span>
                      </span>
                      <span className="shrink-0 font-mono tabular-nums">{formatBRLCurrency(item.amount)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
        {list.some((item) => item.kind === "forecast") ? <p className="text-xs text-muted-foreground">Os valores são os do mês passado. Confira se algum mudou.</p> : null}
        {stale ? (
          <p role="status" className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            As notas do Portal não são lidas há mais de um dia. Se alguma destas já foi feita lá, ainda não aparece aqui.
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={sending} onClick={() => onOpenChange(false)}>Voltar</Button>
          <Button type="button" disabled={sending || list.length === 0} onClick={emit}>
            {sending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Send aria-hidden />}
            Emitir {list.length === 1 ? "a nota" : `${list.length} notas`} · <span className="font-mono tabular-nums">{money(total)}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Uma nota pedida no mês, fora da nota padrão: quem, o quê, quanto, a situação e "Nova igual". */
function FreeNoteRow({
  clanId,
  period,
  note,
  takerAddress,
  canManage,
  canEmit,
  blockedReason,
  autoOpen,
  onRepeat,
}: {
  clanId: string;
  period: Period;
  note: ClientNfseFreeNoteView;
  takerAddress: NfseClientAddress | null;
  canManage: boolean;
  canEmit: boolean;
  blockedReason: string | null;
  autoOpen: boolean;
  onRepeat: () => void;
}) {
  const [open, setOpen] = useState(autoOpen);
  const [cancelFirst, setCancelFirst] = useState(false);
  const { invoice } = note;
  const working = invoice.status === "queued" || invoice.status === "cancel_requested";
  const show = (cancel: boolean) => {
    setCancelFirst(cancel);
    setOpen(true);
  };
  return (
    <li className="grid min-w-0 gap-x-3 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="grid min-w-0 gap-0.5 text-sm">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="font-mono text-xs text-muted-foreground tabular-nums">{formatAppDate(note.requestedAt)}</span>
          <span className={cn("truncate font-medium", invoice.status === "cancelled" && "line-through opacity-60")}>{note.takerName}</span>
          <span className="font-mono text-xs text-muted-foreground">{formatCnpj(note.takerDocument)}</span>
        </span>
        <span className="line-clamp-2 text-xs text-muted-foreground">{note.description}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <span className="font-mono text-sm tabular-nums">{formatBRLCurrency(note.amount)}</span>
        <button
          type="button"
          onClick={() => show(false)}
          className={cn("touch-target inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs tabular-nums transition-colors hover:brightness-125", STATUS_CLASSES[invoice.status])}
          aria-label={`Nota de ${note.takerName}: ${STATUS_LABELS[invoice.status]}. Abrir detalhes.`}
        >
          {working ? <LoaderCircle className="size-3 animate-spin" aria-hidden /> : null}
          {invoice.status === "failed" ? <AlertTriangle className="size-3 text-destructive" aria-hidden /> : null}
          {invoice.status === "issued" && invoice.nfseNumber ? `Emitida · Nº ${invoice.nfseNumber}` : invoice.status === "failed" ? "Ver erro e resolver" : STATUS_LABELS[invoice.status]}
        </button>
        {invoice.status === "issued" ? (
          <Button asChild size="sm" variant="outline" className="touch-target" aria-label={`Baixar o PDF da nota de ${note.takerName}`}>
            <a href={clientNfsePdfHref(clanId, period.year, period.month, { invoiceId: invoice.id })}><Download aria-hidden /> PDF</a>
          </Button>
        ) : null}
        {canEmit && (invoice.status === "issued" || invoice.status === "cancelled") ? (
          <Button type="button" size="sm" variant="outline" onClick={onRepeat}>
            <Repeat aria-hidden /> Nova igual
          </Button>
        ) : null}
        {canEmit && invoice.status === "issued" ? (
          <Button type="button" size="icon-sm" variant="ghost" className="touch-target" aria-label={`Cancelar a nota de ${note.takerName}`} onClick={() => show(true)}>
            <XCircle aria-hidden />
          </Button>
        ) : null}
      </div>
      {open ? <ClientNfseInvoiceDialog
        clanId={clanId}
        period={period}
        takerName={note.takerName}
        takerAddress={takerAddress}
        amount={note.amount}
        invoice={invoice}
        open={open}
        onOpenChange={setOpen}
        startCancelling={cancelFirst}
        canManage={canManage}
        blockedReason={blockedReason}
      /> : null}
    </li>
  );
}

/** Uma nota prevista: o que saiu no mês passado, com um clique para conferir e emitir. */
function ForecastRow({
  clanId,
  issuerId,
  note,
  canEmit,
  canManage,
  selected,
  onToggle,
  onEmit,
}: {
  clanId: string;
  issuerId: string;
  note: ClientNfseForecastView;
  canEmit: boolean;
  canManage: boolean;
  selected: boolean;
  onToggle: () => void;
  onEmit: () => void;
}) {
  const router = useRouter();
  const [skipping, startSkipping] = useTransition();

  function skip() {
    startSkipping(async () => {
      const result = await skipForecast({ clanId, issuerId, sourceAccessKey: note.sourceAccessKey });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <li className={cn("grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center", selected && "bg-primary/5")}>
      <input
        type="checkbox"
        className="size-4 accent-primary disabled:opacity-30"
        checked={selected}
        disabled={!canEmit || note.textNeedsReview}
        onChange={onToggle}
        aria-label={`Escolher a nota prevista de ${note.takerName}`}
        title={note.textNeedsReview ? "Confira o texto antes: emita pelo botão da linha." : undefined}
      />
      <div className="grid min-w-0 gap-0.5 text-sm">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="truncate font-medium">{note.takerName}</span>
          <span className="font-mono text-xs text-muted-foreground">{formatCnpj(note.takerDocument)}</span>
        </span>
        <span className="line-clamp-2 text-xs text-muted-foreground">{note.description}</span>
        {note.textNeedsReview ? (
          <span className="flex items-center gap-1 text-xs text-warning"><AlertTriangle className="size-3 shrink-0" aria-hidden /> O texto cita uma data que não deu para trocar. Confira ao emitir.</span>
        ) : null}
      </div>
      <div className="col-start-2 flex flex-wrap items-center gap-2 sm:col-start-3 sm:justify-end">
        <span className="grid text-right">
          <span className="font-mono text-sm tabular-nums">{formatBRLCurrency(note.amount)}</span>
          <span className="text-xs text-muted-foreground">mês passado</span>
        </span>
        {canEmit ? (
          <Button type="button" size="sm" variant="outline" aria-label={`Emitir a nota prevista de ${note.takerName}`} onClick={onEmit}>
            <Send aria-hidden /> Emitir
          </Button>
        ) : null}
        {canManage ? (
          <Button type="button" size="sm" variant="ghost" disabled={skipping} onClick={skip} aria-label={`Não emitir a nota de ${note.takerName} este mês`}>
            {skipping ? <LoaderCircle className="animate-spin" aria-hidden /> : null} Não emitir
          </Button>
        ) : null}
      </div>
    </li>
  );
}

/** "Não emitir este mês": uma linha discreta, com o desfazer à mão. */
function SkippedRow({ clanId, issuerId, note, canManage }: { clanId: string; issuerId: string; note: ClientNfseForecastView; canManage: boolean }) {
  const router = useRouter();
  const [restoring, startRestoring] = useTransition();
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs text-muted-foreground">
      <span className="min-w-0">Não emitir este mês: {note.takerName} · <span className="font-mono tabular-nums">{formatBRLCurrency(note.amount)}</span></span>
      {canManage ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={restoring}
          aria-label={`Desfazer: voltar a prever a nota de ${note.takerName}`}
          onClick={() =>
            startRestoring(async () => {
              const result = await restoreForecast({ clanId, issuerId, sourceAccessKey: note.sourceAccessKey });
              if (!result.ok) toast.error(result.error);
              else router.refresh();
            })
          }
        >
          <RotateCcw aria-hidden /> Desfazer
        </Button>
      ) : null}
    </li>
  );
}

const GROUP_RAIL: Record<DeskGroup, string> = {
  resolve: "border-l-destructive",
  forecast: "border-l-primary",
  working: "border-l-warning",
  issued: "border-l-success",
  quiet: "border-l-transparent",
};

function summaryOf(issuer: ClientNfseIssuerView, desk: IssuerDesk, isCurrent: boolean) {
  const parts: { text: string; tone?: "error" | "warning" | "success" }[] = [];
  if (desk.failed > 0) parts.push({ text: plural(desk.failed, "erro", "erros"), tone: "error" });
  if (!issuer.active) parts.push({ text: "Empresa desativada" });
  else if (issuer.problem) parts.push({ text: issuer.problem, tone: "warning" });
  if (desk.forecast > 0) parts.push({ text: `${plural(desk.forecast, "prevista", "previstas")} · ${money(desk.forecastCents)}` });
  if (desk.working > 0) parts.push({ text: `${desk.working} em andamento`, tone: "warning" });
  if (desk.issued > 0) parts.push({ text: `${plural(desk.issued, "emitida", "emitidas")} · ${money(desk.issuedCents)}`, tone: "success" });
  if (parts.length === 0) parts.push({ text: isCurrent ? "Sem previsão" : "Sem nota no mês" });
  return parts;
}

const TONE: Record<"error" | "warning" | "success", string> = { error: "font-medium", warning: "text-warning", success: "text-success" };

/** Uma empresa na Mesa: uma linha com o próximo passo, e as notas abrem ali mesmo. */
function DeskRow({
  clanId,
  period,
  issuer,
  desk,
  isCurrent,
  canManage,
  serviceReady,
  expanded,
  onExpand,
  selected,
  onToggle,
  onEmit,
}: {
  clanId: string;
  period: Period;
  issuer: ClientNfseIssuerView;
  desk: IssuerDesk;
  isCurrent: boolean;
  canManage: boolean;
  serviceReady: boolean;
  expanded: boolean;
  onExpand: (open: boolean) => void;
  selected: ReadonlySet<string>;
  onToggle: (ids: readonly string[], on: boolean) => void;
  onEmit: (items: ToEmit[]) => void;
}) {
  const router = useRouter();
  const [fiscalOpen, setFiscalOpen] = useState(false);
  const [takersOpen, setTakersOpen] = useState(false);
  // O formulário de emissão: vazio ("Nova nota") ou preenchido (prevista, Nova igual, cliente das notas do Portal).
  const [emitting, setEmitting] = useState<{ key: string; prefill: EmitPrefill | null } | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);
  const [removing, startRemoving] = useTransition();
  const canEmit = canManage && serviceReady && issuer.active && !issuer.problem;
  const canCreate = canEmit && isCurrent;
  const blockedReason = !serviceReady ? "O serviço fiscal está indisponível." : !issuer.active ? "A empresa está desativada." : issuer.problem;
  const emissible = (note: ClientNfseNoteView) => canCreate && !note.blocked && noteIsOpen(note);
  const openFixed = issuer.notes.filter(noteIsOpen);
  const pickable = [...issuer.forecast.notes.filter((note) => !note.textNeedsReview).map((note) => note.sourceAccessKey), ...openFixed.filter(emissible).map((note) => note.modelId)];
  const allChosen = pickable.length > 0 && pickable.every((id) => selected.has(id));
  const failedIds = [...issuer.notes, ...issuer.freeNotes].flatMap((note) => (note.invoice?.status === "failed" ? [note.invoice.id] : []));
  const singleForecast = desk.forecast === 1 ? issuer.forecast.notes[0] : undefined;
  const singleFixed = desk.forecast === 1 ? openFixed.find(emissible) : undefined;
  const bodyId = `desk-${issuer.id}`;

  function remove() {
    if (!window.confirm(`Tirar ${issuer.name} das Notas dos clientes? Com nota já pedida, desative nos dados fiscais.`)) return;
    startRemoving(async () => {
      const result = await deleteIssuer({ clanId, id: issuer.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Empresa tirada das Notas dos clientes.");
      router.refresh();
    });
  }

  function emitFrom(prefill: EmitPrefill | null) {
    setTakersOpen(false);
    setEmitting({ key: crypto.randomUUID(), prefill });
  }

  function resolve() {
    setResolving(failedIds.length === 1 ? failedIds[0] : null);
    onExpand(true);
  }

  return (
    <li className={cn("min-w-0 border-l-2", GROUP_RAIL[desk.group], !issuer.active && "opacity-70")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5">
        {canCreate && pickable.length > 0 ? (
          <label className="touch-target flex items-center">
            <input
              type="checkbox"
              className="relative z-10 size-4 accent-primary"
              checked={allChosen}
              onChange={(event) => onToggle(pickable, event.target.checked)}
              aria-label={`Escolher as notas previstas de ${issuer.name}`}
            />
          </label>
        ) : null}
        <button
          type="button"
          className="flex min-h-11 min-w-[14rem] flex-1 items-center gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => onExpand(!expanded)}
        >
          <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-90")} aria-hidden />
          <span className="grid min-w-0 gap-0.5">
            <span className="truncate text-sm font-medium">{issuer.name}</span>
            <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              {summaryOf(issuer, desk, isCurrent).map((part) => (
                <span key={part.text} className={cn("inline-flex items-center gap-1", part.tone && TONE[part.tone])}>
                  {part.tone === "error" ? <AlertTriangle className="size-3 text-destructive" aria-hidden /> : null}
                  {part.text}
                </span>
              ))}
            </span>
          </span>
        </button>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {desk.failed > 0 ? (
            <Button type="button" size="sm" onClick={resolve} aria-label={`Resolver o erro de ${issuer.name}`}>Resolver</Button>
          ) : desk.blocked ? (
            <Button type="button" size="sm" variant="outline" onClick={() => onExpand(true)} aria-label={`Ver o problema de ${issuer.name}`}>Ver</Button>
          ) : singleForecast && canCreate ? (
            <Button type="button" size="sm" onClick={() => emitFrom(forecastPrefill(singleForecast, issuer.forecast.portalReadAt))} aria-label={`Emitir a nota prevista de ${issuer.name}`}><Send aria-hidden /> Emitir</Button>
          ) : singleFixed ? (
            <Button type="button" size="sm" onClick={() => onEmit([modelToEmit(issuer, singleFixed)])} aria-label={`Emitir a nota prevista de ${issuer.name}`}><Send aria-hidden /> Emitir</Button>
          ) : desk.forecast > 1 && !expanded && canCreate ? (
            <Button type="button" size="sm" onClick={() => onExpand(true)} aria-label={`Conferir as notas previstas de ${issuer.name}`}>Conferir {desk.forecast}</Button>
          ) : null}
          {desk.issued > 1 ? (
            <Button asChild size="sm" variant="ghost" aria-label={`Baixar os PDFs de ${issuer.name}`}>
              <a href={clientNfsePdfHref(clanId, period.year, period.month, { issuerId: issuer.id })}><Download aria-hidden /> PDFs</a>
            </Button>
          ) : null}
          {canCreate ? (
            <Button type="button" size="sm" variant="outline" onClick={() => emitFrom(null)} aria-label={`Nova nota de ${issuer.name}`}>
              <Plus aria-hidden /> Nova nota
            </Button>
          ) : null}
          {canManage ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon-sm" className="touch-target" aria-label={`Mais ações de ${issuer.name}`}>
                  <MoreHorizontal aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setTakersOpen(true)}><Users aria-hidden /> Clientes ({issuer.takers.length})</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setFiscalOpen(true)}><Settings2 aria-hidden /> Dados fiscais</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={removing} onSelect={remove} className="text-destructive focus:text-destructive"><Trash2 aria-hidden /> Tirar empresa</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>

      {expanded ? (
        <div id={bodyId} className="border-t border-border/60 bg-muted/20">
          <p className="px-4 pt-2 font-mono text-xs text-muted-foreground">{issuer.cnpj ? formatCnpj(issuer.cnpj) : "sem CNPJ"}</p>
          {blockedReason && canManage ? (
            <p role="status" className="mx-4 mt-2 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              <span>{blockedReason} Enquanto isso, esta empresa não emite.</span>
            </p>
          ) : null}
          {[...issuer.freeNotes, ...issuer.notes].length === 0 && issuer.forecast.notes.length === 0 && issuer.forecast.skipped.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">
              {isCurrent ? `Nenhuma nota em ${MONTHS[period.month - 1]}, e nada saiu no mês passado para prever. Quando o cliente pedir, use Nova nota.` : `Nenhuma nota em ${MONTHS[period.month - 1]}.`}
            </p>
          ) : (
            <ul className="grid min-w-0 divide-y divide-border/60" aria-label={`Notas de ${issuer.name} em ${MONTHS[period.month - 1]}`}>
              {issuer.freeNotes.filter((note) => note.invoice.status === "failed").map((note) => (
                <FreeNoteRow
                  key={note.invoice.id}
                  clanId={clanId}
                  period={period}
                  note={note}
                  takerAddress={issuer.takers.find((row) => row.id === note.takerId)?.address ?? null}
                  canManage={canManage}
                  canEmit={canCreate}
                  blockedReason={blockedReason}
                  autoOpen={resolving === note.invoice.id}
                  onRepeat={() => {}}
                />
              ))}
              {issuer.forecast.notes.map((note) => (
                <ForecastRow
                  key={note.sourceAccessKey}
                  clanId={clanId}
                  issuerId={issuer.id}
                  note={note}
                  canEmit={canCreate}
                  canManage={canManage && isCurrent}
                  selected={selected.has(note.sourceAccessKey)}
                  onToggle={() => onToggle([note.sourceAccessKey], !selected.has(note.sourceAccessKey))}
                  onEmit={() => emitFrom(forecastPrefill(note, issuer.forecast.portalReadAt))}
                />
              ))}
              {issuer.notes.map((note) => (
                <ClientNfseNoteRow
                  key={note.modelId}
                  clanId={clanId}
                  period={period}
                  note={note}
                  canManage={canManage}
                  emissible={emissible(note)}
                  selected={selected.has(note.modelId)}
                  autoOpen={note.invoice ? resolving === note.invoice.id : false}
                  onToggle={() => onToggle([note.modelId], !selected.has(note.modelId))}
                  onEmit={() => onEmit([modelToEmit(issuer, note)])}
                  onPause={() => {
                    void pauseModel({ clanId, id: note.modelId }).then((result) => {
                      if (!result.ok) toast.error(result.error);
                      else router.refresh();
                    });
                  }}
                  blockedReason={blockedReason}
                />
              ))}
              {issuer.freeNotes.filter((note) => note.invoice.status !== "failed").map((note) => (
                <FreeNoteRow
                  key={note.invoice.id}
                  clanId={clanId}
                  period={period}
                  note={note}
                  takerAddress={issuer.takers.find((row) => row.id === note.takerId)?.address ?? null}
                  canManage={canManage}
                  canEmit={canCreate}
                  blockedReason={blockedReason}
                  autoOpen={false}
                  onRepeat={() => {
                    const taker = issuer.takers.find((row) => row.id === note.takerId);
                    emitFrom({ document: note.takerDocument, name: note.takerName, address: taker?.address ?? null, amount: note.amount, description: note.description, retentions: taker?.retentions ?? null });
                  }}
                />
              ))}
              {issuer.forecast.skipped.map((note) => <SkippedRow key={note.sourceAccessKey} clanId={clanId} issuerId={issuer.id} note={note} canManage={canManage && isCurrent} />)}
            </ul>
          )}
        </div>
      ) : null}

      {canManage ? (
        <>
          {/* Os formulários nascem a cada abertura, já com o que está gravado: um
              formulário reaproveitado abria com dados velhos (a série que a fila
              trocou sozinha voltaria ao salvar). */}
          {emitting ? (
            <ClientNfseEmitDialog key={emitting.key} clanId={clanId} issuer={issuer} prefill={emitting.prefill} onOpenChange={(open) => { if (!open) setEmitting(null); }} />
          ) : null}
          {takersOpen ? <ClientNfseTakersDialog clanId={clanId} issuer={issuer} onOpenChange={setTakersOpen} onEmit={emitFrom} /> : null}
          {fiscalOpen ? <ClientNfseIssuerDialog clanId={clanId} issuer={issuer} open onOpenChange={setFiscalOpen} /> : null}
        </>
      ) : null}
    </li>
  );
}

const GROUP_LABEL: Record<DeskGroup, string> = {
  resolve: "A resolver",
  forecast: "Previstas",
  working: "Em andamento",
  issued: "Emitidas",
  quiet: "Sem previsão",
};

/** Só o que pede ação abre sozinho: com mais de 100 empresas, o resto ocuparia a tela. */
const GROUP_STARTS_OPEN: Record<DeskGroup, boolean> = { resolve: true, forecast: true, working: true, issued: false, quiet: false };

function Plate({
  label,
  detail,
  count,
  active,
  icon,
  hint,
  onClick,
}: {
  label: string;
  detail: string;
  count: number;
  active: boolean;
  icon?: React.ReactNode;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={hint}
      onClick={onClick}
      className={cn(
        "panel-cut panel-cut-sm grid min-w-0 gap-0.5 border-b-2 px-3 py-2.5 text-left transition-colors hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        active ? "border-b-primary bg-primary/10" : "border-b-transparent",
      )}
    >
      <span className="hud-label">{label}</span>
      <span className="flex items-center gap-1.5 font-mono text-2xl tabular-nums">{icon}{count}</span>
      <span className="truncate text-xs text-muted-foreground">{detail}</span>
    </button>
  );
}

/**
 * Mesa do mês (2026-11-04): o painel de emissão do escritório. Uma pessoa, mais
 * de 100 empresas, notas conforme o cliente pede. Por isso a busca é o ponto de
 * partida, cada empresa é uma linha com o próximo passo, e o que está em dia não
 * ocupa a tela. As notas do mês anterior aparecem como previstas e nada sai sem
 * o clique. Não voltar às duas visões nem ao passo de abrir o mês.
 */
export function ClientNfseWorkspace({
  clanId,
  period,
  currentPeriod,
  canManage,
  issuers,
  candidates,
  serviceReady,
}: {
  clanId: string;
  period: Period;
  currentPeriod: Period;
  canManage: boolean;
  issuers: readonly ClientNfseIssuerView[];
  candidates: readonly ClientNfseCandidateView[];
  serviceReady: boolean;
}) {
  const router = useRouter();
  const search = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [toEmit, setToEmit] = useState<ToEmit[] | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<DeskFilter | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [groups, setGroups] = useState<Partial<Record<DeskGroup, boolean>>>({});
  const [watching, setWatching] = useState<ReadonlySet<string>>(new Set());
  const isCurrent = period.year === currentPeriod.year && period.month === currentPeriod.month;
  const monthName = MONTHS[period.month - 1];
  const title = `${monthName.charAt(0).toUpperCase()}${monthName.slice(1)} de ${period.year}`;

  const desks = useMemo(() => new Map(issuers.map((issuer) => [issuer.id, issuerDesk(issuer)])), [issuers]);
  const score = useMemo(() => deskScore([...desks.values()]), [desks]);
  const searching = query.trim().length > 0;
  const visible = useMemo(
    () => issuers.filter((issuer) => matchesDeskQuery(issuer, query) && matchesDeskFilter(desks.get(issuer.id)!, filter)),
    [issuers, desks, query, filter],
  );
  const grouped = useMemo(() => {
    const result = new Map<DeskGroup, ClientNfseIssuerView[]>();
    for (const issuer of visible) {
      const group = desks.get(issuer.id)!.group;
      result.set(group, [...(result.get(group) ?? []), issuer]);
    }
    return result;
  }, [visible, desks]);
  const working = score.working.count > 0;

  // O que está marcado, com a empresa em dia: quem deixou de poder sair sai da conta sozinho.
  const emittable = useMemo(
    () =>
      canManage && serviceReady && isCurrent
        ? issuers
            .filter((issuer) => issuer.active && !issuer.problem)
            .flatMap((issuer) => [
              ...issuer.forecast.notes.filter((note) => !note.textNeedsReview && selected.has(note.sourceAccessKey)).map((note) => forecastToEmit(issuer, note)),
              ...issuer.notes.filter((note) => !note.blocked && noteIsOpen(note) && selected.has(note.modelId)).map((note) => modelToEmit(issuer, note)),
            ])
        : [],
    [issuers, selected, canManage, serviceReady, isCurrent],
  );
  const chosenTotal = emittable.reduce((sum, item) => sum + cents(item.amount), 0);
  const outcome = useMemo(() => batchOutcome(watching, issuers), [watching, issuers]);

  useEffect(() => {
    if (!working && outcome.waiting === 0) return;
    const timer = setInterval(() => router.refresh(), 5_000);
    return () => clearInterval(timer);
  }, [working, outcome.waiting, router]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable], [role=dialog], [role=menu]")) return;
      event.preventDefault();
      search.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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

  function expand(id: string, open: boolean) {
    setExpanded((current) => {
      const next = new Set(current);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const choose = (value: DeskFilter) => setFilter((current) => (current === value ? null : value));
  const groupIsOpen = (group: DeskGroup) => searching || filter !== null || (groups[group] ?? GROUP_STARTS_OPEN[group]);
  // Buscou e sobrou uma empresa: ela já abre, é o caminho do cliente que pediu nota.
  const onlyOne = searching && visible.length === 1 ? visible[0].id : null;

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button asChild variant="outline" size="icon-sm" className="touch-target">
            <Link href={monthHref(clanId, adjacent(period, -1))} aria-label="Mês anterior"><ChevronLeft aria-hidden /></Link>
          </Button>
          <h2 className="px-2">{title}</h2>
          <Button asChild variant="outline" size="icon-sm" className="touch-target">
            <Link href={monthHref(clanId, adjacent(period, 1))} aria-label="Próximo mês"><ChevronRight aria-hidden /></Link>
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {score.issued.count > 0 ? (
            <Button asChild variant="outline" size="sm">
              <a href={clientNfsePdfHref(clanId, period.year, period.month)}><Download aria-hidden /> PDFs do mês ({score.issued.count})</a>
            </Button>
          ) : null}
          {canManage ? <ClientNfseAddCompany clanId={clanId} candidates={candidates} /> : null}
        </div>
      </div>

      {!serviceReady ? (
        <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning" role="status">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          Emissão indisponível. Peça ao administrador para ativar o serviço fiscal e conferir os certificados das empresas.
        </p>
      ) : null}

      {!isCurrent ? (
        <p className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm" role="status">
          <span>{period.year < currentPeriod.year || (period.year === currentPeriod.year && period.month < currentPeriod.month) ? "Mês encerrado: aqui dá para consultar e corrigir o que deu erro. Nota nova entra no mês atual." : "Este mês ainda não começou."}</span>
          <Button asChild size="sm" variant="ghost"><Link href={monthHref(clanId, currentPeriod)}>Ir para {MONTHS[currentPeriod.month - 1]}</Link></Button>
        </p>
      ) : null}

      {issuers.length > 0 ? (
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" role="group" aria-label="Situação do mês. Escolha uma para filtrar.">
            <Plate label="A resolver" count={score.resolve.count} detail={score.resolve.count > 0 ? plural(score.resolve.companies, "empresa", "empresas") : "Tudo certo"} active={filter === "resolve"} onClick={() => choose("resolve")} icon={score.resolve.count > 0 ? <AlertTriangle className="size-5 text-destructive" aria-hidden /> : null} />
            <Plate label="Previstas" count={score.forecast.count} detail={score.forecast.count > 0 ? plural(score.forecast.companies, "empresa", "empresas") : "Nada previsto"} hint="Notas que saíram no mês passado e ainda não saíram neste." active={filter === "forecast"} onClick={() => choose("forecast")} />
            <Plate label="Em andamento" count={score.working.count} detail={working ? "Atualiza sozinho" : "Nada na fila"} active={filter === "working"} onClick={() => choose("working")} icon={working ? <LoaderCircle className="size-5 animate-spin text-warning" aria-hidden /> : null} />
            <Plate label="Emitidas" count={score.issued.count} detail={money(score.issued.cents)} active={filter === "issued"} onClick={() => choose("issued")} icon={score.issued.count > 0 ? <CheckCircle2 className="size-5 text-success" aria-hidden /> : null} />
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              ref={search}
              type="search"
              className="pr-10 pl-9"
              autoComplete="off"
              data-1p-ignore
              data-lpignore="true"
              aria-label="Buscar empresa, CNPJ ou cliente"
              aria-keyshortcuts="/"
              placeholder="Buscar empresa, CNPJ ou cliente"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Escape") setQuery(""); }}
            />
            {!searching ? <kbd className="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 rounded-sm border px-1.5 font-mono text-xs text-muted-foreground lg:block">/</kbd> : null}
          </div>
          <p role="status" className="sr-only">{searching || filter ? plural(visible.length, "empresa encontrada", "empresas encontradas") : ""}</p>
        </div>
      ) : null}

      {watching.size > 0 ? (
        <div role="status" className="panel-cut panel-cut-sm flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm">
          <span className="flex items-center gap-2">
            {outcome.waiting > 0 ? (
              <>
                <LoaderCircle className="size-4 animate-spin text-warning" aria-hidden />
                <span>Emitindo <span className="font-mono tabular-nums">{outcome.total}</span> notas: <span className="font-mono tabular-nums">{outcome.waiting}</span> na fila.</span>
              </>
            ) : (
              <>
                {outcome.failed > 0 ? <AlertTriangle className="size-4 text-destructive" aria-hidden /> : <CheckCircle2 className="size-4 text-success" aria-hidden />}
                <span>
                  <span className="font-mono tabular-nums">{outcome.issued}</span> {outcome.issued === 1 ? "emitida" : "emitidas"}
                  {outcome.failed > 0 ? <>, <span className="font-mono tabular-nums">{outcome.failed}</span> com erro</> : null}.
                </span>
              </>
            )}
          </span>
          <span className="flex gap-1">
            {outcome.waiting === 0 && outcome.failed > 0 ? <Button type="button" size="sm" variant="outline" onClick={() => { setFilter("resolve"); setQuery(""); }}>Ver erros</Button> : null}
            <Button type="button" size="icon-sm" variant="ghost" className="touch-target" aria-label="Fechar o resumo do lote" onClick={() => setWatching(new Set())}><X aria-hidden /></Button>
          </span>
        </div>
      ) : null}

      {issuers.length === 0 ? (
        <div className="grid justify-items-center gap-2 rounded-lg border border-dashed p-8 text-center text-sm">
          <p className="font-medium">Nenhuma empresa emitindo por aqui ainda.</p>
          <p className="max-w-prose text-muted-foreground">
            Em “Adicionar empresa”, a Guilda lê as notas que ela já emitiu e preenche os dados fiscais. As notas do mês passado passam a aparecer como previstas.
          </p>
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">{searching ? `Nenhuma empresa ou cliente com “${query.trim()}”.` : "Nenhuma empresa nesta situação."}</p>
          <Button type="button" variant="ghost" onClick={() => { setQuery(""); setFilter(null); }}>Limpar busca e filtro</Button>
        </div>
      ) : (
        <div className="grid gap-3">
          {DESK_GROUP_ORDER.map((group) => {
            const list = grouped.get(group);
            if (!list?.length) return null;
            const open = groupIsOpen(group);
            const label = group === "quiet" && !isCurrent ? "Sem nota no mês" : GROUP_LABEL[group];
            return (
              <section key={group} className="panel-cut grid min-w-0" aria-label={label}>
                <h3>
                  <button
                    type="button"
                    className="flex min-h-11 w-full items-center gap-2 px-4 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    aria-expanded={open}
                    onClick={() => setGroups((current) => ({ ...current, [group]: !open }))}
                  >
                    <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", !open && "-rotate-90")} aria-hidden />
                    {label}
                    <span className="font-mono text-xs font-normal tabular-nums text-muted-foreground">{list.length}</span>
                  </button>
                </h3>
                {open ? (
                  <ul className="grid min-w-0 divide-y divide-border/60 border-t border-border/70">
                    {list.map((issuer) => (
                      <DeskRow
                        key={`${issuer.id}-${period.year}-${period.month}`}
                        clanId={clanId}
                        period={period}
                        issuer={issuer}
                        desk={desks.get(issuer.id)!}
                        isCurrent={isCurrent}
                        canManage={canManage}
                        serviceReady={serviceReady}
                        expanded={expanded.has(issuer.id) || onlyOne === issuer.id}
                        onExpand={(value) => expand(issuer.id, value)}
                        selected={selected}
                        onToggle={toggle}
                        onEmit={setToEmit}
                      />
                    ))}
                  </ul>
                ) : null}
              </section>
            );
          })}
        </div>
      )}

      {emittable.length > 0 ? (
        <div className="panel-cut panel-cut-sm sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 shadow-lg" role="region" aria-label="Notas escolhidas">
          <span className="text-sm">
            <span className="font-mono tabular-nums">{emittable.length}</span> {emittable.length === 1 ? "nota escolhida" : "notas escolhidas"} ·{" "}
            <span className="font-mono tabular-nums">{money(chosenTotal)}</span>
          </span>
          <span className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(new Set())}><X aria-hidden /> Limpar</Button>
            <Button type="button" size="sm" onClick={() => setToEmit(emittable)}><Send aria-hidden /> Conferir e emitir</Button>
          </span>
        </div>
      ) : null}

      <EmitConfirm
        clanId={clanId}
        period={period}
        items={toEmit}
        onDone={(invoiceIds) => {
          setSelected(new Set());
          if (invoiceIds.length > 1) setWatching(new Set(invoiceIds));
        }}
        onOpenChange={(open) => { if (!open) setToEmit(null); }}
      />
    </div>
  );
}
