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
import { formatAppDateTime } from "@/lib/date-time";
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
    <li className="grid min-w-0 gap-3 p-4">
      <div className="grid min-w-0 gap-1 text-sm">
        <span className={cn("break-words font-semibold", invoice.status === "cancelled" && "line-through opacity-60")}>{note.takerName}</span>
        <span className="font-mono text-xs text-muted-foreground">CPF/CNPJ: {note.takerDocument} · DPS {invoice.dpsSeries}/{invoice.dpsNumber}</span>
        <p className="max-w-prose whitespace-pre-wrap break-words text-muted-foreground">{note.description}</p>
        <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
          <span>Solicitada em <time dateTime={note.requestedAt}>{formatAppDateTime(note.requestedAt)}</time></span>
          <span>{invoice.issuedAt ? <>Emitida em <time dateTime={invoice.issuedAt}>{formatAppDateTime(invoice.issuedAt)}</time></> : invoice.status === "issued" || invoice.status === "cancelled" ? "Horário de emissão não informado" : "Ainda não emitida"} · Brasília</span>
          {invoice.cityLabel ? <span>Município de emissão: {invoice.cityLabel}</span> : null}
        </div>
        {invoice.lastError ? <p className="mt-2 break-words rounded-md border border-destructive/30 bg-destructive/10 p-2 text-sm">{invoice.lastError}</p> : null}
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
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>Detalhes e ações</Button>
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

/** Área de trabalho da empresa selecionada, com histórico e ações contextualizados. */
function CompanyRow({
  clanId,
  period,
  issuer,
  isCurrent,
  canManage,
  serviceReady,
  initialFilter,
}: {
  clanId: string;
  period: Period;
  issuer: ClientNfseIssuerView;
  isCurrent: boolean;
  canManage: boolean;
  serviceReady: boolean;
  initialFilter: CompanyFilter | null;
}) {
  const router = useRouter();
  const [fiscalOpen, setFiscalOpen] = useState(false);
  const [takersOpen, setTakersOpen] = useState(false);
  // O formulário de emissão: vazio ("Nova nota") ou preenchido ("Nova igual", cliente das notas do Portal).
  const [emitting, setEmitting] = useState<{ key: string; prefill: EmitPrefill | null } | null>(null);
  const [removing, startRemoving] = useTransition();
  const [noteFilter, setNoteFilter] = useState<string>(initialFilter === "none" ? "all" : initialFilter ?? "all");
  const [noteQuery, setNoteQuery] = useState("");
  const [page, setPage] = useState(0);
  const canEmit = canManage && serviceReady && issuer.active && !issuer.problem && isCurrent;
  const blockedReason = !serviceReady ? "O serviço fiscal está indisponível." : !issuer.active ? "A empresa está desativada." : issuer.problem;
  const summary = summarizeNotes(issuer.notes);
  // Histórico cronológico; erros têm filtro próprio e não mudam a ordem da carteira.
  const notes = issuer.notes.filter((note) => {
    const status = note.invoice.status;
    const matchesStatus = noteFilter === "all" || (noteFilter === "working" ? status === "queued" || status === "cancel_requested" : status === noteFilter);
    const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    return matchesStatus && normalize(`${note.takerName} ${note.takerDocument} ${note.description} ${note.invoice.nfseNumber ?? ""}`).includes(normalize(noteQuery.trim()));
  }).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  const currentPage = Math.min(page, Math.max(0, Math.ceil(notes.length / 10) - 1));

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
    <section className="min-w-0 rounded-md border bg-card" aria-label={`Gestão de ${issuer.name}`}>
      <div className="flex flex-wrap items-center gap-3 border-b bg-muted/30 p-4">
        <div className="grid min-w-[14rem] flex-1 gap-0.5">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <h3 className="break-words">{issuer.name}</h3>
            <span className="font-mono text-xs text-muted-foreground">{issuer.cnpj ? formatCnpj(issuer.cnpj) : "sem CNPJ"}</span>
          </div>
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
            <Button type="button" onClick={() => emitFrom(null)} aria-label={`Nova nota de ${issuer.name}`}>
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

      <div className="grid gap-4 border-b p-4">
        <div className="flex flex-wrap gap-2">
          {canManage ? <><Button variant="outline" onClick={() => setTakersOpen(true)}><Users aria-hidden /> Tomadores ({issuer.takers.length})</Button><Button variant="ghost" onClick={() => setFiscalOpen(true)}><Settings2 aria-hidden /> Dados fiscais</Button></> : null}
        </div>
        {canManage && !canEmit ? <p className="text-sm text-warning">{blockedReason ?? "Para emitir uma nova nota, volte ao mês atual."}</p> : null}
        <div><h3>Notas da empresa</h3><p className="mt-1 text-xs text-muted-foreground">Pedidos de {MONTHS[period.month - 1]} · mais recentes primeiro · horários de Brasília</p></div>
        <Input type="search" aria-label="Buscar nota da empresa" placeholder="Tomador, documento, nº da nota ou descrição" value={noteQuery} onChange={(event) => { setNoteQuery(event.target.value); setPage(0); }} />
        <div className="flex flex-wrap gap-2" role="group" aria-label="Situação das notas da empresa">
          {[["all", "Todas"], ["failed", "Com erro"], ["working", "Em andamento"], ["issued", "Emitidas"], ["cancelled", "Canceladas"]].map(([value, label]) => <Button key={value} size="sm" className="touch-target" variant={noteFilter === value ? "default" : "outline"} aria-pressed={noteFilter === value} onClick={() => { setNoteFilter(value); setPage(0); }}>{label}</Button>)}
        </div>
        <p className="text-xs text-muted-foreground" role="status">{notes.length} de {issuer.notes.length} notas neste recorte</p>
      </div>

      {notes.length > 0 ? (
        <ul className="grid min-w-0 divide-y divide-border/40 border-t border-border/40" aria-label={`Notas de ${issuer.name} em ${MONTHS[period.month - 1]}`}>
          {notes.slice(currentPage * 10, currentPage * 10 + 10).map((note) => (
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
      ) : <div className="grid gap-2 p-6 text-sm"><p>{issuer.notes.length ? "Nenhuma nota corresponde à busca e à situação escolhida." : "Esta empresa ainda não tem pedidos de emissão neste mês."}</p>{issuer.notes.length ? <Button variant="outline" onClick={() => { setNoteFilter("all"); setNoteQuery(""); setPage(0); }}>Limpar filtros das notas</Button> : <p className="text-muted-foreground">Use Nova nota para iniciar ou escolha um tomador para reaproveitar os dados anteriores.</p>}</div>}
      {notes.length > 10 ? <div className="flex items-center justify-between gap-2 border-t p-4"><Button variant="outline" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Anteriores</Button><span className="font-mono text-xs">Página {currentPage + 1} de {Math.ceil(notes.length / 10)}</span><Button variant="outline" disabled={(currentPage + 1) * 10 >= notes.length} onClick={() => setPage(currentPage + 1)}>Próximas</Button></div> : null}

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
    </section>
  );
}

/**
 * Carteira alfabética estável e área de trabalho de uma empresa por vez.
 * A revisão de 07/11 separa o histórico para evitar todas as notas abertas juntas.
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const isCurrent = period.year === currentPeriod.year && period.month === currentPeriod.month;
  const monthName = MONTHS[period.month - 1];
  const title = `${monthName.charAt(0).toUpperCase()}${monthName.slice(1)} de ${period.year}`;
  const total = useMemo(() => summarizeNotes(issuers.flatMap((issuer) => issuer.notes)), [issuers]);
  const visible = useMemo(() => issuers.filter((issuer) => matchesCompanyQuery(issuer, query) && matchesCompanyFilter(issuer.notes, filter)), [issuers, query, filter]);
  const searching = query.trim().length > 0;
  const selected = visible.find((issuer) => issuer.id === selectedId);

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
      <section className="panel-cut grid gap-4 border border-primary/20 bg-card p-5">
        <div><h2>Central de emissões</h2><p className="mt-2 max-w-prose text-sm text-muted-foreground">Escolha uma empresa para emitir, acompanhar os pedidos e consultar as notas. Cada operação fica no contexto do CNPJ selecionado.</p></div>
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[["Emitidas no período", String(total.issued)], ["Valor emitido", money(total.issuedCents)], ["Em andamento", String(total.working)], ["Notas com erro", String(total.failed)]].map(([label, value]) => <div key={label} className="rounded-md border bg-background/40 p-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-2 break-words font-mono text-xl tabular-nums">{value}</dd></div>)}
        </dl>
        <p className="text-xs text-muted-foreground">Período dos pedidos de emissão. Valor considera apenas notas emitidas; canceladas e cancelamentos em andamento ficam fora do total.</p>
      </section>
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
        <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <section className="min-w-0 rounded-md border bg-card" aria-label="Carteira de empresas">
            <div className="border-b p-3"><h3>Empresas</h3><p className="mt-1 text-xs text-muted-foreground">{visible.length} no recorte · selecione para trabalhar</p></div>
            <ul className="max-h-72 divide-y overflow-y-auto lg:max-h-[65vh]">
              {visible.map((issuer) => { const counts = summarizeNotes(issuer.notes); return <li key={issuer.id}><button type="button" aria-pressed={selected?.id === issuer.id} onClick={() => setSelectedId(issuer.id)} className={cn("grid w-full gap-2 border-l-2 p-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", selected?.id === issuer.id ? "border-primary bg-primary/10" : "border-transparent")}><span className="break-words text-sm font-medium">{issuer.name}</span><span className="font-mono text-xs text-muted-foreground">{issuer.cnpj ? formatCnpj(issuer.cnpj) : "Sem CNPJ"}</span><span className="text-xs text-muted-foreground">{counts.issued} emitidas · {money(counts.issuedCents)}</span>{counts.failed ? <span className="text-xs text-destructive">{counts.failed} nota(s) com erro</span> : null}{counts.working ? <span className="text-xs text-warning">{counts.working} em andamento</span> : null}{!issuer.active || issuer.problem ? <span className="text-xs text-warning">{!issuer.active ? "Empresa desativada" : "Cadastro precisa de atenção"}</span> : <span className="text-xs text-success">Cadastro pronto</span>}</button></li>; })}
            </ul>
          </section>
          <div className="min-w-0" aria-live="polite">
          {selected ? (
            <CompanyRow
              key={`${selected.id}-${period.year}-${period.month}-${filter}`}
              clanId={clanId}
              period={period}
              issuer={selected}
              initialFilter={filter}
              isCurrent={isCurrent}
              canManage={canManage}
              serviceReady={serviceReady}
            />
          ) : <section className="grid min-h-64 content-center gap-3 rounded-md border border-dashed p-6 text-center"><h3>Qual empresa vamos atender?</h3><p className="mx-auto max-w-prose text-sm text-muted-foreground">Selecione uma empresa na carteira. Aqui você verá suas notas, tomadores e ações de emissão.</p></section>}
          </div>
        </div>
      )}
    </div>
  );
}
