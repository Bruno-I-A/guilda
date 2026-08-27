import { Skeleton } from "@/components/ui/skeleton";

/**
 * Esqueleto do /tasks/[id].
 *
 * O detalhe carrega a missão com eventos, transferências e a lista de
 * candidatos a transferência antes de renderizar. A silhueta: link de volta,
 * título grande com badge, barra de ações, e o par painel de detalhe +
 * linha do tempo no grid `lg:grid-cols-[2fr_1fr]`.
 */

/** Quatro entradas de linha do tempo: o suficiente para a coluna ter altura real. */
const TIMELINE_ENTRIES = ["w-3/4", "w-1/2", "w-2/3", "w-2/5"] as const;

/** Uma linha `rótulo — valor` do painel de detalhe. */
function DetailLineSkeleton({ value }: { value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Skeleton className="h-3.5 w-24 rounded-none" />
      <Skeleton className={`h-3.5 rounded-none ${value}`} />
    </div>
  );
}

export default function TaskDetailLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Carregando a missão"
      className="grid gap-5"
    >
      <span className="sr-only">Carregando a missão…</span>

      <div aria-hidden className="grid gap-5">
        {/* Volta + título + badge de status */}
        <div>
          <Skeleton className="h-3.5 w-24 rounded-none" />
          <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
            <Skeleton className="h-7 w-full max-w-md rounded-none" />
            <Skeleton className="h-5 w-28 shrink-0 rounded-none" />
          </div>
        </div>

        {/* Barra de ações: botões `h-9`, mesmo formato do <TaskActionBar>. */}
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-9 w-32 rounded-none" />
          <Skeleton className="h-9 w-28 rounded-none" />
          <Skeleton className="h-9 w-24 rounded-none" />
        </div>

        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <div className="grid content-start gap-4">
            {/* Descrição */}
            <section className="panel-cut grid gap-3 p-5">
              <Skeleton className="h-4 w-28 rounded-none" />
              <Skeleton className="h-3.5 w-full rounded-none" />
              <Skeleton className="h-3.5 w-11/12 rounded-none" />
              <Skeleton className="h-3.5 w-2/3 rounded-none" />
            </section>

            {/* Linha do tempo: avatar + texto do evento + data */}
            <section className="panel-cut grid gap-4 p-5">
              <Skeleton className="h-4 w-32 rounded-none" />
              <div className="grid gap-0">
                {TIMELINE_ENTRIES.map((width, index) => (
                  <div key={index} className="relative flex gap-3 pb-5 last:pb-0">
                    {index < TIMELINE_ENTRIES.length - 1 ? (
                      <span className="absolute left-[15px] top-8 h-[calc(100%-1.75rem)] w-px bg-border" />
                    ) : null}
                    <Skeleton className="size-8 shrink-0 rounded-full" />
                    <div className="grid min-w-0 flex-1 gap-1.5 pt-1">
                      <Skeleton className={`h-4 rounded-none ${width}`} />
                      <Skeleton className="h-3 w-32 rounded-none" />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* Painel de detalhe */}
          <section className="panel-cut grid h-fit gap-3 p-5">
            <Skeleton className="h-4 w-24 rounded-none" />
            <DetailLineSkeleton value="w-20" />
            <div className="h-px bg-border" />
            <DetailLineSkeleton value="w-24" />
            <DetailLineSkeleton value="w-28" />
            <DetailLineSkeleton value="w-24" />
            <div className="h-px bg-border" />
            <DetailLineSkeleton value="w-16" />
            <DetailLineSkeleton value="w-20" />
            <div className="h-px bg-border" />
            <DetailLineSkeleton value="w-28" />
            <DetailLineSkeleton value="w-32" />
          </section>
        </div>
      </div>
    </div>
  );
}
