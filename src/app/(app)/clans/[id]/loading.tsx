import { Skeleton } from "@/components/ui/skeleton";

/**
 * Esqueleto do /clans/[id].
 *
 * A rota resolve o clã, os vínculos do visitante e ainda a consulta da aba
 * ativa antes de pintar. A silhueta cobre o caso comum — a aba Missões, a
 * Mesa do clã — porque é o padrão de `parseClanTab` e o que quase todo
 * acesso abre.
 *
 * Cabeçalho: nome do clã à esquerda, a formação (avatares) à direita. Abas:
 * dois grupos de placas (o espaço da área e a mesa), com rótulo em cima —
 * as alturas precisam bater com a navegação real para a régua não saltar.
 */

const OWN_TAB_WIDTHS = ["w-32", "w-20"] as const;
const SHARED_TAB_WIDTHS = ["w-24", "w-28", "w-28"] as const;

/** Três contadores: abertas, sem responsável, atrasadas. */
const STAT_LABEL_WIDTHS = ["w-24", "w-28", "w-20"] as const;

const ASSIGNED_ROWS = [
  { title: "w-3/5", meta: "w-2/5" },
  { title: "w-4/5", meta: "w-1/3" },
  { title: "w-1/2", meta: "w-2/5" },
  { title: "w-2/3", meta: "w-1/4" },
] as const;

function TabGroupSkeleton({
  label,
  widths,
}: {
  label: string;
  widths: readonly string[];
}) {
  return (
    <div className="grid shrink-0 gap-1.5">
      <Skeleton className={`h-3 rounded-none ${label}`} />
      <div className="flex gap-1 border border-border/70 p-1">
        {widths.map((width, index) => (
          <div key={index} className="flex min-h-11 items-center gap-2 px-3">
            <Skeleton className="size-4 rounded-none" />
            <Skeleton className={`h-4 rounded-none ${width}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ClanLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Carregando o clã"
      className="grid gap-5"
    >
      <span className="sr-only">Carregando o clã…</span>

      <div aria-hidden className="grid gap-5">
        {/* Cabeçalho: volta, nome do clã e a formação */}
        <div className="grid gap-4 border-b border-border/80 pb-5">
          <Skeleton className="h-3.5 w-16 rounded-none" />
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex items-center gap-3">
              <Skeleton className="size-10 rotate-45 rounded-none" />
              <div className="grid gap-2">
                <Skeleton className="h-3 w-8 rounded-none" />
                <Skeleton className="h-7 w-48 rounded-none" />
              </div>
            </div>
            <div className="flex items-center gap-3 border border-border/70 py-2 pr-4 pl-2">
              <div className="flex -space-x-2">
                {[0, 1, 2, 3].map((index) => (
                  <Skeleton key={index} className="size-8 rounded-full border-2 border-background" />
                ))}
              </div>
              <div className="grid gap-1.5">
                <Skeleton className="h-3 w-20 rounded-none" />
                <Skeleton className="h-3 w-24 rounded-none" />
              </div>
            </div>
          </div>
        </div>

        {/* Abas em dois grupos + descrição da aba */}
        <div className="grid gap-2">
          <div className="flex gap-3 overflow-hidden pb-1">
            <TabGroupSkeleton label="w-24" widths={OWN_TAB_WIDTHS} />
            <TabGroupSkeleton label="w-20" widths={SHARED_TAB_WIDTHS} />
          </div>
          <Skeleton className="h-4 w-80 max-w-full rounded-none" />
        </div>

        {/* Conteúdo da aba Missões */}
        <div className="grid gap-6">
          {/* Faixa de contadores */}
          <div className="grid border-y border-border/80 bg-card/25 sm:grid-cols-3">
            {STAT_LABEL_WIDTHS.map((width, index) => (
              <div key={index} className="flex min-h-16 items-center gap-3 px-4 py-2.5">
                <Skeleton className="h-6 w-8 rounded-none" />
                <div className="grid gap-1.5">
                  <Skeleton className={`h-3.5 rounded-none ${width}`} />
                  <Skeleton className="h-3 w-32 rounded-none" />
                </div>
              </div>
            ))}
          </div>

          {/* Em andamento: título de seção real + linhas compactas */}
          <section className="grid gap-3">
            <div className="flex items-center gap-3">
              <Skeleton className="h-5 w-36 rounded-none" />
              <Skeleton className="h-3 w-4 rounded-none" />
              <span className="h-px flex-1 bg-border/60" />
            </div>
            <ul className="grid gap-1.5">
              {ASSIGNED_ROWS.map((row, index) => (
                <li
                  key={index}
                  className="panel-cut panel-cut-sm flex items-center justify-between gap-3 border-l-2 border-l-border/60 px-4 py-2.5"
                >
                  <div className="grid min-w-0 flex-1 gap-2">
                    <Skeleton className={`h-4 rounded-none ${row.title}`} />
                    <Skeleton className={`h-3 rounded-none ${row.meta}`} />
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Skeleton className="size-6 rounded-full" />
                    <Skeleton className="h-[1.375rem] w-14 rounded-none" />
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {/* Fila de distribuição */}
          <section className="grid gap-3">
            <div className="flex items-center gap-3">
              <Skeleton className="h-5 w-44 rounded-none" />
              <span className="h-px flex-1 bg-border/60" />
            </div>
            <div className="panel-cut grid gap-2.5 p-4">
              <Skeleton className="h-4 w-52 rounded-none" />
              <Skeleton className="h-9 w-full rounded-none" />
              <Skeleton className="h-9 w-4/5 rounded-none" />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
