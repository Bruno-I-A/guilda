"use client";

import { CheckCircle2, LoaderCircle, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatCnpj } from "@/domain/cnpj";
import type { ClientNfseIssuerView } from "@/lib/client-nfse/loaders";
import type { IssuerCustomer } from "@/lib/client-nfse/suggest";
import { formatBRLCurrency } from "@/lib/currency";

import { listIssuerCustomers } from "./client-nfse-actions";

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
export function useIssuerCustomers(clanId: string, issuerId: string, enabled: boolean) {
  const [customers, setCustomers] = useState<IssuerCustomer[] | null>(null);
  const [loading, startLoading] = useTransition();
  useEffect(() => {
    if (!enabled) return;
    startLoading(async () => {
      const result = await listIssuerCustomers({ clanId, issuerId });
      if (!result.ok || !result.data) {
        toast.error(result.ok ? "Não consegui ler os clientes." : result.error);
        return;
      }
      setCustomers(result.data);
    });
  }, [clanId, issuerId, enabled]);
  return { customers, loading };
}

/**
 * Clientes já atendidos: todo tomador das notas que a empresa emitiu no
 * Sistema Nacional, com a marca de quem já tem nota padrão. Escolher um abre
 * a nota padrão preenchida; nada é gravado sem o Fiscal salvar.
 */
export function ClientNfseCustomersDialog({
  clanId,
  issuer,
  onOpenChange,
  onPick,
}: {
  clanId: string;
  issuer: ClientNfseIssuerView;
  onOpenChange: (open: boolean) => void;
  onPick: (customer: IssuerCustomer) => void;
}) {
  const { customers, loading } = useIssuerCustomers(clanId, issuer.id, true);
  const [query, setQuery] = useState("");
  const visible = useMemo(() => matchCustomers(customers ?? [], query), [customers, query]);
  const pending = (customers ?? []).filter((customer) => !customer.registered).length;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl" aria-busy={loading}>
        <DialogHeader>
          <DialogTitle>Clientes já atendidos · {issuer.name}</DialogTitle>
          <DialogDescription>
            Quem já recebeu nota desta empresa no Sistema Nacional, pelas notas que a aba XML guardou. Escolha um para virar nota
            padrão já preenchida.
          </DialogDescription>
        </DialogHeader>
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
        {customers === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" aria-hidden /> Lendo as notas guardadas…
          </p>
        ) : customers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma nota desta empresa guardada ainda. Envie o certificado e rode a rotina na aba XML das notas.
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {customers.length} cliente(s) · {pending} sem nota padrão
            </p>
            <ul className="grid divide-y rounded-md border">
              {visible.map((customer) => (
                <li key={customer.takerDocument} className="grid gap-2 px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <span className="grid min-w-0 gap-0.5">
                    <span className="truncate font-medium">{customer.takerName}</span>
                    <span className="flex flex-wrap gap-x-3 font-mono text-xs text-muted-foreground tabular-nums">
                      <span>{formatCnpj(customer.takerDocument)}</span>
                      <span>{customer.notes} nota(s) · última {monthYear(customer.lastIssuedAt)}</span>
                      {customer.amount ? <span>{formatBRLCurrency(customer.amount)}</span> : null}
                    </span>
                    {customer.description ? <span className="truncate text-xs text-muted-foreground">{customer.description}</span> : null}
                  </span>
                  <span className="flex flex-wrap items-center gap-2 sm:justify-end">
                    {customer.registered ? (
                      <span className="flex items-center gap-1 text-xs text-success"><CheckCircle2 className="size-3.5" aria-hidden /> já tem nota padrão</span>
                    ) : null}
                    <Button type="button" size="sm" variant={customer.registered ? "ghost" : "outline"} onClick={() => onPick(customer)}>
                      <Plus aria-hidden /> {customer.registered ? "Outra nota" : "Virar nota padrão"}
                    </Button>
                  </span>
                </li>
              ))}
              {visible.length === 0 ? <li className="px-3 py-3 text-sm text-muted-foreground">Nenhum cliente com esse nome ou documento.</li> : null}
            </ul>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
