import { Skeleton } from "@/components/ui/skeleton";

/**
 * Esqueleto do /clans/[id].
 *
 * A rota resolve o clã, os vínculos do visitante e ainda a consulta da aba
 * ativa antes de pintar. A silhueta cobre o caso comum — a aba Missões, a
 * Mesa do clã — porque é o padrão de `parseClanTab` e o que quase todo
 * acesso abre.
 *
 * A barra de abas é o trilho sublinhado do <SegmentedNav> (borda inferior +
 * itens `px-3 py-2.5`), não pílula: o esqueleto precisa deixar o mesmo
 * espaço, senão a régua da aba salta 1px ao trocar.
 */

/** Abas: cinco é a contagem típica (o clã Fiscal e o Contabilidade têm seis). */
const TAB_WIDTHS = ["w-16", "w-20", "w-20", "w-24", "w-16"] as const;

/** Três cartões de estatística: abertas, sem responsável, atrasadas. */
const STAT_LABEL_WIDTHS = ["w-14", "w-24", "w-20"] as const;

const ASSIGNED_ROWS = [
  { title: "w-3/5", meta: "w-2/5" },
  { title: "w-4/5", meta: "w-1/3" },
  { title: "w-1/2", meta: "w-2/5" },
  { title: "w-2/3", meta: "w-1/4" },
  { title: "w-3/4", meta: "w-1/3" },
] as const;

export default function ClanLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Carregando o clã"
      className="grid gap-6"
    >
      <span className="sr-only">Carregando o clã…</span>

      <div aria-hidden className="grid gap-6">
        {/* Volta + nome do clã + badges */}
        <div className="grid gap-2">
          <Skeleton className="h-3.5 w-24 rounded-none" />
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-7 w-48 rounded-none" />
            <Skeleton className="h-5 w-24 rounded-none" />
          </div>
        </div>

        {/* Barra de abas: trilho sublinhado */}
        <div className="flex max-w-full gap-1 overflow-hidden border-b border-border">
          {TAB_WIDTHS.map((width, index) => (
            <div key={index} className="shrink-0 px-3 py-2.5">
              <Skeleton className={`h-4 rounded-none ${width}`} />
            </div>
          ))}
        </div>

        {/* Conteúdo da aba Missões */}
        <div className="grid gap-6">
          {/* Cartões de estatística */}
          <div className="grid grid-cols-3 gap-2">
            {STAT_LABEL_WIDTHS.map((width, index) => (
              <div key={index} className="panel-cut panel-cut-sm grid gap-1.5 p-2.5">
                <Skeleton className={`h-3.5 rounded-none ${width}`} />
                <Skeleton className="h-6 w-10 rounded-none" />
              </div>
            ))}
          </div>

          {/* Mesa do clã: a fila de missões sem responsável */}
          <section className="grid gap-3">
            <Skeleton className="h-3 w-40 rounded-none" />
            <div className="panel-cut grid gap-2.5 p-4">
              <Skeleton className="h-4 w-52 rounded-none" />
              <Skeleton className="h-9 w-full rounded-none" />
              <Skeleton className="h-9 w-full rounded-none" />
              <Skeleton className="h-9 w-4/5 rounded-none" />
            </div>
          </section>

          {/* Em andamento: linhas com responsável à direita */}
          <section className="grid gap-3">
            <Skeleton className="h-3 w-32 rounded-none" />
            <ul className="grid gap-1.5">
              {ASSIGNED_ROWS.map((row, index) => (
                <li
                  key={index}
                  className="panel-cut panel-cut-sm flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <div className="grid min-w-0 flex-1 gap-2">
                    <Skeleton className={`h-4 rounded-none ${row.title}`} />
                    <Skeleton className={`h-3 rounded-none ${row.meta}`} />
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Skeleton className="size-6 rounded-full" />
                    <Skeleton className="hidden h-3.5 w-24 rounded-none sm:block" />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
