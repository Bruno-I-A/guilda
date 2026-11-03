"use client";

import { CheckCircle2, History, LoaderCircle, Percent, Search, Send, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatCnpj } from "@/domain/cnpj";
import type { ClientNfseIssuerView, IssuerCustomersView } from "@/lib/client-nfse/loaders";
import type { IssuerCustomer } from "@/lib/client-nfse/suggest";
import { formatBRLCurrency } from "@/lib/currency";

import { importTakers, listIssuerCustomers, readIssuerHistory } from "./client-nfse-actions";
import type { EmitPrefill } from "./client-nfse-emit-dialog";
import { retentionLabel, TakerRetentionsDialog } from "./client-nfse-retentions";

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function monthYear(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" });
}

/** Busca por nome ou por CPF/CNPJ, sem acento e sem máscara. */
export function matchCustomers(customers: readonly IssuerCustomer[], query: string): IssuerCustomer[] {
  const needle = normalize(query.trim());
  const digits = query.replace(/\D/g, "");
  if (!needle) return [...customers];
  return customers.filter((customer) => normalize(customer.takerName).includes(needle) || (digits.length >= 3 && customer.takerDocument.includes(digits)));
}

/** Os clientes da empresa pelas notas que a rotina da aba XML guardou; lidos ao abrir. */
export function useIssuerCustomers(clanId: string, issuerId: string, enabled: boolean, reload = 0) {
  const [view, setView] = useState<IssuerCustomersView | null>(null);
  const [loading, startLoading] = useTransition();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    startLoading(async () => {
      setError(null);
      try {
      const result = await listIssuerCustomers({ clanId, issuerId });
      if (!active) return;
      if (!result.ok || !result.data) {
        setError(result.ok ? "Não consegui ler os clientes." : result.error);
        return;
      }
      setView(result.data);
      } catch {
        if (active) setError("Não foi possível carregar os clientes. Tente novamente.");
      }
    });
    return () => { active = false; };
  }, [clanId, issuerId, enabled, reload]);
  return { view, loading, error };
}

export function customerPrefill(customer: IssuerCustomer): EmitPrefill {
  return { document: customer.takerDocument, name: customer.takerName, address: customer.address, amount: customer.amount || null, description: customer.description || null };
}

/**
 * Tomadores da empresa a partir das notas que ela já emitiu no Portal: todos
 * os clientes do histórico guardado, marcados para cadastrar de uma vez.
 * Quando faltam as notas antigas (guardadas só a partir de um mês), o botão
 * pede à rotina da aba XML que releia o histórico desta empresa.
 */
export function ClientNfseTakersDialog({
  clanId,
  issuer,
  onOpenChange,
  onEmit,
}: {
  clanId: string;
  issuer: ClientNfseIssuerView;
  onOpenChange: (open: boolean) => void;
  onEmit: (prefill: EmitPrefill) => void;
}) {
  const router = useRouter();
  const [reload, setReload] = useState(0);
  const { view, loading, error } = useIssuerCustomers(clanId, issuer.id, true, reload);
  useEffect(() => {
    if (!view?.historyReading) return;
    const timer = setInterval(() => setReload((value) => value + 1), 5000);
    return () => clearInterval(timer);
  }, [view?.historyReading]);
  const [query, setQuery] = useState("");
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(new Set());
  const [saving, startSaving] = useTransition();
  const [asking, startAsking] = useTransition();
  const customers = useMemo(() => view?.customers ?? [], [view]);
  const visible = useMemo(() => matchCustomers(customers, query), [customers, query]);
  const newOnes = customers.filter((customer) => !customer.registered);
  const chosen = newOnes.filter((customer) => !unchecked.has(customer.takerDocument));
  // Os já cadastrados, com as retenções de cada um (inclusive quem não veio das notas do Portal).
  const [editingRetentions, setEditingRetentions] = useState<ClientNfseIssuerView["takers"][number] | null>(null);
  const takerByDocument = useMemo(() => new Map(issuer.takers.map((taker) => [taker.document, taker])), [issuer.takers]);
  const visibleTakers = useMemo(() => {
    const documents = new Set(matchCustomers(issuer.takers.map((taker) => ({ takerDocument: taker.document, takerName: taker.name } as IssuerCustomer)), query).map((row) => row.takerDocument));
    return issuer.takers.filter((taker) => documents.has(taker.document));
  }, [issuer.takers, query]);

  function toggle(document: string) {
    setUnchecked((current) => {
      const next = new Set(current);
      if (next.has(document)) next.delete(document);
      else next.add(document);
      return next;
    });
  }

  function save() {
    startSaving(async () => {
      const result = await importTakers({ clanId, issuerId: issuer.id, documents: chosen.map((customer) => customer.takerDocument) });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${result.data?.created ?? 0} tomador(es) cadastrado(s).`);
      setReload((value) => value + 1);
      router.refresh();
    });
  }

  function askHistory() {
    startAsking(async () => {
      const result = await readIssuerHistory({ clanId, issuerId: issuer.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Busca iniciada. A lista será atualizada automaticamente.");
      setReload((value) => value + 1);
    });
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl" aria-busy={loading || saving}>
        <DialogHeader>
          <DialogTitle>Clientes / tomadores · {issuer.name}</DialogTitle>
          <DialogDescription>
            Clientes encontrados nas notas anteriores desta empresa. Você pode emitir direto para eles ou salvar os selecionados no cadastro.
          </DialogDescription>
        </DialogHeader>

        {view?.historyReading ? (
          <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning" role="status">
            <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin" aria-hidden />
            Buscando as notas antigas. Pode levar alguns minutos; esta lista se atualiza sozinha.
          </p>
        ) : view?.canReadHistory ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 p-3 text-sm">
            <span className="text-muted-foreground">Faltou algum cliente antigo? A aba XML só guarda notas a partir de um mês.</span>
            <Button type="button" size="sm" variant="outline" disabled={asking} onClick={askHistory}>
              {asking ? <LoaderCircle className="animate-spin" aria-hidden /> : <History aria-hidden />} Buscar notas antigas no Portal
            </Button>
          </div>
        ) : view ? (
          <p className="text-sm text-muted-foreground">Sem certificado válido desta empresa: envie na aba XML das notas para ler as notas dela no Portal.</p>
        ) : null}

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            placeholder="Buscar por nome ou CPF/CNPJ"
            aria-label="Buscar cliente"
            className="pl-8"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        {issuer.takers.length > 0 ? (
          <section className="grid gap-2" aria-label="Clientes cadastrados">
            <h3>Cadastrados ({issuer.takers.length})</h3>
            <ul className="grid divide-y rounded-md border">
              {visibleTakers.map((taker) => (
                <li key={taker.id} className="grid gap-2 px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <span className="grid min-w-0 gap-0.5">
                    <span className="truncate font-medium">{taker.name}</span>
                    <span className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                      <span className="font-mono tabular-nums">{formatCnpj(taker.document)}</span>
                      <span className={taker.retentions ? "text-warning" : undefined}>{retentionLabel(taker.retentions)}</span>
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-1 sm:justify-end">
                    <Button type="button" size="sm" variant="outline" onClick={() => setEditingRetentions(taker)}>
                      <Percent aria-hidden /> Retenções
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => onEmit({ document: taker.document, name: taker.name, address: taker.address, amount: taker.lastAmount, description: taker.lastDescription, retentions: taker.retentions })}
                    >
                      <Send aria-hidden /> Emitir
                    </Button>
                  </span>
                </li>
              ))}
              {visibleTakers.length === 0 ? <li className="px-3 py-3 text-sm text-muted-foreground">Nenhum cadastrado com esse nome ou documento.</li> : null}
            </ul>
          </section>
        ) : null}

        <h3>Nas notas do Portal</h3>
        {error ? <div role="alert" className="text-sm text-destructive"><p>{error}</p><Button type="button" variant="outline" onClick={() => setReload((value) => value + 1)}>Tentar novamente</Button></div> : view === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" aria-hidden /> Lendo as notas guardadas…
          </p>
        ) : customers.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma nota desta empresa guardada ainda.</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {customers.length} cliente(s) nas notas · {newOnes.length} ainda não cadastrado(s)
            </p>
            <ul className="grid divide-y rounded-md border">
              {visible.map((customer) => (
                <li key={customer.takerDocument} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 px-3 py-2 text-sm sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
                  {customer.registered ? (
                    <CheckCircle2 className="size-4 text-success" aria-label="Já cadastrado" />
                  ) : (
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={!unchecked.has(customer.takerDocument)}
                      onChange={() => toggle(customer.takerDocument)}
                      aria-label={`Cadastrar ${customer.takerName}`}
                    />
                  )}
                  <span className="grid min-w-0 gap-0.5">
                    <span className="truncate font-medium">{customer.takerName}</span>
                    <span className="flex flex-wrap gap-x-3 font-mono text-xs text-muted-foreground tabular-nums">
                      <span>{formatCnpj(customer.takerDocument)}</span>
                      <span>{customer.notes} nota(s) · última {monthYear(customer.lastIssuedAt)}</span>
                      {customer.amount ? <span>{formatBRLCurrency(customer.amount)}</span> : null}
                    </span>
                  </span>
                  <Button type="button" size="sm" variant="ghost" className="col-start-2 justify-self-start sm:col-start-3" onClick={() => onEmit({ ...customerPrefill(customer), retentions: takerByDocument.get(customer.takerDocument)?.retentions ?? null })}>
                    <Send aria-hidden /> Emitir
                  </Button>
                </li>
              ))}
              {visible.length === 0 ? <li className="px-3 py-3 text-sm text-muted-foreground">Nenhum cliente com esse nome ou documento.</li> : null}
            </ul>
          </>
        )}

        {editingRetentions ? <TakerRetentionsDialog clanId={clanId} taker={editingRetentions} onOpenChange={(open) => { if (!open) setEditingRetentions(null); }} /> : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
          <Button type="button" disabled={saving || chosen.length === 0} onClick={save}>
            {saving ? <LoaderCircle className="animate-spin" aria-hidden /> : <UserPlus aria-hidden />}
            {chosen.length === 0 ? "Todos cadastrados" : `Cadastrar ${chosen.length} tomador(es)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
