"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileDown,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  Repeat,
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
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { issuerMonthNotes, matchesIssuer, matchesNoteFilter, NOTE_FILTERS, summarizeNotes, type NoteFilter } from "@/lib/client-nfse/presentation";
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
import type { ClientNfseCandidateView, ClientNfseFreeNoteView, ClientNfseIssuerView, ClientNfseNoteView } from "@/lib/client-nfse/loaders";
import { formatBRLCurrency } from "@/lib/currency";
import { formatAppDate } from "@/lib/date-time";
import { cn } from "@/lib/utils";

import { deleteIssuer, emitBatch } from "./client-nfse-actions";
import { ClientNfseAddCompany } from "./client-nfse-add-company";
import { ClientNfseTakersDialog } from "./client-nfse-customers";
import { ClientNfseEmitDialog, type EmitPrefill } from "./client-nfse-emit-dialog";
import { ClientNfseIssuerDialog } from "./client-nfse-issuer-dialog";
import { ClientNfseNoteDialog } from "./client-nfse-note-dialog";
import { ClientNfseInvoiceDialog, ClientNfseNoteRow, clientNfsePdfHref, noteIsOpen, STATUS_CLASSES, STATUS_LABELS } from "./client-nfse-note-row";
import { ClientNfseSuggestionsDialog } from "./client-nfse-suggestions";

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"] as const;

type Period = { year: number; month: number };
type ToEmit = { note: ClientNfseNoteView; issuerName: string };

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

/** Confirmação antes de pedir: nota emitida só se desfaz com cancelamento formal. */
function EmitConfirm({ clanId, period, items, onDone, onOpenChange }: { clanId: string; period: Period; items: ToEmit[] | null; onDone: () => void; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [sending, startSending] = useTransition();
  const list = items ?? [];
  const total = list.reduce((sum, item) => sum + cents(item.note.amount), 0);
  const single = list.length === 1 ? list[0] : null;

  function emit() {
    startSending(async () => {
      const result = await emitBatch({
        clanId,
        year: period.year,
        month: period.month,
        selected: list.map((item) => item.note.modelId),
        expectedCount: list.length,
        expectedTotalCents: total,
      });
      if (!result.ok) {
        toast.error(result.error);
        router.refresh();
        return;
      }
      toast.success(list.length === 1 ? "Nota na fila. Ela sai em instantes." : `${result.data?.queued ?? list.length} notas na fila. Elas saem em instantes.`);
      onDone();
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={items !== null} onOpenChange={(open) => { if (!sending) onOpenChange(open); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{single ? `Emitir a nota de ${single.note.takerName}?` : `Emitir ${list.length} notas?`}</DialogTitle>
          <DialogDescription>Cada nota sai pelo CNPJ da empresa, com o certificado dela. Emitida, só se desfaz com cancelamento formal.</DialogDescription>
        </DialogHeader>
        {single ? (
          <div className="grid gap-1 rounded-md border bg-muted/30 p-3 text-sm">
            <span className="hud-label">{single.issuerName}</span>
            <span>{single.note.description}</span>
            <span className="font-mono tabular-nums">{formatBRLCurrency(single.note.amount)}</span>
          </div>
        ) : (
          <ul className="max-h-[50dvh] divide-y overflow-auto rounded-md border text-sm">
            {list.map((item) => (
              <li key={item.note.modelId} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="grid min-w-0">
                  <span className="truncate">{item.note.takerName}</span>
                  <span className="truncate text-xs text-muted-foreground">{item.issuerName}</span>
                </span>
                <span className="font-mono tabular-nums">{formatBRLCurrency(item.note.amount)}</span>
              </li>
            ))}
          </ul>
        )}
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

/** Uma nota avulsa do mês: quem, o quê, quanto, a situação e "Repetir". */
function FreeNoteRow({
  clanId,
  period,
  note,
  canManage,
  onRepeat,
}: {
  clanId: string;
  period: Period;
  note: ClientNfseFreeNoteView;
  canManage: boolean;
  onRepeat: () => void;
}) {
  const [open, setOpen] = useState(false);
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
          {invoice.status === "issued" && invoice.nfseNumber ? `Emitida · Nº ${invoice.nfseNumber}` : invoice.status === "failed" ? "Ver erro e resolver" : STATUS_LABELS[invoice.status]}
        </button>
        {invoice.status === "issued" ? (
          <Button asChild size="sm" variant="outline" className="touch-target" aria-label={`Baixar o PDF da nota de ${note.takerName}`}>
            <a href={clientNfsePdfHref(clanId, period.year, period.month, { invoiceId: invoice.id })}><Download aria-hidden /> PDF</a>
          </Button>
        ) : null}
        {canManage && (invoice.status === "issued" || invoice.status === "cancelled") ? (
          <Button type="button" size="sm" variant="outline" onClick={onRepeat}>
            <Repeat aria-hidden /> Nova igual
          </Button>
        ) : null}
        {canManage && invoice.status === "issued" ? (
          <Button type="button" size="icon-sm" variant="ghost" className="touch-target" aria-label={`Cancelar a nota de ${note.takerName}`} onClick={() => show(true)}>
            <XCircle aria-hidden />
          </Button>
        ) : null}
      </div>
      {open ? <ClientNfseInvoiceDialog
        clanId={clanId}
        period={period}
        takerName={note.takerName}
        amount={note.amount}
        invoice={invoice}
        open={open}
        onOpenChange={setOpen}
        startCancelling={cancelFirst}
        canManage={canManage}
      /> : null}
    </li>
  );
}

function IssuerPanel({
  clanId,
  period,
  issuer,
  canManage,
  selected,
  onToggle,
  onEmit,
  filter,
  serviceReady,
}: {
  clanId: string;
  period: Period;
  issuer: ClientNfseIssuerView;
  canManage: boolean;
  selected: ReadonlySet<string>;
  onToggle: (ids: readonly string[], on: boolean) => void;
  onEmit: (items: ToEmit[]) => void;
  filter: NoteFilter;
  serviceReady: boolean;
}) {
  const router = useRouter();
  const [fiscalOpen, setFiscalOpen] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [takersOpen, setTakersOpen] = useState(false);
  // O formulário de emissão: vazio ("+ Emitir nota") ou preenchido (Repetir, cliente das notas do Portal).
  const [emitting, setEmitting] = useState<{ key: string; prefill: EmitPrefill | null } | null>(null);
  const [editing, setEditing] = useState<ClientNfseNoteView | null>(null);
  const [removing, startRemoving] = useTransition();
  const canEmit = canManage && serviceReady && issuer.active && !issuer.problem;
  const emissible = (note: ClientNfseNoteView) => canEmit && !note.blocked && noteIsOpen(note);
  const fixed = issuer.usesStandardNotes || issuer.notes.some((note) => note.invoice);
  const ready = fixed ? issuer.notes.filter((note) => emissible(note) && matchesNoteFilter(note, filter)) : [];
  const readyIds = ready.map((note) => note.modelId);
  const allChosen = readyIds.length > 0 && readyIds.every((id) => selected.has(id));
  const summary = summarizeNotes(issuerMonthNotes(issuer));
  const issued = summary.issued;
  const visibleFree = issuer.freeNotes.filter((note) => matchesNoteFilter(note, filter));
  const visibleFixed = issuer.notes.filter((note) => matchesNoteFilter(note, filter));

  function remove() {
    if (!window.confirm(`Tirar ${issuer.name} das Notas dos clientes? As notas padrão saem junto. Com nota já pedida, desative nos dados fiscais.`)) return;
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

  return (
    <section className={cn("panel-cut grid min-w-0", !issuer.active && "opacity-70")} aria-labelledby={`issuer-${issuer.id}`}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/70 px-4 py-3">
        <div className="grid min-w-[12rem] flex-1 gap-0.5">
          <h3 id={`issuer-${issuer.id}`} className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <span className="truncate">{issuer.name}</span>
            <span className="font-mono text-xs font-normal text-muted-foreground">{issuer.cnpj ? formatCnpj(issuer.cnpj) : ""}</span>
          </h3>
          {!issuer.active ? <span className="text-xs text-muted-foreground">Empresa desativada</span> : issuer.problem ? (
            <span className="flex items-start gap-1.5 text-xs text-warning"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {issuer.problem}</span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-success"><CheckCircle2 className="size-3.5" aria-hidden /> Pronta para emitir</span>
          )}
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {issued} emitida(s) · {money(summary.issuedCents)}
            {summary.pending > 0 ? ` · ${summary.pending} a emitir` : ""}
          </span>
          {issued > 1 ? (
            <Button asChild size="sm" variant="ghost">
              <a href={clientNfsePdfHref(clanId, period.year, period.month, { issuerId: issuer.id })}><Download aria-hidden /> PDFs</a>
            </Button>
          ) : null}
          {canEmit ? (
            <Button type="button" size="sm" onClick={() => emitFrom(null)}>
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
                <DropdownMenuItem onSelect={() => setTakersOpen(true)}><Users aria-hidden /> Tomadores e notas do Portal</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setFiscalOpen(true)}><Settings2 aria-hidden /> Dados fiscais</DropdownMenuItem>
                {fixed ? <DropdownMenuItem onSelect={() => setSuggestOpen(true)}><FileDown aria-hidden /> Trazer notas fixas das emitidas</DropdownMenuItem> : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={removing} onSelect={remove} className="text-destructive focus:text-destructive"><Trash2 aria-hidden /> Tirar empresa</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </header>

      {canManage && ready.length > 0 ? <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={allChosen} onChange={(event) => onToggle(readyIds, event.target.checked)} />Selecionar {ready.length} recorrente(s) a emitir</label>
        <Button type="button" variant="outline" size="sm" onClick={() => onEmit(ready.map((note) => ({ note, issuerName: issuer.name })))}>Conferir pendentes</Button>
      </div> : null}

      {visibleFree.length === 0 && visibleFixed.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">
          {filter === "all" ? `Nenhuma nota em ${MONTHS[period.month - 1]}. Use Nova nota para começar.` : "Nenhuma nota nesta situação. Escolha outro filtro para ver as demais."}
        </p>
      ) : (
        <ul className="grid min-w-0 divide-y divide-border/60" aria-label={`Notas de ${issuer.name} em ${MONTHS[period.month - 1]}`}>
          {visibleFixed.map((note) => (
            <ClientNfseNoteRow key={note.modelId} clanId={clanId} period={period} note={note} canManage={canManage} emissible={emissible(note)} selected={selected.has(note.modelId)} onToggle={() => onToggle([note.modelId], !selected.has(note.modelId))} onEmit={() => onEmit([{ note, issuerName: issuer.name }])} onEditStandard={() => setEditing(note)} />
          ))}
          {visibleFree.map((note) => (
            <FreeNoteRow
              key={note.invoice.id}
              clanId={clanId}
              period={period}
              note={note}
              canManage={canEmit}
              onRepeat={() => {
                const taker = issuer.takers.find((row) => row.id === note.takerId);
                emitFrom({ document: note.takerDocument, name: note.takerName, address: taker?.address ?? null, amount: note.amount, description: note.description, retentions: taker?.retentions ?? null });
              }}
            />
          ))}
        </ul>
      )}

      {canManage ? (
        <footer className="flex flex-wrap gap-1 border-t border-border/70 px-2 py-1.5">
          <Button type="button" variant="ghost" size="sm" onClick={() => setTakersOpen(true)}>
            <Users aria-hidden /> Clientes / tomadores ({issuer.takers.length})
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setFiscalOpen(true)}><Settings2 aria-hidden /> Configurar empresa</Button>
          {issuer.usesStandardNotes ? <Button type="button" variant="ghost" size="sm" onClick={() => setNoteOpen(true)}><Plus aria-hidden /> Nova recorrente</Button> : null}
        </footer>
      ) : null}

      {canManage ? (
        <>
          {/* Os formulários nascem a cada abertura, já com o que está gravado: um
              formulário reaproveitado abria vazio (nota padrão) ou com dados
              velhos (a série que a fila trocou sozinha voltaria ao salvar). */}
          {emitting ? (
            <ClientNfseEmitDialog key={emitting.key} clanId={clanId} issuer={issuer} prefill={emitting.prefill} onOpenChange={(open) => { if (!open) setEmitting(null); }} />
          ) : null}
          {takersOpen ? <ClientNfseTakersDialog clanId={clanId} issuer={issuer} onOpenChange={setTakersOpen} onEmit={emitFrom} /> : null}
          {fiscalOpen ? <ClientNfseIssuerDialog clanId={clanId} issuer={issuer} open onOpenChange={setFiscalOpen} /> : null}
          <ClientNfseSuggestionsDialog clanId={clanId} issuer={issuer} open={suggestOpen} onOpenChange={setSuggestOpen} />
          {noteOpen ? <ClientNfseNoteDialog clanId={clanId} issuer={issuer} note={null} period={period} open onOpenChange={setNoteOpen} /> : null}
          {editing ? (
            <ClientNfseNoteDialog key={editing.modelId} clanId={clanId} issuer={issuer} note={editing} period={period} open onOpenChange={(open) => { if (!open) setEditing(null); }} />
          ) : null}
        </>
      ) : null}
    </section>
  );
}

/**
 * Notas dos clientes numa tela só (pedido do Bruno, 2026-10-23): cada empresa
 * com as notas do mês, que aparecem sozinhas a partir das notas padrão. Emite
 * uma (botão da linha), as de uma empresa (cabeçalho) ou as escolhidas.
 */
export function ClientNfseWorkspace({
  clanId,
  period,
  canManage,
  issuers,
  candidates,
  serviceReady,
}: {
  clanId: string;
  period: Period;
  canManage: boolean;
  issuers: readonly ClientNfseIssuerView[];
  candidates: readonly ClientNfseCandidateView[];
  serviceReady: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [toEmit, setToEmit] = useState<ToEmit[] | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<NoteFilter>("all");
  const monthName = MONTHS[period.month - 1];
  const title = `${monthName.charAt(0).toUpperCase()}${monthName.slice(1)} de ${period.year}`;
  const allNotes = issuers.flatMap(issuerMonthNotes);
  const summary = summarizeNotes(allNotes);
  const { issued, working } = summary;
  const visibleIssuers = issuers.filter((issuer) => matchesIssuer(issuer, query) && (filter === "all" || issuerMonthNotes(issuer).some((note) => matchesNoteFilter(note, filter))));
  const notes = visibleIssuers.filter((issuer) => canManage && serviceReady && issuer.active && !issuer.problem)
    .flatMap((issuer) => issuer.notes.filter((note) => !note.blocked && noteIsOpen(note) && matchesNoteFilter(note, filter)).map((note) => ({ note, issuerName: issuer.name })));
  const chosen = notes.filter((item) => selected.has(item.note.modelId));
  const chosenTotal = chosen.reduce((sum, item) => sum + cents(item.note.amount), 0);

  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => router.refresh(), 5_000);
    return () => clearInterval(timer);
  }, [working, router]);

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
          {issued > 0 ? (
            <Button asChild variant="outline" size="sm">
              <a href={clientNfsePdfHref(clanId, period.year, period.month)}><Download aria-hidden /> PDFs do mês ({issued})</a>
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

      {issuers.length > 0 ? <>
        <div className="grid grid-cols-3 gap-3 rounded-md border bg-card p-4" aria-label="Resumo do mês">
          <div><p className="text-xs text-muted-foreground">A emitir</p><p className="font-mono tabular-nums">{summary.pending}</p></div>
          <div><p className="text-xs text-muted-foreground">Com erro</p><p className={cn("font-mono tabular-nums", summary.failed > 0 && "text-destructive")}>{summary.failed}</p></div>
          <div><p className="text-xs text-muted-foreground">Total emitido · {issued} nota(s)</p><p className="font-mono tabular-nums">{money(summary.issuedCents)}</p></div>
        </div>
        <div className="grid gap-3">
          <div className="relative"><Search className="absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden /><Input className="pl-9" aria-label="Buscar empresa por nome ou CNPJ" placeholder="Buscar empresa por nome ou CNPJ" value={query} onChange={(event) => { setQuery(event.target.value); setSelected(new Set()); }} /></div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar notas por situação">
            {NOTE_FILTERS.map(([value, label]) => <Button key={value} type="button" size="sm" className="touch-target" variant={filter === value ? "default" : "outline"} aria-pressed={filter === value} onClick={() => { setFilter(value); setSelected(new Set()); }}>{label} <span className="font-mono tabular-nums">{allNotes.filter((note) => matchesNoteFilter(note, value)).length}</span></Button>)}
          </div>
          {working ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" aria-hidden /> Acompanhando a emissão. A situação e o PDF aparecem aqui automaticamente.</p> : null}
        </div>
      </> : null}

      {issuers.length === 0 ? (
        <div className="grid justify-items-center gap-2 rounded-lg border border-dashed p-8 text-center text-sm">
          <p className="font-medium">Nenhuma empresa emitindo por aqui ainda.</p>
          <p className="max-w-prose text-muted-foreground">
            Em “Adicionar empresa”, a Guilda lê as notas que ela já emitiu, preenche os dados fiscais e sugere as notas que se repetem.
          </p>
        </div>
      ) : (
        <div className="grid gap-4" aria-live="polite">
          {visibleIssuers.length === 0 ? <div className="rounded-md border border-dashed p-6 text-center"><p className="text-sm text-muted-foreground">Nenhuma empresa encontrada com esta busca e situação.</p><Button type="button" variant="ghost" onClick={() => { setQuery(""); setFilter("all"); }}>Limpar filtros</Button></div> : null}
          {visibleIssuers.map((issuer) => (
            <IssuerPanel
              key={`${issuer.id}-${period.year}-${period.month}`}
              clanId={clanId}
              period={period}
              issuer={issuer}
              canManage={canManage}
              serviceReady={serviceReady}
              filter={filter}
              selected={selected}
              onToggle={toggle}
              onEmit={setToEmit}
            />
          ))}
        </div>
      )}

      {chosen.length > 0 ? (
        <div className="panel-cut panel-cut-sm sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 shadow-lg" role="region" aria-label="Notas escolhidas">
          <span className="text-sm">
            <span className="font-mono tabular-nums">{chosen.length}</span> {chosen.length === 1 ? "nota escolhida" : "notas escolhidas"} ·{" "}
            <span className="font-mono tabular-nums">{money(chosenTotal)}</span>
          </span>
          <span className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(new Set())}><X aria-hidden /> Limpar</Button>
            <Button type="button" size="sm" onClick={() => setToEmit(chosen)}><Send aria-hidden /> Emitir escolhidas</Button>
          </span>
        </div>
      ) : null}

      <EmitConfirm
        clanId={clanId}
        period={period}
        items={toEmit}
        onDone={() => setSelected(new Set())}
        onOpenChange={(open) => { if (!open) setToEmit(null); }}
      />
    </div>
  );
}
