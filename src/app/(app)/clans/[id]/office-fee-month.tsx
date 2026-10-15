"use client";

import { Check, ChevronLeft, ChevronRight, Download, FilePlus2, LoaderCircle, RefreshCw, CalendarPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { FiscalStepStatus } from "@/domain/fiscal-control";
import { cn } from "@/lib/utils";

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
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button asChild variant="outline" size="icon-sm">
            <Link href={monthHref(clanId, previous.year, previous.month)} aria-label="Mês anterior"><ChevronLeft aria-hidden /></Link>
          </Button>
          <h2 className="px-2">{title}</h2>
          <Button asChild variant="outline" size="icon-sm">
            <Link href={monthHref(clanId, next.year, next.month)} aria-label="Próximo mês"><ChevronRight aria-hidden /></Link>
          </Button>
        </div>
        {health.state === "ready" && settings?.serviceEnvironment === 2 ? (
          <span className="rounded-md border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs text-warning" title="As notas emitidas aqui não têm valor fiscal.">Ambiente de teste</span>
        ) : null}
      </div>

      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label={`Passos de ${monthName}`}>
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
              <span className="font-mono text-xs tabular-nums">{isCurrent && step.key === "open" ? "próximo passo" : step.detail}</span>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <NfseNotice clanId={clanId} settings={settings} isAdmin={isAdmin} />
        <div className="ml-auto flex flex-wrap gap-2">
          {canManage && rows.length > 0 ? (
            <Button type="button" variant="outline" disabled={opening} onClick={openPeriod} title="Inclui no mês as empresas cadastradas depois da abertura">
              {opening ? <LoaderCircle className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />} Atualizar empresas
            </Button>
          ) : null}
          {canManage && issuedCount > 0 ? (
            <Button asChild variant="outline"><a href={nfsePdfHref(clanId, year, month)}><Download aria-hidden /> Baixar PDFs ({issuedCount})</a></Button>
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
