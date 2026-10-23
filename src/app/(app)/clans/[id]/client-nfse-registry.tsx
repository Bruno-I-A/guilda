"use client";

import { AlertTriangle, CheckCircle2, FileDown, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCnpj } from "@/domain/cnpj";
import type { ClientNfseCandidateView, ClientNfseIssuerView } from "@/lib/client-nfse/loaders";
import { formatBRLCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

import { deleteIssuer } from "./client-nfse-actions";
import { ClientNfseModelDialog, ClientNfseTakerDialog } from "./client-nfse-forms";
import { ClientNfseIssuerDialog } from "./client-nfse-issuer-dialog";
import { ClientNfseSuggestionsDialog } from "./client-nfse-suggestions";

function addressLine(address: ClientNfseIssuerView["takers"][number]["address"]): string | null {
  if (!address) return null;
  const parts = [address.street && `${address.street}${address.number ? `, ${address.number}` : ""}`, address.district, address.city && `${address.city}${address.state ? `/${address.state}` : ""}`];
  return parts.filter(Boolean).join(" · ") || null;
}

function IssuerCard({ clanId, issuer, canManage, period }: { clanId: string; issuer: ClientNfseIssuerView; canManage: boolean; period: { year: number; month: number } }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [suggesting, setSuggesting] = useState(false);
  const activeModels = issuer.models.filter((model) => model.active);
  const total = activeModels.reduce((sum, model) => sum + Number(model.amount), 0);

  function remove() {
    if (!window.confirm(`Tirar ${issuer.name} das Notas dos clientes? Tomadores e notas padrão saem junto. Com nota já pedida, desative no modelo fiscal.`)) return;
    startTransition(async () => {
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
    <section className={cn("grid min-w-0 gap-3 rounded-md border bg-card/50 p-3", !issuer.active && "opacity-70")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid min-w-0 gap-0.5">
          <h3 className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate">{issuer.name}</span>
            {!issuer.active ? <Badge variant="outline">desativada</Badge> : null}
          </h3>
          <span className="font-mono text-xs text-muted-foreground">
            {issuer.cnpj ? formatCnpj(issuer.cnpj) : "sem CNPJ"} · série {issuer.dpsSeries} · próxima DPS {issuer.nextDpsNumber}
          </span>
          {issuer.problem ? (
            <span className="flex items-start gap-1.5 text-xs text-warning"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {issuer.problem}</span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-success"><CheckCircle2 className="size-3.5" aria-hidden /> Pronta para emitir</span>
          )}
        </div>
        {canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            <ClientNfseIssuerDialog clanId={clanId} issuer={issuer} />
            <ClientNfseTakerDialog clanId={clanId} issuerId={issuer.id} taker={null} />
            <ClientNfseModelDialog clanId={clanId} issuer={issuer} model={null} period={period} />
            <Button type="button" variant="outline" size="sm" onClick={() => setSuggesting(true)}>
              <FileDown aria-hidden /> Importar das notas emitidas
            </Button>
            <ClientNfseSuggestionsDialog clanId={clanId} issuer={issuer} open={suggesting} onOpenChange={setSuggesting} />
            <Button type="button" variant="ghost" size="icon-sm" className="touch-target text-destructive" disabled={pending} aria-label={`Tirar ${issuer.name} das Notas dos clientes`} onClick={remove}>
              <Trash2 aria-hidden />
            </Button>
          </div>
        ) : null}
      </div>

      <div className="grid gap-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="hud-label">Notas padrão</p>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {activeModels.length} ativa(s) · {formatBRLCurrency(total.toFixed(2))} por mês
          </span>
        </div>
        {issuer.models.length === 0 ? (
          <p className="text-sm text-muted-foreground">{issuer.takers.length === 0 ? "Cadastre um tomador e depois a nota que sai todo mês para ele." : "Nenhuma nota padrão ainda."}</p>
        ) : (
          <ul className="grid divide-y border-y">
            {issuer.models.map((model) => (
              <li key={model.id} className={cn("grid min-w-0 gap-1 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center", !model.active && "text-muted-foreground")}>
                <div className="grid min-w-0 gap-0.5 text-sm">
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="truncate font-medium">{model.takerName}</span>
                    <Badge variant="outline" className="text-xs">{model.reference === "previous" ? "mês anterior" : "próprio mês"}</Badge>
                    {model.service ? <Badge variant="outline" className="text-xs">serviço {model.service.nationalTaxCode}</Badge> : null}
                    {!model.active ? <Badge variant="outline" className="text-xs">pausada</Badge> : null}
                  </span>
                  <span className="line-clamp-2 text-xs text-muted-foreground">{model.description}</span>
                </div>
                <div className="flex items-center gap-2 sm:justify-end">
                  <span className="font-mono text-sm tabular-nums">{formatBRLCurrency(model.amount)}</span>
                  {canManage ? <ClientNfseModelDialog clanId={clanId} issuer={issuer} model={model} period={period} /> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <details className="group grid gap-1">
        <summary className="cursor-pointer list-none text-sm">
          <span className="hud-label">Tomadores</span> <span className="font-mono text-xs text-muted-foreground">({issuer.takers.length})</span>
          <span className="ml-2 text-xs text-primary group-open:hidden">mostrar</span>
        </summary>
        {issuer.takers.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum tomador ainda.</p>
        ) : (
          <ul className="mt-1 grid divide-y border-y">
            {issuer.takers.map((taker) => (
              <li key={taker.id} className={cn("grid min-w-0 gap-1 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center", !taker.active && "text-muted-foreground")}>
                <div className="grid min-w-0 gap-0.5 text-sm">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate font-medium">{taker.name}</span>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">{formatCnpj(taker.document)}</span>
                    {!taker.active ? <Badge variant="outline" className="text-xs">inativo</Badge> : null}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{addressLine(taker.address) ?? "sem endereço"}</span>
                </div>
                {canManage ? <ClientNfseTakerDialog clanId={clanId} issuerId={issuer.id} taker={taker} /> : null}
              </li>
            ))}
          </ul>
        )}
      </details>
    </section>
  );
}

/** Cadastro: as empresas que emitem, os tomadores de cada uma e as notas que se repetem. */
export function ClientNfseRegistry({
  clanId,
  canManage,
  issuers,
  candidates,
  period,
}: {
  clanId: string;
  canManage: boolean;
  issuers: readonly ClientNfseIssuerView[];
  candidates: readonly ClientNfseCandidateView[];
  period: { year: number; month: number };
}) {
  // Empresa recém-adicionada: oferece na hora as notas padrão tiradas das notas emitidas.
  const [created, setCreated] = useState<{ id: string; clientId: string; name: string } | null>(null);
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-1">
          <h2>Empresas emissoras <span className="font-mono text-sm font-normal text-muted-foreground">{issuers.length}</span></h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            Cada empresa emite pelo próprio CNPJ, com o certificado A1 enviado na aba XML das notas. Cadastre os tomadores dela e as
            notas que se repetem todo mês; no Mês a mês, a Guilda monta tudo para você revisar e emitir.
          </p>
        </div>
        {canManage ? <ClientNfseIssuerDialog clanId={clanId} issuer={null} candidates={candidates} onCreated={setCreated} /> : null}
        {created ? (
          <ClientNfseSuggestionsDialog clanId={clanId} issuer={created} open onOpenChange={(open) => { if (!open) setCreated(null); }} />
        ) : null}
      </div>
      {issuers.length === 0 ? (
        <div className="grid justify-items-center gap-2 rounded-lg border border-dashed p-8 text-center text-sm">
          <p className="font-medium">Nenhuma empresa emissora ainda.</p>
          <p className="max-w-prose text-muted-foreground">Adicione a primeira empresa e confira o modelo fiscal com uma nota que ela já emitiu no Portal Nacional.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {issuers.map((issuer) => (
            <IssuerCard key={issuer.id} clanId={clanId} issuer={issuer} canManage={canManage} period={period} />
          ))}
        </div>
      )}
    </div>
  );
}
