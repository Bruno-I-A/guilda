import { Skeleton } from "@/components/ui/skeleton";

/**
 * Esqueleto do /tasks.
 *
 * Quatro consultas antes do primeiro paint (clãs, membros, vínculos e as
 * missões do recorte). A silhueta é a da visão pessoal das avulsas: cabeçalho
 * com ação, navegação Avulsas/Informativos, seletor de recorte, faixa de
 * três contadores e uma seção com linhas no formato `full`.
 */

/** Larguras do título de cada linha, para a lista não virar código de barras. */
const ROW_TITLE_WIDTHS = [
  "w-2/3",
  "w-1/2",
  "w-4/5",
  "w-3/5",
  "w-2/5",
  "w-3/4",
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
            <Skeleton className="h-4 w-80 max-w-full rounded-none" />
          </div>
          <Skeleton className="h-8 w-32 rounded-none" />
        </div>

        {/* Navegação Avulsas / Informativos + recorte */}
        <div className="grid gap-3">
          <div className="flex gap-1 border-b border-border">
            <Skeleton className="my-2.5 h-3 w-16 rounded-none" />
            <Skeleton className="my-2.5 ml-6 h-3 w-24 rounded-none" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-3 w-14 rounded-none" />
            <Skeleton className="h-7 w-40 rounded-none" />
          </div>
        </div>

        {/* Faixa de contadores */}
        <div className="grid border-y border-border/80 bg-card/25 sm:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <div key={index} className="flex min-h-16 items-center gap-3 px-4 py-2.5">
              <Skeleton className="h-6 w-8 rounded-none" />
              <div className="grid gap-1.5">
                <Skeleton className="h-3.5 w-24 rounded-none" />
                <Skeleton className="h-3 w-32 rounded-none" />
              </div>
            </div>
          ))}
        </div>

        {/* Seção "Para você fazer" */}
        <div className="grid gap-2">
          <div className="flex items-center gap-3">
            <Skeleton className="h-5 w-40 rounded-none" />
            <Skeleton className="h-3 w-4 rounded-none" />
            <span className="h-px flex-1 bg-border/60" />
          </div>
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
                  <Skeleton className="h-4 w-20 rounded-none" />
                  <Skeleton className="h-3 w-10 rounded-none" />
                  <Skeleton className="h-3 w-16 rounded-none" />
                  <span className="hidden h-3 w-px bg-border sm:block" />
                  <Skeleton className="h-3 w-24 rounded-none" />
                  <Skeleton className="h-3 w-32 rounded-none" />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
