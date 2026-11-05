"use client";

import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Download,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  Repeat,
  Search,
  Settings2,
  Trash2,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatCnpj } from "@/domain/cnpj";
import type { NfseClientAddress } from "@/domain/nfse";
import type { ClientNfseCandidateView, ClientNfseIssuerView, ClientNfseMonthNoteView } from "@/lib/client-nfse/loaders";
import { COMPANY_FILTERS, matchesCompanyFilter, matchesCompanyQuery, summarizeNotes, type CompanyFilter } from "@/lib/client-nfse/presentation";
import { formatBRLCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

import { deleteIssuer } from "./client-nfse-actions";
import { ClientNfseAddCompany } from "./client-nfse-add-company";
import { ClientNfseTakersDialog } from "./client-nfse-customers";
import { ClientNfseEmitDialog, type EmitPrefill } from "./client-nfse-emit-dialog";
import { ClientNfseIssuerDialog } from "./client-nfse-issuer-dialog";
import { ClientNfseInvoiceDialog, clientNfsePdfHref, STATUS_CLASSES, STATUS_LABELS } from "./client-nfse-note-row";

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"] as const;

type Period = { year: number; month: number };

function adjacent(period: Period, delta: number): Period {
  const date = new Date(Date.UTC(period.year, period.month - 1 + delta, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

function monthHref(clanId: string, period: Period): string {
  return `/clans/${clanId}?tab=client-notes&fiscalYear=${period.year}&fiscalMonth=${period.month}`;
}

function money(totalCents: number): string {
  return formatBRLCurrency((totalCents / 100).toFixed(2));
}

/** Uma nota do mês: quem, o quê, quanto, a situação e o que dá para fazer com ela. */
function NoteRow({
  clanId,
  period,
  note,
  takerAddress,
  canManage,
  canEmit,
  blockedReason,
  onRepeat,
}: {
  clanId: string;
  period: Period;
  note: ClientNfseMonthNoteView;
  takerAddress: NfseClientAddress | null;
  canManage: boolean;
  canEmit: boolean;
  blockedReason: string | null;
  onRepeat: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { invoice } = note;
  const working = invoice.status === "queued" || invoice.status === "cancel_requested";
  return (
    <li className="grid min-w-0 gap-x-3 gap-y-1 py-1.5 pr-4 pl-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:pl-8">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm sm:flex-nowrap" title={note.description}>
        <span className={cn("min-w-0 truncate sm:max-w-[45%] sm:shrink-0", invoice.status === "cancelled" && "line-through opacity-60")}>{note.takerName}</span>
        <span className="min-w-0 truncate text-xs text-muted-foreground">{note.description}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <span className="font-mono text-sm tabular-nums">{formatBRLCurrency(note.amount)}</span>
        <button
          type="button"
          onClick={() => setOpen(true)}
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
          <Button type="button" size="sm" variant="outline" onClick={onRepeat} aria-label={`Nova nota igual para ${note.takerName}`}>
            <Repeat aria-hidden /> Nova igual
          </Button>
        ) : null}
      </div>
      {open ? (
        <ClientNfseInvoiceDialog
          clanId={clanId}
          period={period}
          takerName={note.takerName}
          takerAddress={takerAddress}
          amount={note.amount}
          invoice={invoice}
          open={open}
          onOpenChange={setOpen}
          startCancelling={false}
          canManage={canManage}
          blockedReason={blockedReason}
        />
      ) : null}
    </li>
  );
}

/** Uma empresa: o nome, o que ela tem no mês e as notas logo abaixo, sem nada para abrir. */
function CompanyRow({
  clanId,
  period,
  issuer,
  isCurrent,
  canManage,
  serviceReady,
}: {
  clanId: string;
  period: Period;
  issuer: ClientNfseIssuerView;
  isCurrent: boolean;
  canManage: boolean;
  serviceReady: boolean;
}) {
  const router = useRouter();
  const [fiscalOpen, setFiscalOpen] = useState(false);
  const [takersOpen, setTakersOpen] = useState(false);
  // O formulário de emissão: vazio ("Nova nota") ou preenchido ("Nova igual", cliente das notas do Portal).
  const [emitting, setEmitting] = useState<{ key: string; prefill: EmitPrefill | null } | null>(null);
  const [removing, startRemoving] = useTransition();
  const canEmit = canManage && serviceReady && issuer.active && !issuer.problem && isCurrent;
  const blockedReason = !serviceReady ? "O serviço fiscal está indisponível." : !issuer.active ? "A empresa está desativada." : issuer.problem;
  const summary = summarizeNotes(issuer.notes);
  // A nota com erro vem primeiro dentro da empresa; a empresa não muda de lugar.
  const notes = [...issuer.notes].sort((a, b) => Number(b.invoice.status === "failed") - Number(a.invoice.status === "failed"));

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

  return (
    <li className={cn("min-w-0 border-l-2", summary.failed > 0 ? "border-l-destructive" : "border-l-transparent", !issuer.active && "opacity-70")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-muted/50 px-4 py-1.5">
        <div className="grid min-w-[14rem] flex-1 gap-0.5">
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <span className="truncate text-sm font-semibold">{issuer.name}</span>
            <span className="font-mono text-xs text-muted-foreground">{issuer.cnpj ? formatCnpj(issuer.cnpj) : "sem CNPJ"}</span>
          </span>
          {!issuer.active ? (
            <span className="text-xs text-muted-foreground">Empresa desativada</span>
          ) : issuer.problem ? (
            <span className="flex items-start gap-1 text-xs text-warning"><AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden /> {issuer.problem}</span>
          ) : null}
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {summary.issued > 0 ? (
            <span className="font-mono text-xs tabular-nums text-muted-foreground">{summary.issued} {summary.issued === 1 ? "emitida" : "emitidas"} · {money(summary.issuedCents)}</span>
          ) : null}
          {summary.issued > 1 ? (
            <Button asChild size="sm" variant="ghost" aria-label={`Baixar os PDFs de ${issuer.name}`}>
              <a href={clientNfsePdfHref(clanId, period.year, period.month, { issuerId: issuer.id })}><Download aria-hidden /> PDFs</a>
            </Button>
          ) : null}
          {canEmit ? (
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

      {notes.length > 0 ? (
        <ul className="grid min-w-0 divide-y divide-border/40 border-t border-border/40" aria-label={`Notas de ${issuer.name} em ${MONTHS[period.month - 1]}`}>
          {notes.map((note) => (
            <NoteRow
              key={note.invoice.id}
              clanId={clanId}
              period={period}
              note={note}
              takerAddress={issuer.takers.find((row) => row.id === note.takerId)?.address ?? null}
              canManage={canManage}
              canEmit={canEmit}
              blockedReason={blockedReason}
              onRepeat={() => {
                const taker = issuer.takers.find((row) => row.id === note.takerId);
                emitFrom({ document: note.takerDocument, name: note.takerName, address: taker?.address ?? null, amount: note.amount, description: note.description, retentions: taker?.retentions ?? null });
              }}
            />
          ))}
        </ul>
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

/**
 * Notas dos clientes (2026-11-05): toda empresa em ordem alfabética, sempre no
 * mesmo lugar, com as notas do mês abaixo dela. Previsão do mês e grupos por
 * urgência foram testados e rejeitados: empresa que muda de lugar conforme a
 * situação fica difícil de achar. Não voltar sem o Bruno pedir.
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
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CompanyFilter | null>(null);
  const isCurrent = period.year === currentPeriod.year && period.month === currentPeriod.month;
  const monthName = MONTHS[period.month - 1];
  const title = `${monthName.charAt(0).toUpperCase()}${monthName.slice(1)} de ${period.year}`;
  const total = useMemo(() => summarizeNotes(issuers.flatMap((issuer) => issuer.notes)), [issuers]);
  const visible = useMemo(() => issuers.filter((issuer) => matchesCompanyQuery(issuer, query) && matchesCompanyFilter(issuer.notes, filter)), [issuers, query, filter]);
  const searching = query.trim().length > 0;

  useEffect(() => {
    if (total.working === 0) return;
    const timer = setInterval(() => router.refresh(), 5_000);
    return () => clearInterval(timer);
  }, [total.working, router]);

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
          {total.issued > 0 ? (
            <Button asChild variant="outline" size="sm">
              <a href={clientNfsePdfHref(clanId, period.year, period.month)}><Download aria-hidden /> PDFs do mês ({total.issued})</a>
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
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar empresas por situação">
              <Button type="button" size="sm" className="touch-target" variant={filter === null ? "default" : "outline"} aria-pressed={filter === null} onClick={() => setFilter(null)}>
                Todas <span className="font-mono tabular-nums">{issuers.length}</span>
              </Button>
              {COMPANY_FILTERS.map(([value, label]) => (
                <Button key={value} type="button" size="sm" className="touch-target" variant={filter === value ? "default" : "outline"} aria-pressed={filter === value} onClick={() => setFilter(value)}>
                  {value === "failed" && total.failed > 0 ? <AlertTriangle className="text-destructive" aria-hidden /> : null}
                  {label} <span className="font-mono tabular-nums">{issuers.filter((issuer) => matchesCompanyFilter(issuer.notes, value)).length}</span>
                </Button>
              ))}
            </div>
            <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">{total.issued} {total.issued === 1 ? "nota emitida" : "notas emitidas"} · {money(total.issuedCents)}</span>
          </div>
          {total.working > 0 ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" aria-hidden /> Acompanhando a emissão. A situação e o PDF aparecem aqui automaticamente.</p> : null}
          <p role="status" className="sr-only">{searching || filter ? `${visible.length} ${visible.length === 1 ? "empresa encontrada" : "empresas encontradas"}` : ""}</p>
        </div>
      ) : null}

      {issuers.length === 0 ? (
        <div className="grid justify-items-center gap-2 rounded-lg border border-dashed p-8 text-center text-sm">
          <p className="font-medium">Nenhuma empresa emitindo por aqui ainda.</p>
          <p className="max-w-prose text-muted-foreground">Em “Adicionar empresa”, a Guilda lê as notas que ela já emitiu e preenche os dados fiscais.</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">{searching ? `Nenhuma empresa ou cliente com “${query.trim()}”.` : "Nenhuma empresa nesta situação."}</p>
          <Button type="button" variant="ghost" onClick={() => { setQuery(""); setFilter(null); }}>Limpar busca e filtro</Button>
        </div>
      ) : (
        <ul className="panel-cut grid min-w-0 divide-y divide-border/70" aria-label={`Empresas em ${monthName}`}>
          {visible.map((issuer) => (
            <CompanyRow
              key={`${issuer.id}-${period.year}-${period.month}`}
              clanId={clanId}
              period={period}
              issuer={issuer}
              isCurrent={isCurrent}
              canManage={canManage}
              serviceReady={serviceReady}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
