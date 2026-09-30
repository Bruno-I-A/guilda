import { ArrowRight, Banknote, HandCoins, TrendingDown } from "lucide-react";
import Link from "next/link";

import {
  analyzeClosingHealth,
  buildClosingBoard,
  CLOSING_STAGE_LABELS,
  LOW_CASH_THRESHOLD,
  monthShortLabel,
  type ClosingStage,
  type HealthEntry,
  type OverviewCompany,
} from "@/domain/closing-overview";
import { formatBRLCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

/** Cartões visíveis por coluna; o resto vai para o filtro da coluna. */
const CARDS_POR_COLUNA = 6;
/** Linhas visíveis por alerta do analista; o resto fica dobrado. */
const LINHAS_POR_ALERTA = 5;

/**
 * Situação é estado, não categoria: warning para o que ainda não começou,
 * primary para o que está andando, success para o encerrado — o mesmo
 * vocabulário da esteira do Fluxo e das observações.
 */
const STAGE_STYLE: Record<ClosingStage, { borda: string; numero: string }> = {
  none: { borda: "border-t-warning", numero: "text-warning" },
  partial: { borda: "border-t-primary", numero: "text-primary" },
  closed: { borda: "border-t-success", numero: "text-success" },
};

function StageColumn({
  stage,
  count,
  href,
  note,
  children,
}: {
  stage: ClosingStage;
  count: number;
  href: string;
  /** Linha curta sob o título, quando a contagem precisa de explicação. */
  note?: string | null;
  children: React.ReactNode;
}) {
  const estilo = STAGE_STYLE[stage];
  const restantes = Math.max(0, count - CARDS_POR_COLUNA);
  return (
    <div
      className={cn(
        "panel-cut grid min-w-0 content-start gap-2 border border-t-2 border-border/70 bg-card/40 p-3",
        estilo.borda,
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="hud-label min-w-0">{CLOSING_STAGE_LABELS[stage]}</p>
        <p className={cn("font-mono text-2xl font-semibold tabular-nums", estilo.numero)}>
          {count}
        </p>
      </div>
      {note ? <p className="-mt-1 text-xs text-muted-foreground">{note}</p> : null}
      {count === 0 ? (
        <p className="py-2 text-xs text-muted-foreground">Nenhuma empresa aqui.</p>
      ) : (
        <ul className="grid gap-1">{children}</ul>
      )}
      {count > 0 ? (
        <Link
          href={href}
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          {restantes > 0 ? `Ver todas (${count})` : "Ver na lista"}
          <ArrowRight className="size-3" aria-hidden />
        </Link>
      ) : null}
    </div>
  );
}

function CompanyCard({
  company,
  href,
  trailing,
}: {
  company: OverviewCompany;
  href: string;
  trailing?: React.ReactNode;
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex min-w-0 items-center justify-between gap-2 border border-border/50 bg-background/40 px-2 py-1.5 text-sm transition-colors hover:border-primary/40 hover:bg-accent/30"
      >
        <span className="min-w-0 truncate">{company.name}</span>
        {trailing}
      </Link>
    </li>
  );
}

function HealthBlock({
  title,
  hint,
  Icon,
  tone,
  entries,
  empty,
  companyHref,
}: {
  title: string;
  hint: string;
  Icon: typeof Banknote;
  tone: "destructive" | "warning" | "silver";
  entries: readonly HealthEntry[];
  empty: string;
  companyHref: (name: string) => string;
}) {
  const visiveis = entries.slice(0, LINHAS_POR_ALERTA);
  const resto = entries.slice(LINHAS_POR_ALERTA);
  const corTitulo = {
    destructive: "text-destructive",
    warning: "text-warning",
    silver: "text-silver",
  }[tone];

  const linha = (entry: HealthEntry) => (
    <li key={entry.company.id}>
      <Link
        href={companyHref(entry.company.name)}
        className="flex min-w-0 items-baseline justify-between gap-2 py-1 text-sm hover:underline"
      >
        <span className="min-w-0 truncate">{entry.company.name}</span>
        <span className="flex shrink-0 items-baseline gap-1.5">
          <span
            className={cn(
              "font-mono tabular-nums",
              entry.value < 0 ? "text-destructive" : "text-foreground",
            )}
          >
            {formatBRLCurrency(entry.value)}
          </span>
          <span className="font-mono text-[0.6875rem] text-muted-foreground">
            {monthShortLabel(entry.month)}
          </span>
        </span>
      </Link>
    </li>
  );

  return (
    <div className="panel-cut grid min-w-0 content-start gap-2 border border-border/70 bg-card/40 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={cn("flex items-center gap-1.5 text-sm font-semibold", corTitulo)}>
            <Icon className="size-4 shrink-0" aria-hidden /> {title}
          </p>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        <p className={cn("font-mono text-2xl font-semibold tabular-nums", corTitulo)}>
          {entries.length}
        </p>
      </div>
      {entries.length === 0 ? (
        <p className="py-1 text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y divide-border/40">{visiveis.map(linha)}</ul>
      )}
      {resto.length > 0 ? (
        // `details` nativo: o componente é Server Component e abre sem JS.
        <details className="group">
          <summary className="hud-label cursor-pointer list-none py-1 hover:text-foreground [&::-webkit-details-marker]:hidden">
            + {resto.length} {resto.length === 1 ? "empresa" : "empresas"}
          </summary>
          <ul className="divide-y divide-border/40">{resto.map(linha)}</ul>
        </details>
      ) : null}
    </div>
  );
}

/**
 * Quadro do ano e leitura dos números, acima da lista de empresas.
 *
 * O quadro responde o que o resumo anual não respondia no meio do ano: quem já
 * tem fechamento, quem não tem nenhum, e quem está mais atrasado. O analista
 * junta num lugar só o que antes vivia espalhado dentro de cada card —
 * prejuízo, caixa no vermelho e empréstimo de sócio.
 */
export function ClosingOverview({
  year,
  companies,
  stageHref,
  companyHref,
}: {
  year: number;
  companies: readonly OverviewCompany[];
  stageHref: Record<ClosingStage, string>;
  companyHref: (name: string) => string;
}) {
  const board = buildClosingBoard(companies);
  const health = analyzeClosingHealth(companies);
  // A faixa de cima conta "sem períodos" (qualquer período, até pendente); esta
  // coluna conta "nenhum FECHADO". Empresa só com período lançado e pendente
  // entra aqui e não lá — sem esta nota, 190 ao lado de 189 parece defeito.
  const soPendentes = board.none.filter((company) => company.closings.length > 0).length;

  return (
    <div className="grid gap-5">
      <section className="grid gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2>Andamento de {year}</h2>
          <p className="text-xs text-muted-foreground">
            Em andamento, da mais atrasada para a mais adiantada.
          </p>
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          <StageColumn
            stage="none"
            count={board.none.length}
            href={stageHref.none}
            note={
              soPendentes > 0
                ? `${soPendentes} com período lançado, ainda pendente`
                : null
            }
          >
            {board.none.slice(0, CARDS_POR_COLUNA).map((company) => (
              <CompanyCard
                key={company.id}
                company={company}
                href={companyHref(company.name)}
              />
            ))}
          </StageColumn>
          <StageColumn stage="partial" count={board.partial.length} href={stageHref.partial}>
            {board.partial.slice(0, CARDS_POR_COLUNA).map(({ company, latestMonth }) => (
              <CompanyCard
                key={company.id}
                company={company}
                href={companyHref(company.name)}
                trailing={
                  <span className="shrink-0 border border-primary/35 bg-primary/10 px-1.5 font-mono text-[0.6875rem] text-primary">
                    {latestMonth === null ? "sem mês" : `até ${monthShortLabel(latestMonth)}`}
                  </span>
                }
              />
            ))}
          </StageColumn>
          <StageColumn stage="closed" count={board.closed.length} href={stageHref.closed}>
            {board.closed.slice(0, CARDS_POR_COLUNA).map((company) => (
              <CompanyCard
                key={company.id}
                company={company}
                href={companyHref(company.name)}
              />
            ))}
          </StageColumn>
        </div>
      </section>

      <section className="grid gap-2">
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
          <div className="grid gap-2 md:grid-cols-3">
            <HealthBlock
              title="Prejuízo"
              hint="Resultado negativo no último período"
              Icon={TrendingDown}
              tone="destructive"
              entries={health.loss}
              empty="Nenhuma empresa com prejuízo."
              companyHref={companyHref}
            />
            <HealthBlock
              title="Caixa negativo ou baixo"
              hint={`Negativo primeiro; baixo é abaixo de ${formatBRLCurrency(LOW_CASH_THRESHOLD)}`}
              Icon={Banknote}
              tone="warning"
              entries={health.cash}
              empty="Nenhuma empresa com caixa no vermelho."
              companyHref={companyHref}
            />
            <HealthBlock
              title="Empréstimo de sócio"
              hint="Saldo em aberto no último período"
              Icon={HandCoins}
              tone="silver"
              entries={health.loan}
              empty="Nenhuma empresa com empréstimo de sócio."
              companyHref={companyHref}
            />
          </div>
        ) : null}
      </section>
    </div>
  );
}
