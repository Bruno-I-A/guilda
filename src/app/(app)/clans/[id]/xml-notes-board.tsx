"use client";

import { AlertTriangle, Check, ChevronLeft, ChevronRight, Download, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCnpj } from "@/domain/cnpj";
import { certificateState, emissionRangeLabel, summarizeCertificates } from "@/domain/nfse-xml";
import type { ClientCertificateView, XmlCompanyView, XmlRoutineView } from "@/lib/nfse/xml-requests";
import { cn } from "@/lib/utils";

import { ClientCertificateDialog } from "./client-certificate-dialog";
import { setClientNfseIssuer } from "./nfse-xml-actions";
import {
  RunXmlRoutineButton,
  useXmlAutoRefresh,
  XmlRoutineSettingsDialog,
  xmlRoutineIsRunning,
  xmlRoutineScheduleText,
  xmlRoutineStatusText,
  xmlTimeLabel,
} from "./xml-routine-settings";

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"] as const;

type Filter = "all" | "missing" | "problem" | "notes";

function adjacentPeriod(year: number, month: number, delta: number) {
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

function periodHref(clanId: string, year: number, month: number): string {
  return `/clans/${clanId}?tab=xml&fiscalYear=${year}&fiscalMonth=${month}`;
}

function xmlHref(clanId: string, year: number, month: number, clientId?: string): string {
  return `/api/nfse/xml?clanId=${clanId}&year=${year}&month=${month}${clientId ? `&clientId=${clientId}` : ""}`;
}

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function stateOf(certificate: ClientCertificateView | null, now: Date) {
  return certificateState({
    status: certificate?.status ?? null,
    validUntil: certificate?.validUntil ? new Date(certificate.validUntil) : null,
    now,
  });
}

/** A situação do certificado por extenso, com a cor do que pede ação. */
function CertificateStatus({ certificate, now }: { certificate: ClientCertificateView | null; now: Date }) {
  const { state, daysLeft } = stateOf(certificate, now);
  if (state === "missing") return <span className="text-muted-foreground">Sem certificado</span>;
  if (state === "pending") return <span className="text-muted-foreground">Conferindo o certificado…</span>;
  if (state === "invalid") return <span className="text-destructive">Problema: {certificate?.statusMessage ?? "envie de novo"}</span>;
  if (state === "expired") return <span className="text-destructive">Vencido em {dateLabel(certificate!.validUntil!)}</span>;
  if (state === "expiring") return <span className="text-warning">Vence em {daysLeft} dia(s) · {dateLabel(certificate!.validUntil!)}</span>;
  return <span className="text-success">Válido até {dateLabel(certificate!.validUntil!)}</span>;
}

/** O que a rotina fez nesta empresa. */
function SyncStatus({ company, now }: { company: XmlCompanyView; now: Date }) {
  const { state } = stateOf(company.certificate, now);
  if (state !== "valid" && state !== "expiring") return null;
  if (company.sync?.lastError) return <span className="text-destructive">Erro na leitura: {company.sync.lastError}</span>;
  if (!company.sync) return <span className="text-muted-foreground">Aguardando a primeira leitura</span>;
  if (!company.sync.initialSyncAt) return <span className="text-muted-foreground">Lendo o histórico…</span>;
  return <span className="text-muted-foreground">Lida em {xmlTimeLabel(company.sync.lastSyncedAt ?? company.sync.initialSyncAt)}</span>;
}

/** "É de serviço? Sim · Não": a Ficha manda; sem marcação, o CNAE sugere. */
function ServiceToggle({ clanId, company, canManage }: { clanId: string; company: XmlCompanyView; canManage: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { issues, source } = company.service;
  const note = source === "cnae" ? "sugerido pelo CNAE" : source === "none" ? "sem CNAE no cadastro" : "marcado na Ficha";

  function mark(value: boolean) {
    startTransition(async () => {
      const result = await setClientNfseIssuer({ clanId, clientId: company.clientId, issues: value });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(value ? `${company.name} marcada como de serviço.` : `${company.name} saiu da lista de serviço.`);
      router.refresh();
    });
  }

  return (
    <span className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">É de serviço?</span>
      {canManage ? (
        <span className="inline-flex border border-border/70" role="group" aria-label={`${company.name} emite NFS-e?`}>
          {([true, false] as const).map((value) => {
            const selected = issues === value;
            const confirmed = selected && source === "ficha";
            return (
              <button
                key={String(value)}
                type="button"
                aria-pressed={confirmed}
                disabled={pending || confirmed}
                onClick={() => mark(value)}
                className={cn(
                  "touch-target min-h-8 px-2.5 transition-colors hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default",
                  value ? "border-r border-border/70" : "",
                  selected && "bg-primary/10 text-primary",
                )}
              >
                {value ? "Sim" : "Não"}
              </button>
            );
          })}
        </span>
      ) : (
        <span>{issues === null ? "a classificar" : issues ? "Sim" : "Não"}</span>
      )}
      <span className="text-muted-foreground">({note})</span>
    </span>
  );
}

export function XmlNotesBoard({
  clanId,
  year,
  month,
  canManage,
  routine,
  companies,
  vaultKey,
}: {
  clanId: string;
  year: number;
  month: number;
  canManage: boolean;
  routine: XmlRoutineView;
  companies: readonly XmlCompanyView[];
  vaultKey: { keyId: string; publicKeySpki: string } | null;
}) {
  const now = useMemo(() => new Date(), []);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  // Padrão: só quem emite NFS-e (decisão de 2026-10-20). "Todas" serve para marcar as que faltam.
  const [scope, setScope] = useState<"service" | "all">("service");
  const monthName = MONTHS[month - 1];
  const title = `${monthName.charAt(0).toUpperCase()}${monthName.slice(1)} de ${year}`;
  const previous = adjacentPeriod(year, month, -1);
  const next = adjacentPeriod(year, month, 1);
  const running = routine.runRequested || xmlRoutineIsRunning(routine);
  const checking = companies.some((company) => company.certificate?.status === "pending");
  useXmlAutoRefresh(running || checking);

  const serviceCompanies = useMemo(() => companies.filter((company) => company.service.issues === true), [companies]);
  const scoped = scope === "service" ? serviceCompanies : companies;
  const summary = summarizeCertificates(
    serviceCompanies.map((company) => ({
      status: company.certificate?.status ?? null,
      validUntil: company.certificate?.validUntil ? new Date(company.certificate.validUntil) : null,
    })),
    now,
  );
  const ready = summary.valid + summary.expiring;
  const totalNotes = companies.reduce((sum, company) => sum + company.notes.total, 0);
  // Com problema: certificado recusado ou vencido, ou a última leitura falhou.
  const problemIds = useMemo(
    () =>
      new Set(
        companies
          .filter((company) => {
            const { state } = stateOf(company.certificate, now);
            return state === "invalid" || state === "expired" || Boolean(company.sync?.lastError);
          })
          .map((company) => company.clientId),
      ),
    [companies, now],
  );
  const counts: Record<Filter, number> = {
    all: scoped.length,
    missing: scoped.filter((company) => !company.certificate).length,
    problem: scoped.filter((company) => problemIds.has(company.clientId)).length,
    notes: scoped.filter((company) => company.notes.total > 0).length,
  };

  const steps = [
    {
      key: "certificates",
      label: "Certificados",
      detail: `${ready} de ${serviceCompanies.length} prontos${summary.pending > 0 ? ` · ${summary.pending} conferindo` : ""}`,
      done: ready > 0 && summary.pending === 0,
    },
    {
      key: "routine",
      label: "Rotina",
      detail: running ? "lendo agora…" : routine.lastRunFinishedAt ? `lida em ${xmlTimeLabel(routine.lastRunFinishedAt)}` : "ainda não rodou",
      done: Boolean(routine.lastRunFinishedAt) && !running,
    },
    {
      key: "download",
      label: `Baixar ${monthName}`,
      detail: `${totalNotes} nota(s) guardada(s)`,
      done: false,
    },
  ] as const;
  const current = steps.find((step) => !step.done)?.key ?? "download";

  const visible = useMemo(() => {
    const needle = normalize(query.trim());
    const digits = query.replace(/\D/g, "");
    return scoped.filter((company) => {
      if (needle && !normalize(company.name).includes(needle) && !(digits && company.cnpj?.includes(digits))) return false;
      if (filter === "missing") return !company.certificate;
      if (filter === "problem") return problemIds.has(company.clientId);
      if (filter === "notes") return company.notes.total > 0;
      return true;
    });
  }, [scoped, filter, problemIds, query]);

  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: "Sem filtro" },
    { key: "missing", label: "Sem certificado" },
    { key: "problem", label: "Com problema" },
    { key: "notes", label: `Com notas em ${monthName}` },
  ];

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button asChild variant="outline" size="icon-sm">
            <Link href={periodHref(clanId, previous.year, previous.month)} aria-label="Mês anterior"><ChevronLeft aria-hidden /></Link>
          </Button>
          <h2 className="px-2">{title}</h2>
          <Button asChild variant="outline" size="icon-sm">
            <Link href={periodHref(clanId, next.year, next.month)} aria-label="Próximo mês"><ChevronRight aria-hidden /></Link>
          </Button>
        </div>
      </div>

      <p className="max-w-prose text-sm text-muted-foreground">
        Como funciona: envie o certificado A1 de cada empresa que emite NFS-e. A rotina busca no Sistema Nacional as notas
        que ela emitiu e guarda os XML aqui, por mês de emissão. No dia de apurar, é só baixar o mês.
      </p>

      {!routine.vaultReady ? (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning" role="status">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            O serviço fiscal ainda não publicou a chave para receber certificados. Confira se a NFSE_VAULT_PRIVATE_KEY está no
            guilda-fiscal e se ele foi reimplantado; em seguida esta tela libera o envio.
          </p>
        </div>
      ) : null}

      <ol className="grid grid-cols-1 gap-2 sm:grid-cols-3" aria-label="Passos do XML das notas">
        {steps.map((step, index) => {
          const isCurrent = step.key === current;
          return (
            <li
              key={step.key}
              aria-current={isCurrent ? "step" : undefined}
              className={cn(
                "grid gap-0.5 rounded-md border p-3 text-sm",
                step.done && "border-success/40 bg-success/10 text-success",
                isCurrent && "border-primary text-primary ring-1 ring-primary",
                !step.done && !isCurrent && "text-muted-foreground",
              )}
            >
              <span className="flex items-center gap-1.5 font-medium">
                {step.done ? <Check className="size-3.5" aria-hidden /> : <span className="font-mono text-xs">{index + 1}.</span>}
                {step.label}
              </span>
              <span className="font-mono text-xs tabular-nums">{step.detail}</span>
            </li>
          );
        })}
      </ol>

      <section className="grid gap-3 border-y py-3" aria-live="polite">
        <div className="grid gap-1 text-sm">
          {current === "certificates" ? (
            <p>
              <strong>Próximo passo:</strong> na lista abaixo, clique em <strong>Enviar certificado</strong> na empresa e escolha o
              arquivo .pfx com a senha. Comece por uma empresa e confira antes de cadastrar as outras.
            </p>
          ) : current === "routine" ? (
            <p>
              <strong>Próximo passo:</strong> clique em <strong>Rodar agora</strong> para a primeira leitura. Nas empresas com muito
              movimento ela pode levar alguns minutos; a tela se atualiza sozinha.
            </p>
          ) : (
            <p>
              <strong>Pronto para baixar:</strong> o arquivo traz uma pasta por empresa, com as notas {emissionRangeLabel(year, month)}.
            </p>
          )}
          <p className="text-muted-foreground">
            Rotina: {xmlRoutineScheduleText(routine.schedule)} · {xmlRoutineStatusText(routine)}
            {routine.keepSince ? ` · guarda notas a partir de ${routine.keepSince.slice(5, 7)}/${routine.keepSince.slice(0, 4)}` : ""}
          </p>
        </div>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <RunXmlRoutineButton clanId={clanId} routine={routine} primary={current === "routine"} />
            <XmlRoutineSettingsDialog clanId={clanId} routine={routine} />
            <Button asChild variant={current === "download" ? "default" : "outline"} className="h-auto min-h-9 max-w-full whitespace-normal text-left">
              <a href={xmlHref(clanId, year, month)}>
                <Download aria-hidden /> Baixar XML — {emissionRangeLabel(year, month)} ({totalNotes})
              </a>
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Só integrantes do Fiscal e admins enviam certificados e baixam os XML.</p>
        )}
      </section>

      <section className="grid min-w-0 gap-3">
        <h2>Empresas</h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Quais empresas mostrar">
            <Button type="button" size="sm" variant={scope === "service" ? "default" : "outline"} aria-pressed={scope === "service"} onClick={() => setScope("service")}>
              Empresas de serviço ({serviceCompanies.length})
            </Button>
            <Button type="button" size="sm" variant={scope === "all" ? "default" : "outline"} aria-pressed={scope === "all"} onClick={() => setScope("all")}>
              Todas ({companies.length})
            </Button>
          </div>
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              name="xml-company-search"
              // A senha do certificado no diálogo fazia o navegador achar que era
              // um login e preencher o e-mail da pessoa aqui.
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
        </div>
        <ul className="grid grid-cols-2 gap-px border border-border/70 bg-border/40 sm:grid-cols-4" aria-label="Filtrar empresas">
          {filters.map((item) => {
            const selected = filter === item.key;
            return (
              <li key={item.key} className="min-w-0">
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setFilter(item.key)}
                  className={cn(
                    "grid min-h-11 w-full content-center gap-0.5 bg-card/60 px-3 py-2 text-left transition-colors hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    selected && "bg-primary/10 shadow-[inset_0_2px_0_var(--primary)]",
                  )}
                >
                  <span className={cn("hud-label", selected && "!text-primary")}>{item.label}</span>
                  <span className="font-mono text-sm tabular-nums">{counts[item.key]}</span>
                </button>
              </li>
            );
          })}
        </ul>

        {visible.length === 0 ? (
          <div className="grid justify-items-center gap-2 rounded-lg border border-dashed p-8 text-center text-sm">
            <p className="font-medium">
              {scope === "service" && serviceCompanies.length === 0
                ? "Nenhuma empresa de serviço ainda."
                : "Nenhuma empresa neste filtro."}
            </p>
            {scope === "service" && serviceCompanies.length === 0 ? (
              <>
                <p className="max-w-prose text-muted-foreground">
                  A lista sai do CNAE principal ou da marcação na Ficha Fiscal. Em Todas, marque as que emitem NFS-e.
                </p>
                <Button type="button" variant="outline" size="sm" onClick={() => setScope("all")}>
                  Ver todas
                </Button>
              </>
            ) : null}
            {filter !== "all" || query ? (
              <Button type="button" variant="outline" size="sm" onClick={() => { setFilter("all"); setQuery(""); }}>
                Limpar filtro
              </Button>
            ) : null}
          </div>
        ) : (
          <ul className="grid min-w-0 divide-y border-y">
            {visible.map((company) => (
              <li key={company.clientId} className="grid min-w-0 gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="grid min-w-0 gap-0.5 text-sm">
                  <span className="truncate font-medium">{company.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{company.cnpj ? formatCnpj(company.cnpj) : "sem CNPJ no cadastro"}</span>
                  <span><CertificateStatus certificate={company.certificate} now={now} /></span>
                  <span className="text-xs"><SyncStatus company={company} now={now} /></span>
                  <ServiceToggle clanId={clanId} company={company} canManage={canManage} />
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {company.notes.total} nota(s) em {monthName}
                    {company.notes.cancelled > 0 ? ` · ${company.notes.cancelled} cancelada(s)` : ""}
                  </span>
                  {canManage && company.notes.total > 0 ? (
                    <Button asChild size="sm" variant="outline">
                      <a href={xmlHref(clanId, year, month, company.clientId)}><Download aria-hidden /> Baixar XML</a>
                    </Button>
                  ) : null}
                  <ClientCertificateDialog
                    clanId={clanId}
                    clientId={company.clientId}
                    clientName={company.name}
                    certificate={company.certificate}
                    vaultKey={vaultKey}
                    canManage={canManage}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
