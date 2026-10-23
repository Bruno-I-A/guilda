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
  Send,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatCnpj } from "@/domain/cnpj";
import type { ClientNfseCandidateView, ClientNfseIssuerView, ClientNfseNoteView } from "@/lib/client-nfse/loaders";
import { formatBRLCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

import { deleteIssuer, emitBatch } from "./client-nfse-actions";
import { ClientNfseAddCompany } from "./client-nfse-add-company";
import { ClientNfseIssuerDialog } from "./client-nfse-issuer-dialog";
import { ClientNfseNoteDialog } from "./client-nfse-note-dialog";
import { ClientNfseNoteRow, clientNfsePdfHref, noteIsOpen } from "./client-nfse-note-row";
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
    <Dialog open={items !== null} onOpenChange={onOpenChange}>
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
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Voltar</Button>
          <Button type="button" disabled={sending || list.length === 0} onClick={emit}>
            {sending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Send aria-hidden />}
            Emitir {list.length === 1 ? "a nota" : `${list.length} notas`} · <span className="font-mono tabular-nums">{money(total)}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
}: {
  clanId: string;
  period: Period;
  issuer: ClientNfseIssuerView;
  canManage: boolean;
  selected: ReadonlySet<string>;
  onToggle: (ids: readonly string[], on: boolean) => void;
  onEmit: (items: ToEmit[]) => void;
}) {
  const router = useRouter();
  const [fiscalOpen, setFiscalOpen] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [editing, setEditing] = useState<ClientNfseNoteView | null>(null);
  const [removing, startRemoving] = useTransition();
  const emissible = (note: ClientNfseNoteView) => canManage && issuer.active && !issuer.problem && !note.blocked && noteIsOpen(note);
  const ready = issuer.notes.filter(emissible);
  const readyIds = ready.map((note) => note.modelId);
  const allChosen = readyIds.length > 0 && readyIds.every((id) => selected.has(id));
  const total = issuer.notes.reduce((sum, note) => sum + cents(note.amount), 0);
  const issued = issuer.notes.filter((note) => note.invoice?.status === "issued").length;

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

  return (
    <section className={cn("panel-cut grid min-w-0", !issuer.active && "opacity-70")} aria-labelledby={`issuer-${issuer.id}`}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/70 px-4 py-3">
        <input
          type="checkbox"
          className="size-4 accent-primary disabled:opacity-30"
          checked={allChosen}
          disabled={readyIds.length === 0}
          onChange={(event) => onToggle(readyIds, event.target.checked)}
          aria-label={`Escolher as notas de ${issuer.name}`}
        />
        <div className="grid min-w-[12rem] flex-1 gap-0.5">
          <h3 id={`issuer-${issuer.id}`} className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <span className="truncate">{issuer.name}</span>
            <span className="font-mono text-xs font-normal text-muted-foreground">{issuer.cnpj ? formatCnpj(issuer.cnpj) : ""}</span>
          </h3>
          {issuer.problem ? (
            <span className="flex items-start gap-1.5 text-xs text-warning"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {issuer.problem}</span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-success"><CheckCircle2 className="size-3.5" aria-hidden /> Pronta para emitir</span>
          )}
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {issuer.notes.length} nota(s) · {money(total)}{issued > 0 ? ` · ${issued} emitida(s)` : ""}
        </span>
        {canManage && ready.length > 0 ? (
          <Button type="button" size="sm" onClick={() => onEmit(ready.map((note) => ({ note, issuerName: issuer.name })))}>
            <Send aria-hidden /> Emitir {ready.length === 1 ? "a nota" : `as ${ready.length}`}
          </Button>
        ) : null}
        {issued > 1 ? (
          <Button asChild size="sm" variant="ghost">
            <a href={clientNfsePdfHref(clanId, period.year, period.month, { issuerId: issuer.id })}><Download aria-hidden /> PDFs</a>
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
              <DropdownMenuItem onSelect={() => setFiscalOpen(true)}><Settings2 aria-hidden /> Dados fiscais</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setSuggestOpen(true)}><FileDown aria-hidden /> Trazer notas que ela emitiu</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={removing} onSelect={remove} className="text-destructive focus:text-destructive"><Trash2 aria-hidden /> Tirar empresa</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        </div>
      </header>

      {issuer.notes.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">Nenhuma nota ainda. Cadastre a primeira ou traga as que ela já emitiu (menu ⋯).</p>
      ) : (
        <ul className="grid min-w-0 divide-y divide-border/60">
          {issuer.notes.map((note) => (
            <ClientNfseNoteRow
              key={note.modelId}
              clanId={clanId}
              period={period}
              note={note}
              canManage={canManage}
              emissible={emissible(note)}
              selected={selected.has(note.modelId)}
              onToggle={() => onToggle([note.modelId], !selected.has(note.modelId))}
              onEmit={() => onEmit([{ note, issuerName: issuer.name }])}
              onEditStandard={() => setEditing(note)}
            />
          ))}
        </ul>
      )}

      {canManage ? (
        <footer className="border-t border-border/70 px-2 py-1.5">
          <Button type="button" variant="ghost" size="sm" onClick={() => setNoteOpen(true)}>
            <Plus aria-hidden /> Nova nota
          </Button>
        </footer>
      ) : null}

      {canManage ? (
        <>
          <ClientNfseIssuerDialog clanId={clanId} issuer={issuer} open={fiscalOpen} onOpenChange={setFiscalOpen} />
          <ClientNfseSuggestionsDialog clanId={clanId} issuer={issuer} open={suggestOpen} onOpenChange={setSuggestOpen} />
          <ClientNfseNoteDialog clanId={clanId} issuer={issuer} note={null} period={period} open={noteOpen} onOpenChange={setNoteOpen} />
          <ClientNfseNoteDialog clanId={clanId} issuer={issuer} note={editing} period={period} open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }} />
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
  const monthName = MONTHS[period.month - 1];
  const title = `${monthName.charAt(0).toUpperCase()}${monthName.slice(1)} de ${period.year}`;
  const notes = issuers.flatMap((issuer) => issuer.notes.map((note) => ({ note, issuerName: issuer.name })));
  const issued = notes.filter((item) => item.note.invoice?.status === "issued").length;
  const working = notes.some((item) => item.note.invoice?.status === "queued" || item.note.invoice?.status === "cancel_requested");
  const chosen = useMemo(() => notes.filter((item) => selected.has(item.note.modelId)), [notes, selected]);
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
          <Button asChild variant="outline" size="icon-sm">
            <Link href={monthHref(clanId, adjacent(period, -1))} aria-label="Mês anterior"><ChevronLeft aria-hidden /></Link>
          </Button>
          <h2 className="px-2">{title}</h2>
          <Button asChild variant="outline" size="icon-sm">
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
          O serviço fiscal ainda não publicou a chave do cofre. Sem ela, o certificado das empresas não abre e nenhuma nota sai.
        </p>
      ) : null}

      {issuers.length === 0 ? (
        <div className="grid justify-items-center gap-2 rounded-lg border border-dashed p-8 text-center text-sm">
          <p className="font-medium">Nenhuma empresa emitindo por aqui ainda.</p>
          <p className="max-w-prose text-muted-foreground">
            Em “Adicionar empresa”, a Guilda lê as notas que ela já emitiu, preenche os dados fiscais e sugere as notas que se repetem.
          </p>
        </div>
      ) : (
        <div className="grid gap-4" aria-live="polite">
          {issuers.map((issuer) => (
            <IssuerPanel
              key={issuer.id}
              clanId={clanId}
              period={period}
              issuer={issuer}
              canManage={canManage}
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
