import { Skeleton } from "@/components/ui/skeleton";

/**
 * Esqueleto do /dashboard.
 *
 * A rota dispara seis consultas antes do primeiro paint. Sem isto a tela
 * fica em branco no 4G e o usuário toca de novo achando que não pegou.
 *
 * A silhueta é a real: banner de vitrine (emblema losangular + barra de XP +
 * três links de stat) e DUAS seções de missão, cada uma com título, divisor
 * e seis linhas chanfradas compactas. As classes de painel são as mesmas da
 * linha de verdade (`panel-cut panel-cut-sm` + `border-l-2` + `px-4 py-2.5`)
 * justamente para o layout não pular quando o conteúdo chegar.
 */

/** Larguras variadas: barra uniforme vira código de barras, não conteúdo. */
const MY_ROWS = [
  { title: "w-3/5", meta: "w-2/5" },
  { title: "w-4/5", meta: "w-1/3" },
  { title: "w-1/2", meta: "w-2/5" },
  { title: "w-2/3", meta: "w-1/4" },
  { title: "w-3/4", meta: "w-1/3" },
  { title: "w-2/5", meta: "w-2/5" },
] as const;

const CLAN_ROWS = [
  { title: "w-2/3", meta: "w-1/2" },
  { title: "w-1/2", meta: "w-2/5" },
  { title: "w-4/5", meta: "w-1/3" },
  { title: "w-3/5", meta: "w-1/2" },
  { title: "w-2/5", meta: "w-1/3" },
  { title: "w-3/4", meta: "w-2/5" },
] as const;

/** Uma linha compacta de missão: título + metadado à esquerda, chip de XP à direita. */
function MissionRowSkeleton({
  title,
  meta,
}: {
  title: string;
  meta: string;
}) {
  return (
    <li className="panel-cut panel-cut-sm flex items-center gap-3 border-l-2 border-l-border/60 px-4 py-2.5">
      <div className="grid min-w-0 flex-1 gap-2">
        <Skeleton className={`h-4 rounded-none ${title}`} />
        <Skeleton className={`h-3 rounded-none ${meta}`} />
      </div>
      {/* Chip de loot: 1.375rem é a altura exata de `.chip-loot`. */}
      <Skeleton className="h-[1.375rem] w-16 shrink-0 rounded-none" />
    </li>
  );
}

export default function DashboardLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Carregando o painel da guilda"
      className="grid gap-6"
    >
      <span className="sr-only">Carregando o painel da guilda…</span>

      <div aria-hidden className="grid gap-6">
        {/* Cabeçalho */}
        <div className="grid gap-2">
          <Skeleton className="h-7 w-44 rounded-none" />
          <Skeleton className="h-4 w-full max-w-sm rounded-none" />
        </div>

        {/* Banner de vitrine */}
        <section className="panel-cut texture-iron flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:gap-6 sm:p-6">
          {/* Emblema de nível: losango, igual ao <LevelEmblem>. */}
          <div className="relative size-24 shrink-0">
            <Skeleton className="absolute inset-[9%] rotate-45 rounded-none" />
          </div>
          <div className="grid min-w-0 flex-1 gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Skeleton className="h-3 w-56 max-w-full rounded-none" />
              <Skeleton className="h-3.5 w-24 rounded-none" />
            </div>
            {/* Barra de XP: h-5, igual ao <XpBar>. */}
            <Skeleton className="h-5 w-full rounded-none" />
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              <Skeleton className="h-3.5 w-28 rounded-none" />
              <Skeleton className="h-3.5 w-36 rounded-none" />
              <Skeleton className="h-3.5 w-24 rounded-none" />
            </div>
          </div>
        </section>

        {/* Suas missões */}
        <section className="grid gap-3">
          <div className="flex items-center gap-3">
            <Skeleton className="h-3 w-28 shrink-0 rounded-none" />
            <div className="divider-rune flex-1" />
            <Skeleton className="h-3 w-16 shrink-0 rounded-none" />
          </div>
          <ul className="grid gap-1.5">
            {MY_ROWS.map((row, index) => (
              <MissionRowSkeleton key={index} title={row.title} meta={row.meta} />
            ))}
          </ul>
        </section>

        {/* Missões dos seus clãs */}
        <section className="grid gap-3">
          <div className="flex items-center gap-3">
            <Skeleton className="size-4 shrink-0 rounded-none" />
            <Skeleton className="h-3 w-40 shrink-0 rounded-none" />
            <div className="divider-rune flex-1" />
            <Skeleton className="h-3 w-16 shrink-0 rounded-none" />
          </div>
          <ul className="grid gap-1.5">
            {CLAN_ROWS.map((row, index) => (
              <MissionRowSkeleton key={index} title={row.title} meta={row.meta} />
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
