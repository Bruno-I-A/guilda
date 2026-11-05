"use client";

import { Check, ChevronLeft, ChevronRight, Download, FilePlus2, LoaderCircle, RefreshCw, CalendarPlus, FileCheck2, Clock3, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { FiscalStepStatus } from "@/domain/fiscal-control";
import { cn } from "@/lib/utils";
import { formatBRLCurrency } from "@/lib/currency";
import styles from "./office-fee.module.css";

import { NfseEmitDialog, NfseNotice, nfseHealth, nfsePdfHref, type NfseInvoiceView, type NfseSettingsPanelView } from "./nfse-parts";
import { openOfficeFeeControlPeriod } from "./office-fee-actions";
import { OfficeFeeControlBoard, type NfseInvoicesByControl, type OfficeFeeControlRowView } from "./office-fee-control-board";

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"] as const;

type StepKey = "register" | "open" | "emit" | "collect";

interface Step {
  key: StepKey;
  label: string;
  detail: string;
  done: boolean;
}

function adjacentPeriod(year: number, month: number, delta: number) {
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

function monthHref(clanId: string, year: number, month: number): string {
  return `/clans/${clanId}?tab=fees&fiscalYear=${year}&fiscalMonth=${month}`;
}

function isDone(status: FiscalStepStatus): boolean {
  return status === "completed" || status === "not_applicable";
}

/**
 * O mês dos honorários como uma sequência: cadastro → abrir o mês → emitir
 * notas → cobrança. O botão principal é sempre o próximo passo, para a tela
 * dizer o que fazer em vez de esperar que a pessoa descubra a ordem.
 */
export function OfficeFeeMonth({
  clanId,
  year,
  month,
  canManage,
  isAdmin,
  profilesCount,
  members,
  rows,
  settings,
  invoices,
}: {
  clanId: string;
  year: number;
  month: number;
  canManage: boolean;
  isAdmin: boolean;
  profilesCount: number;
  members: readonly { userId: string; name: string }[];
  rows: readonly OfficeFeeControlRowView[];
  settings: NfseSettingsPanelView | null;
  invoices: readonly NfseInvoiceView[];
}) {
  const router = useRouter();
  const [opening, startOpening] = useTransition();
  const monthName = MONTHS[month - 1];
  const title = `${monthName.charAt(0).toUpperCase()}${monthName.slice(1)} de ${year}`;
  const previous = adjacentPeriod(year, month, -1);
  const next = adjacentPeriod(year, month, 1);
  const health = nfseHealth(settings);
  const pendingWork = invoices.some((invoice) => invoice.status === "queued" || invoice.status === "cancel_requested");

  useEffect(() => {
    if (!pendingWork) return;
    const timer = setInterval(() => router.refresh(), 5_000);
    return () => clearInterval(timer);
  }, [pendingWork, router]);

  const invoicesByControl = useMemo(() => {
    const map: NfseInvoicesByControl = {};
    for (const invoice of invoices) {
      if (invoice.status === "cancelled") continue;
      const entry = (map[invoice.controlPeriodId] ??= {});
      if (invoice.kind === "monthly") entry.monthly = invoice;
      else entry.additional = invoice;
    }
    return map;
  }, [invoices]);

  const notesDone = rows.filter((row) => isDone(row.invoiceStatus)).length;
  const collectedDone = rows.filter((row) => isDone(row.collectionStatus)).length;
  const issuedCount = invoices.filter((invoice) => invoice.status === "issued").length;
  const steps: Step[] = [
    { key: "register", label: "Cadastro", detail: profilesCount === 1 ? "1 empresa" : `${profilesCount} empresas`, done: profilesCount > 0 },
    { key: "open", label: `Abrir ${monthName}`, detail: rows.length > 0 ? `${rows.length} no controle` : "ainda não aberto", done: rows.length > 0 },
    { key: "emit", label: "Emitir notas", detail: `${notesDone} de ${rows.length}`, done: rows.length > 0 && notesDone === rows.length },
    { key: "collect", label: "Cobrança", detail: `${collectedDone} de ${rows.length}`, done: rows.length > 0 && collectedDone === rows.length },
  ];
  const current = steps.find((step) => !step.done)?.key ?? null;
  const emissionPercent = rows.length ? Math.round((notesDone / rows.length) * 100) : 0;
  const queuedCount = invoices.filter((invoice) => invoice.status === "queued").length;
  const total = rows.reduce((sum, row) => sum + Number(row.profileSnapshot.monthlyFee), 0);

  function openPeriod() {
    startOpening(async () => {
      const result = await openOfficeFeeControlPeriod({ clanId, periodYear: year, periodMonth: month });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${result.data?.created ?? 0} empresa(s) adicionada(s) ao controle de ${monthName}.`);
      router.refresh();
    });
  }

  const emitBlocked = !canManage
    ? "Só integrantes do Fiscal e admins emitem notas."
    : health.state !== "ready"
      ? "A emissão pela Guilda ainda não está disponível. Veja o aviso acima."
      : null;

  return (
    <div className={cn(styles.workspace, "grid min-w-0 grid-cols-1 gap-5")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button asChild variant="outline" size="icon-sm" className="touch-target">
            <Link href={monthHref(clanId, previous.year, previous.month)} aria-label="Mês anterior"><ChevronLeft aria-hidden /></Link>
          </Button>
          <h2 className="px-2">{title}</h2>
          <Button asChild variant="outline" size="icon-sm" className="touch-target">
            <Link href={monthHref(clanId, next.year, next.month)} aria-label="Próximo mês"><ChevronRight aria-hidden /></Link>
          </Button>
        </div>
        {health.state === "ready" && settings?.serviceEnvironment === 2 ? (
          <span className="rounded-md border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs text-warning" title="As notas emitidas aqui não têm valor fiscal.">Ambiente de teste</span>
        ) : null}
      </div>

      <section className={styles.overview} aria-label="Resumo da emissão de notas">
        <div className={styles.emission}>
          <div className={styles.summaryLabel}><FileCheck2 className="size-4" aria-hidden /> Notas de honorários</div>
          <div className={styles.headline}><strong>{issuedCount}</strong><span>notas emitidas<small>em {monthName}</small></span></div>
          <div className={styles.progressLabel}><span>{notesDone} de {rows.length} clientes com a etapa de nota concluída</span><strong>{emissionPercent}%</strong></div>
          <div className={styles.progress} role="progressbar" aria-label="Etapa de emissão concluída" aria-valuemin={0} aria-valuemax={100} aria-valuenow={emissionPercent}><span style={{ width: `${emissionPercent}%` }} /></div>
        </div>
        <dl className={styles.metrics}>
          <div><dt>Valor da competência</dt><dd className={styles.amount}>{formatBRLCurrency(total.toFixed(2))}</dd></div>
          <div><dt>Etapa de nota pendente</dt><dd>{rows.length - notesDone}<span>clientes</span></dd></div>
          <div><dt>Pedidos na fila</dt><dd>{queuedCount}<span>{queuedCount === 1 ? "nota" : "notas"}</span></dd></div>
        </dl>
      </section>

      <ol className={styles.steps} aria-label={`Passos de ${monthName}`}>
        {steps.map((step, index) => {
          const isCurrent = step.key === current;
          return (
            <li
              key={step.key}
              aria-current={isCurrent ? "step" : undefined}
              className={cn(
                styles.step,
                step.done && styles.stepDone,
                isCurrent && styles.stepCurrent,
                !step.done && !isCurrent && "text-muted-foreground",
              )}
            >
              <span className={styles.stepNumber}>{step.done ? <Check className="size-4" aria-hidden /> : index + 1}</span>
              <span className="grid gap-1"><span className="text-sm font-medium">
                {step.label}
              </span>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">{isCurrent && step.key === "open" ? "próximo passo" : step.detail}</span></span>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className={cn(styles.service, health.state === "ready" ? "text-success" : "text-warning")}>
          {health.state === "ready" ? <ShieldCheck className="size-4" aria-hidden /> : <Clock3 className="size-4" aria-hidden />}
          <span>{health.state === "ready" ? settings?.serviceEnvironment === 2 ? "Conectado ao ambiente de teste" : "Conectado ao Sistema Nacional" : "Emissão requer atenção"}</span>
          {pendingWork ? <span className="inline-flex items-center gap-1.5 text-primary"><LoaderCircle className="size-3.5 animate-spin" aria-hidden /> Processando</span> : null}
        </div>
        <NfseNotice clanId={clanId} settings={settings} isAdmin={isAdmin} />
        <div className="ml-auto flex flex-wrap gap-2">
          {canManage && rows.length > 0 ? (
            <Button type="button" variant="outline" disabled={opening} onClick={openPeriod} title="Inclui no mês as empresas cadastradas depois da abertura">
              {opening ? <LoaderCircle className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />} Atualizar empresas
            </Button>
          ) : null}
          {canManage && issuedCount > 0 ? (
            <Button asChild variant="outline"><a href={nfsePdfHref(clanId, year, month)}><Download aria-hidden /> {issuedCount === 1 ? "Baixar PDF" : `Baixar PDFs (${issuedCount})`}</a></Button>
          ) : null}
          {current === "register" && canManage ? (
            <Button asChild><Link href={`/clans/${clanId}?tab=fees&feeView=base`}><FilePlus2 aria-hidden /> Cadastrar honorários</Link></Button>
          ) : null}
          {current === "open" && canManage ? (
            <Button type="button" disabled={opening} onClick={openPeriod}>
              {opening ? <LoaderCircle className="animate-spin" aria-hidden /> : <CalendarPlus aria-hidden />} Abrir {monthName}
            </Button>
          ) : null}
          {current === "emit" ? <NfseEmitDialog clanId={clanId} year={year} month={month} monthLabel={title} disabledReason={emitBlocked} /> : null}
        </div>
      </div>

      <OfficeFeeControlBoard
        clanId={clanId}
        year={year}
        month={month}
        canManage={canManage}
        members={members}
        rows={rows}
        invoicesByControl={invoicesByControl}
      />
    </div>
  );
}
