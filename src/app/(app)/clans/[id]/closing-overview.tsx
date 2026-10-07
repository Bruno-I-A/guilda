import { ArrowRight } from "lucide-react";
import Link from "next/link";

import {
  buildClosingBoard,
  CLOSING_STAGE_LABELS,
  monthShortLabel,
  type ClosingStage,
  type OverviewCompany,
} from "@/domain/closing-overview";
import { cn } from "@/lib/utils";

import { ClosingHealthReading } from "./closing-health";

/** Cartões visíveis por coluna; o resto vai para o filtro da coluna. */
const CARDS_POR_COLUNA = 6;

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
        "panel-cut grid min-w-0 grid-cols-1 content-start gap-2 border border-t-2 border-border/70 bg-card/40 p-3",
        estilo.borda,
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="hud-label min-w-0">{CLOSING_STAGE_LABELS[stage]}</p>
        <p className={cn("shrink-0 font-mono text-2xl font-semibold tabular-nums", estilo.numero)}>
          {count}
        </p>
      </div>
      {note ? <p className="-mt-1 text-xs text-muted-foreground">{note}</p> : null}
      {count === 0 ? (
        <p className="py-2 text-xs text-muted-foreground">Nenhuma empresa aqui.</p>
      ) : (
        <ul className="grid min-w-0 grid-cols-1 divide-y divide-border/40">{children}</ul>
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
    <li className="min-w-0">
      <Link
        href={href}
        className="flex min-w-0 items-center justify-between gap-2 py-1.5 text-sm transition-colors hover:text-primary"
      >
        <span className="min-w-0 truncate">{company.name}</span>
        {trailing}
      </Link>
    </li>
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
  draw,
}: {
  year: number;
  companies: readonly OverviewCompany[];
  stageHref: Record<ClosingStage, string>;
  companyHref: (name: string) => string;
  /** O sorteio da próxima empresa, entre o título do quadro e as colunas. */
  draw: React.ReactNode;
}) {
  const board = buildClosingBoard(companies);
  // A faixa de cima conta "sem períodos" (qualquer período, até pendente); esta
  // coluna conta "nenhum FECHADO". Empresa só com período lançado e pendente
  // entra aqui e não lá — sem esta nota, 190 ao lado de 189 parece defeito.
  const soPendentes = board.none.filter((company) => company.closings.length > 0).length;

  return (
    <div className="grid min-w-0 grid-cols-1 gap-5">
      <section className="grid min-w-0 grid-cols-1 gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2>Andamento de {year}</h2>
          <p className="text-xs text-muted-foreground">
            Em andamento, da mais atrasada para a mais adiantada.
          </p>
        </div>
        {draw}
        <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-3">
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

      <ClosingHealthReading year={year} companies={companies} companyHref={companyHref} />
    </div>
  );
}
