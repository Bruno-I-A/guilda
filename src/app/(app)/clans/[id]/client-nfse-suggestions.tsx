"use client";

import { FileDown, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCnpj } from "@/domain/cnpj";
import type { IssuerSuggestion } from "@/lib/client-nfse/suggest";
import { formatBRLCurrency } from "@/lib/currency";
import { formatAppDate } from "@/lib/date-time";
import { cn } from "@/lib/utils";

import { importSuggestions, suggestIssuerSetup } from "./client-nfse-actions";

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"] as const;

function monthLabel(key: string | null): string {
  if (!key) return "";
  const [year, month] = key.split("-").map(Number);
  return `${MONTHS[month - 1]} de ${year}`;
}

/**
 * As notas que a empresa emitiu no último mês, como notas padrão para marcar.
 * Vêm marcadas as que também saíram no mês anterior (as que se repetem).
 */
export function ClientNfseSuggestionsDialog({
  clanId,
  issuer,
  open,
  onOpenChange,
}: {
  clanId: string;
  issuer: { id: string; clientId: string; name: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [suggestion, setSuggestion] = useState<IssuerSuggestion | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [loading, startLoading] = useTransition();
  const [saving, startSaving] = useTransition();

  useEffect(() => {
    if (!open) return;
    startLoading(async () => {
      const result = await suggestIssuerSetup({ clanId, clientId: issuer.clientId, issuerId: issuer.id });
      if (!result.ok || !result.data) {
        toast.error(result.ok ? "Sem sugestões." : result.error);
        return;
      }
      setSuggestion(result.data);
      setSelected(new Set(result.data.models.filter((model) => model.recurring).map((model) => model.key)));
    });
  }, [open, clanId, issuer.clientId, issuer.id]);

  // Fechar limpa a sugestão: reabrir lê de novo, sem mostrar a da vez anterior.
  function changeOpen(next: boolean) {
    if (!next) setSuggestion(null);
    onOpenChange(next);
  }

  const models = suggestion?.models ?? [];
  const chosen = models.filter((model) => selected.has(model.key));
  const total = chosen.reduce((sum, model) => sum + Number(model.amount), 0);

  function toggle(key: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function save() {
    startSaving(async () => {
      const result = await importSuggestions({
        clanId,
        issuerId: issuer.id,
        items: chosen.map(({ takerDocument, takerName, address, amount, description, reference }) => ({ takerDocument, takerName, address, amount, description, reference })),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${result.data?.models ?? chosen.length} nota(s) padrão cadastrada(s), com ${result.data?.takers ?? 0} tomador(es) novo(s).`);
      changeOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Notas padrão pelas notas emitidas · {issuer.name}</DialogTitle>
          <DialogDescription>
            {suggestion?.basedOn.month
              ? `As notas que a empresa emitiu em ${monthLabel(suggestion.basedOn.month)} (a última em ${formatAppDate(suggestion.basedOn.lastIssuedAt!)}). Vêm marcadas as que também saíram no mês anterior; confira valor e descrição antes de confirmar.`
              : "Lendo as notas que a rotina da aba XML guardou desta empresa."}
          </DialogDescription>
        </DialogHeader>
        {loading && !suggestion ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" aria-hidden /> Lendo as notas emitidas…</p>
        ) : suggestion && models.length === 0 ? (
          <p className="rounded-md border p-3 text-sm text-muted-foreground">
            {suggestion.basedOn.notes === 0
              ? "Nenhuma nota desta empresa guardada nos últimos meses. Confira na aba XML das notas se o certificado está válido e se a rotina já rodou; ou cadastre as notas padrão à mão."
              : "As notas do último mês já estão cadastradas como notas padrão."}
          </p>
        ) : suggestion ? (
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground">{models.length} nota(s) no último mês</span>
              <span className="flex gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(new Set(models.map((model) => model.key)))}>Marcar todas</Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Desmarcar</Button>
              </span>
            </div>
            <ul className="max-h-[50dvh] divide-y overflow-auto rounded-md border">
              {models.map((model) => (
                <li key={model.key}>
                  <label className={cn("flex cursor-pointer items-start gap-3 px-3 py-2 text-sm hover:bg-muted/30", !selected.has(model.key) && "text-muted-foreground")}>
                    <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-primary" checked={selected.has(model.key)} disabled={saving} onChange={() => toggle(model.key)} />
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="truncate font-medium">{model.takerName}</span>
                        <span className="font-mono text-xs text-muted-foreground">{formatCnpj(model.takerDocument)}</span>
                        {model.recurring ? <Badge variant="outline" className="text-xs">repete todo mês</Badge> : null}
                      </span>
                      <span className="line-clamp-2 text-xs text-muted-foreground">{model.description}</span>
                    </span>
                    <span className="font-mono tabular-nums">{formatBRLCurrency(model.amount)}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => changeOpen(false)}>{models.length === 0 ? "Fechar" : "Agora não"}</Button>
          {models.length > 0 ? (
            <Button type="button" disabled={saving || chosen.length === 0} onClick={save}>
              {saving ? <LoaderCircle className="animate-spin" aria-hidden /> : <FileDown aria-hidden />}
              Cadastrar {chosen.length} {chosen.length === 1 ? "nota" : "notas"} · <span className="font-mono tabular-nums">{formatBRLCurrency(total.toFixed(2))}</span>
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
