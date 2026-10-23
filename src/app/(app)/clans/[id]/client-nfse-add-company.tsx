"use client";

import { Building2, Check, ChevronDown, LoaderCircle, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatCnpj } from "@/domain/cnpj";
import type { ClientNfseCandidateView, IssuerSuggestionView } from "@/lib/client-nfse/loaders";
import { formatBRLCurrency } from "@/lib/currency";
import { formatAppDate } from "@/lib/date-time";
import { cn } from "@/lib/utils";

import { saveIssuer, suggestIssuerSetup } from "./client-nfse-actions";
import { FiscalFields, FiscalSummary, fiscalFormToTemplate, initialFiscalForm, type FiscalForm } from "./client-nfse-fiscal-form";

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"] as const;

const CERTIFICATE: Record<ClientNfseCandidateView["certificate"], { label: string; className: string }> = {
  valid: { label: "certificado ok", className: "border-success/40 text-success" },
  pending: { label: "certificado em conferência", className: "border-warning/40 text-warning" },
  invalid: { label: "certificado com problema", className: "border-destructive/40 text-destructive" },
  missing: { label: "sem certificado", className: "border-border text-muted-foreground" },
};

function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function monthLabel(key: string | null): string {
  if (!key) return "";
  const [year, month] = key.split("-").map(Number);
  return `${MONTHS[month - 1]} de ${year}`;
}

/**
 * Adicionar empresa num quadro só: escolher a empresa, conferir os dados
 * fiscais lidos da última nota dela e marcar as notas que viram notas padrão.
 */
export function ClientNfseAddCompany({ clanId, candidates }: { clanId: string; candidates: readonly ClientNfseCandidateView[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [company, setCompany] = useState<ClientNfseCandidateView | null>(null);
  const [suggestion, setSuggestion] = useState<IssuerSuggestionView | null>(null);
  const [form, setForm] = useState<FiscalForm>(() => initialFiscalForm(null));
  const [series, setSeries] = useState("900");
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [reading, startReading] = useTransition();
  const [saving, startSaving] = useTransition();

  const visible = useMemo(() => {
    const needle = normalize(query.trim());
    const digits = query.replace(/\D/g, "");
    return candidates.filter((item) => !needle || normalize(item.name).includes(needle) || (digits.length > 2 && item.cnpj.includes(digits)));
  }, [candidates, query]);

  function reset() {
    setQuery("");
    setCompany(null);
    setSuggestion(null);
    setEditing(false);
    setSelected(new Set());
  }

  function pick(item: ClientNfseCandidateView) {
    setCompany(item);
    setSuggestion(null);
    setForm(initialFiscalForm(null, item.suggestion));
    setSeries("900");
    setEditing(false);
    startReading(async () => {
      const result = await suggestIssuerSetup({ clanId, clientId: item.clientId, issuerId: null });
      if (!result.ok || !result.data) {
        toast.error(result.ok ? "Não foi possível ler as notas." : result.error);
        setEditing(true);
        return;
      }
      const data = result.data;
      setSuggestion(data);
      setSeries(data.dpsSeries);
      if (data.template) setForm(initialFiscalForm(data.template, item.suggestion));
      else setEditing(true);
      setSelected(new Set(data.models.filter((model) => model.recurring).map((model) => model.key)));
    });
  }

  function toggle(key: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const models = suggestion?.models ?? [];
  const chosen = models.filter((model) => selected.has(model.key));
  const total = chosen.reduce((sum, model) => sum + Number(model.amount), 0);

  function save() {
    if (!company) return;
    startSaving(async () => {
      const result = await saveIssuer({
        clanId,
        issuerId: null,
        clientId: company.clientId,
        template: fiscalFormToTemplate(form),
        dpsSeries: series,
        active: true,
        notes: chosen.map(({ takerDocument, takerName, address, amount, description, reference }) => ({ takerDocument, takerName, address, amount, description, reference })),
      });
      if (!result.ok) {
        toast.error(result.error);
        setEditing(true);
        return;
      }
      const notes = result.data?.notes ?? 0;
      toast.success(notes > 0 ? `${company.name} adicionada com ${notes} nota(s) padrão.` : `${company.name} adicionada. Agora cadastre as notas dela.`);
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) reset(); setOpen(next); }}>
      <DialogTrigger asChild>
        <Button type="button"><Building2 aria-hidden /> Adicionar empresa</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Adicionar empresa</DialogTitle>
          <DialogDescription>A Guilda lê as notas que a empresa já emitiu (guardadas na aba XML) e preenche o resto.</DialogDescription>
        </DialogHeader>

        <section className="grid gap-2">
          <h3>1. Empresa</h3>
          {company ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2">
              <span className="grid min-w-0">
                <span className="truncate font-medium">{company.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{formatCnpj(company.cnpj)}</span>
              </span>
              <span className="flex items-center gap-2">
                <Badge variant="outline" className={CERTIFICATE[company.certificate].className}>{CERTIFICATE[company.certificate].label}</Badge>
                <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={reset}>Trocar</Button>
              </span>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  type="search"
                  autoComplete="off"
                  data-1p-ignore
                  data-lpignore="true"
                  placeholder="Buscar por nome ou CNPJ"
                  aria-label="Buscar empresa"
                  className="pl-8"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <ul className="max-h-60 divide-y overflow-auto rounded-md border">
                {visible.slice(0, 80).map((item) => (
                  <li key={item.clientId}>
                    <button type="button" className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none" onClick={() => pick(item)}>
                      <span className="grid min-w-0">
                        <span className="truncate">{item.name}</span>
                        <span className="font-mono text-xs text-muted-foreground">{formatCnpj(item.cnpj)}</span>
                      </span>
                      <Badge variant="outline" className={cn("shrink-0 text-xs", CERTIFICATE[item.certificate].className)}>{CERTIFICATE[item.certificate].label}</Badge>
                    </button>
                  </li>
                ))}
                {visible.length === 0 ? <li className="px-3 py-3 text-sm text-muted-foreground">Nenhuma empresa encontrada (só entram ativas, com CNPJ e fora do MEI).</li> : null}
              </ul>
            </>
          )}
        </section>

        {company ? (
          <section className="grid gap-2" aria-busy={reading}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3>2. Dados fiscais</h3>
              {reading ? (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" aria-hidden /> Lendo as notas emitidas…</span>
              ) : suggestion?.template ? (
                <span className="text-xs text-muted-foreground">Lidos da nota de {formatAppDate(suggestion.basedOn.lastIssuedAt!)}. Confira.</span>
              ) : (
                <span className="text-xs text-warning">Sem nota guardada desta empresa: preencha com uma nota do Portal.</span>
              )}
            </div>
            {!reading ? (
              <>
                <FiscalSummary form={form} series={series} cityLabel={suggestion?.template ? suggestion.cityLabel : null} />
                <Button type="button" variant="ghost" size="sm" className="justify-self-start" aria-expanded={editing} onClick={() => setEditing((value) => !value)}>
                  <ChevronDown className={cn("transition-transform", editing && "rotate-180")} aria-hidden /> {editing ? "Fechar edição" : "Editar dados fiscais"}
                </Button>
                {editing ? <FiscalFields form={form} onChange={setForm} series={series} onSeriesChange={setSeries} /> : null}
              </>
            ) : null}
          </section>
        ) : null}

        {company && !reading ? (
          <section className="grid gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3>3. Notas que se repetem</h3>
              {models.length > 0 ? (
                <span className="flex gap-1">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(new Set(models.map((model) => model.key)))}>Marcar todas</Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Desmarcar</Button>
                </span>
              ) : null}
            </div>
            {models.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma nota recente para sugerir. Depois de adicionar, use “+ Nova nota” no quadro da empresa.</p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  As notas de {monthLabel(suggestion?.basedOn.month ?? null)}. Vêm marcadas as que também saíram no mês anterior; o mês na descrição vira {"{mes}"}.
                </p>
                <ul className="max-h-[40dvh] divide-y overflow-auto rounded-md border">
                  {models.map((model) => (
                    <li key={model.key}>
                      <label className={cn("flex cursor-pointer items-start gap-3 px-3 py-2 text-sm hover:bg-muted/30", !selected.has(model.key) && "text-muted-foreground")}>
                        <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-primary" checked={selected.has(model.key)} disabled={saving} onChange={() => toggle(model.key)} />
                        <span className="grid min-w-0 flex-1 gap-0.5">
                          <span className="flex min-w-0 flex-wrap items-center gap-2">
                            <span className="truncate font-medium">{model.takerName}</span>
                            {model.recurring ? <Badge variant="outline" className="text-xs">repete</Badge> : null}
                          </span>
                          <span className="line-clamp-1 text-xs text-muted-foreground">{model.description}</span>
                        </span>
                        <span className="font-mono tabular-nums">{formatBRLCurrency(model.amount)}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>Voltar</Button>
          <Button type="button" disabled={!company || reading || saving} onClick={save}>
            {saving ? <LoaderCircle className="animate-spin" aria-hidden /> : <Check aria-hidden />}
            {chosen.length > 0 ? (
              <>Adicionar empresa e {chosen.length} {chosen.length === 1 ? "nota" : "notas"} · <span className="font-mono tabular-nums">{formatBRLCurrency(total.toFixed(2))}</span></>
            ) : (
              "Adicionar empresa"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
