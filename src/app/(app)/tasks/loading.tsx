import { Skeleton } from "@/components/ui/skeleton";

/**
 * Esqueleto do /tasks.
 *
 * Quatro consultas antes do primeiro paint (clãs, membros, vínculos e a
 * própria lista de até 200 missões). A silhueta é a da lista no formato
 * `full`: título + chip de XP em cima, badge/pips/atribuição embaixo — duas
 * alturas de texto por linha, e não uma.
 */

/** Larguras do título de cada linha, para a lista não virar código de barras. */
const ROW_TITLE_WIDTHS = [
  "w-2/3",
  "w-1/2",
  "w-4/5",
  "w-3/5",
  "w-2/5",
  "w-3/4",
  "w-1/2",
  "w-7/12",
] as const;

export default function TasksLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Carregando missões"
      className="grid gap-5"
    >
      <span className="sr-only">Carregando missões…</span>

      <div aria-hidden className="grid gap-5">
        {/* Cabeçalho + ação */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid gap-2">
            <Skeleton className="h-7 w-40 rounded-none" />
            <Skeleton className="h-4 w-72 max-w-full rounded-none" />
          </div>
          <Skeleton className="h-9 w-36 rounded-none" />
        </div>

        {/* Barra de filtros: os gatilhos de select são `size="sm"` (h-8). */}
        <div className="panel-cut panel-cut-sm flex flex-wrap items-center gap-2 p-2">
          <Skeleton className="h-8 w-40 rounded-none" />
          <Skeleton className="h-8 w-36 rounded-none" />
          <Skeleton className="h-8 w-32 rounded-none" />
        </div>

        {/* Lista de missões no formato `full` */}
        <ul className="grid gap-1.5">
          {ROW_TITLE_WIDTHS.map((titleWidth, index) => (
            <li
              key={index}
              className="panel-cut panel-cut-sm flex flex-col gap-2 border-l-2 border-l-border/60 px-4 py-3"
            >
              <div className="flex items-start justify-between gap-3">
                <Skeleton className={`h-5 rounded-none ${titleWidth}`} />
                {/* Chip de loot: 1.375rem é a altura exata de `.chip-loot`. */}
                <Skeleton className="h-[1.375rem] w-16 shrink-0 rounded-none" />
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                {/* Grupo 1 — estado: badge + pips de prioridade e dificuldade */}
                <Skeleton className="h-4 w-20 rounded-none" />
                <Skeleton className="h-3 w-10 rounded-none" />
                <Skeleton className="h-3 w-16 rounded-none" />
                <span className="hidden h-3 w-px bg-border sm:block" />
                {/* Grupo 2 — atribuição: clã · responsável · prazo */}
                <Skeleton className="h-3 w-24 rounded-none" />
                <Skeleton className="h-3 w-32 rounded-none" />
                <Skeleton className="h-3 w-24 rounded-none" />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
