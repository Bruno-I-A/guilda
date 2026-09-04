import { Skeleton } from "@/components/ui/skeleton";

/**
 * Esqueleto do /leaderboard.
 *
 * O ranking agrega o `xp_ledger` inteiro da org por período — é a consulta
 * mais cara do app e a que mais se beneficia de feedback imediato.
 *
 * A silhueta: cabeçalho, nav de período (semana/mês/carreira) e UM painel de
 * vitrine com oito linhas divididas — rank, avatar, nome + nível, badge de
 * XP do período à direita.
 *
 * A silhueta é a do pódio, e não a da carreira, porque "Semana" é o padrão da
 * rota: o esqueleto tem que parecer com o que chega na maioria das vezes.
 */

/** Semana · Mês · Carreira. */
const PERIOD_WIDTHS = ["w-16", "w-10", "w-20"] as const;

/** Oito colocações: as três primeiras têm trilho colorido no conteúdo real. */
const RANK_ROWS = [
  { name: "w-40", rail: "border-l-gold/40" },
  { name: "w-32", rail: "border-l-silver/30" },
  { name: "w-44", rail: "border-l-bronze/40" },
  { name: "w-36", rail: "border-l-transparent" },
  { name: "w-28", rail: "border-l-transparent" },
  { name: "w-40", rail: "border-l-transparent" },
  { name: "w-32", rail: "border-l-transparent" },
  { name: "w-36", rail: "border-l-transparent" },
] as const;

export default function LeaderboardLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Carregando o ranking da guilda"
      className="grid gap-5"
    >
      <span className="sr-only">Carregando o ranking da guilda…</span>

      <div aria-hidden className="grid gap-5">
        {/* Cabeçalho */}
        <div className="grid gap-2">
          <Skeleton className="h-7 w-32 rounded-none" />
          <Skeleton className="h-4 w-full max-w-md rounded-none" />
        </div>

        {/* Período: trilho sublinhado */}
        <div className="flex w-fit max-w-full gap-1 overflow-hidden border-b border-border">
          {PERIOD_WIDTHS.map((width, index) => (
            <div key={index} className="shrink-0 px-3 py-2.5">
              <Skeleton className={`h-4 rounded-none ${width}`} />
            </div>
          ))}
        </div>

        {/* Painel único com as colocações */}
        <section className="panel-cut texture-iron">
          <div className="divide-y divide-border">
            {RANK_ROWS.map((row, index) => (
              <div
                key={index}
                className={`flex items-center gap-3 border-l-2 px-4 py-3 ${row.rail}`}
              >
                {/* Posição: coroa/medalha no pódio, "Nº" nas demais. */}
                <div className="flex w-8 shrink-0 justify-center">
                  <Skeleton className="size-5 rounded-none" />
                </div>
                <Skeleton className="size-9 shrink-0 rounded-full" />
                <div className="grid min-w-0 flex-1 gap-1.5">
                  <Skeleton className={`h-4 rounded-none ${row.name}`} />
                  <Skeleton className="h-3 w-36 max-w-full rounded-none" />
                </div>
                <Skeleton className="h-5 w-20 shrink-0 rounded-none" />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
