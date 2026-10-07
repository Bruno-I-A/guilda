import { Banknote, HandCoins, TrendingDown } from "lucide-react";
import Link from "next/link";

import {
  analyzeClosingHealth,
  closingSeries,
  LOW_CASH_THRESHOLD,
  monthShortLabel,
  type HealthEntry,
  type OverviewCompany,
} from "@/domain/closing-overview";
import { formatBRLCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

import { ClosingEvolutionButton } from "./closing-evolution";

/** Linhas visíveis por alerta; o resto fica dobrado. */
const LINHAS_POR_ALERTA = 5;

/** Comparar pede dois pontos: com um período só, não há evolução. */
const MINIMO_PARA_EVOLUCAO = 2;

function HealthBlock({
  title,
  hint,
  Icon,
  tone,
  entries,
  empty,
  year,
  companyHref,
}: {
  title: string;
  hint: string;
  Icon: typeof Banknote;
  tone: "destructive" | "warning" | "silver";
  entries: readonly HealthEntry[];
  empty: string;
  year: number;
  companyHref?: (name: string) => string;
}) {
  const visiveis = entries.slice(0, LINHAS_POR_ALERTA);
  const resto = entries.slice(LINHAS_POR_ALERTA);
  const corTitulo = {
    destructive: "text-destructive",
    warning: "text-warning",
    silver: "text-silver",
  }[tone];

  const linha = (entry: HealthEntry) => {
    const series = closingSeries(entry.company.closings);
    return (
      <li
        key={entry.company.id}
        className="flex min-w-0 items-center justify-between gap-2 py-1 text-sm"
      >
        {companyHref ? (
          <Link href={companyHref(entry.company.name)} className="min-w-0 truncate hover:underline">
            {entry.company.name}
          </Link>
        ) : (
          <span className="min-w-0 truncate">{entry.company.name}</span>
        )}
        <span className="flex shrink-0 items-center gap-1.5">
          <span
            className={cn(
              "font-mono tabular-nums",
              entry.value < 0 ? "text-destructive" : "text-foreground",
            )}
          >
            {formatBRLCurrency(entry.value)}
          </span>
          <span className="font-mono text-[length:var(--text-hud)] text-muted-foreground">
            {monthShortLabel(entry.month)}
          </span>
          {series.length >= MINIMO_PARA_EVOLUCAO ? (
            <ClosingEvolutionButton companyName={entry.company.name} year={year} series={series} />
          ) : null}
        </span>
      </li>
    );
  };

  return (
    <div className="panel-cut grid min-w-0 grid-cols-1 content-start gap-2 border border-border/70 bg-card/40 p-3">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={cn("flex items-center gap-1.5 text-sm font-semibold", corTitulo)}>
            <Icon className="size-4 shrink-0" aria-hidden /> {title}
          </p>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        <p className={cn("shrink-0 font-mono text-2xl font-semibold tabular-nums", corTitulo)}>
          {entries.length}
        </p>
      </div>
      {entries.length === 0 ? (
        <p className="py-1 text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="grid min-w-0 grid-cols-1 divide-y divide-border/40">{visiveis.map(linha)}</ul>
      )}
      {resto.length > 0 ? (
        // `details` nativo: o componente é Server Component e abre sem JS.
        <details className="group min-w-0">
          <summary className="hud-label cursor-pointer list-none py-1 hover:text-foreground [&::-webkit-details-marker]:hidden">
            + {resto.length} {resto.length === 1 ? "empresa" : "empresas"}
          </summary>
          <ul className="grid min-w-0 grid-cols-1 divide-y divide-border/40">{resto.map(linha)}</ul>
        </details>
      ) : null}
    </div>
  );
}

/**
 * Leitura dos números: prejuízo, caixa no vermelho e empréstimo de sócio,
 * pelo período fechado mais recente de cada empresa. A mesma regra serve à
 * Contabilidade (aba Fechamentos) e ao Fiscal (Saúde das empresas), que
 * controla a emissão de notas e precisa ver quem está no vermelho.
 *
 * `companyHref` é opcional de propósito: no Fiscal o nome não leva à aba
 * Fechamentos, que é da Contabilidade.
 */
export function ClosingHealthReading({
  year,
  companies,
  companyHref,
}: {
  year: number;
  companies: readonly OverviewCompany[];
  companyHref?: (name: string) => string;
}) {
  const health = analyzeClosingHealth(companies);

  return (
    <section className="grid min-w-0 grid-cols-1 gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2>Leitura dos números</h2>
        <p className="text-xs text-muted-foreground">
          {health.analyzed === 0
            ? `Nenhum período fechado com valores em ${year}.`
            : `Pelo período fechado mais recente de cada empresa · ${health.analyzed} ${
                health.analyzed === 1 ? "empresa lida" : "empresas lidas"
              }`}
        </p>
      </div>
      {health.analyzed > 0 ? (
        <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-3">
          <HealthBlock
            title="Prejuízo"
            hint="Resultado negativo no último período"
            Icon={TrendingDown}
            tone="destructive"
            entries={health.loss}
            empty="Nenhuma empresa com prejuízo."
            year={year}
            companyHref={companyHref}
          />
          <HealthBlock
            title="Caixa negativo ou baixo"
            hint={`Negativo primeiro; baixo é abaixo de ${formatBRLCurrency(LOW_CASH_THRESHOLD)}`}
            Icon={Banknote}
            tone="warning"
            entries={health.cash}
            empty="Nenhuma empresa com caixa no vermelho."
            year={year}
            companyHref={companyHref}
          />
          <HealthBlock
            title="Empréstimo de sócio"
            hint="Saldo em aberto no último período"
            Icon={HandCoins}
            tone="silver"
            entries={health.loan}
            empty="Nenhuma empresa com empréstimo de sócio."
            year={year}
            companyHref={companyHref}
          />
        </div>
      ) : null}
    </section>
  );
}
