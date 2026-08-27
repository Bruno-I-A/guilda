import { Skeleton } from "@/components/ui/skeleton";

/**
 * Esqueleto do /clients.
 *
 * A listagem varre as ~250 empresas-cliente com filtro de regime e busca por
 * nome. A silhueta: cabeçalho com duas ações, filtro segmentado + campo de
 * busca, e dez linhas chanfradas (nome em cima; badge de regime e CNPJ
 * embaixo) com o botão de ações à direita.
 */

/** Filtro de regime: "Todos" + os regimes tributários. */
const REGIME_TAB_WIDTHS = ["w-14", "w-20", "w-24", "w-20"] as const;

const CLIENT_ROWS = [
  { name: "w-2/3", meta: "w-40" },
  { name: "w-1/2", meta: "w-36" },
  { name: "w-3/4", meta: "w-40" },
  { name: "w-2/5", meta: "w-32" },
  { name: "w-3/5", meta: "w-40" },
  { name: "w-4/5", meta: "w-36" },
  { name: "w-1/2", meta: "w-40" },
  { name: "w-7/12", meta: "w-32" },
  { name: "w-2/3", meta: "w-40" },
  { name: "w-1/2", meta: "w-36" },
] as const;

export default function ClientsLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Carregando empresas-cliente"
      className="grid gap-5"
    >
      <span className="sr-only">Carregando empresas-cliente…</span>

      <div aria-hidden className="grid gap-5">
        {/* Cabeçalho + importar/nova empresa */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid gap-2">
            <Skeleton className="h-7 w-36 rounded-none" />
            <Skeleton className="h-4 w-72 max-w-full rounded-none" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-9 w-28 rounded-none" />
            <Skeleton className="h-9 w-36 rounded-none" />
          </div>
        </div>

        {/* Filtro segmentado (trilho sublinhado) + busca */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex max-w-full gap-1 overflow-hidden border-b border-border">
            {REGIME_TAB_WIDTHS.map((width, index) => (
              <div key={index} className="shrink-0 px-3 py-2.5">
                <Skeleton className={`h-4 rounded-none ${width}`} />
              </div>
            ))}
          </div>
          <Skeleton className="mb-1 h-9 w-56 rounded-none" />
        </div>

        {/* Lista de empresas */}
        <ul className="grid gap-1.5">
          {CLIENT_ROWS.map((row, index) => (
            <li
              key={index}
              className="panel-cut panel-cut-sm flex items-center gap-3 px-4 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <Skeleton className={`h-4 rounded-none ${row.name}`} />
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Skeleton className="h-4 w-24 rounded-none" />
                  <Skeleton className={`h-3 rounded-none ${row.meta}`} />
                </div>
              </div>
              {/* Botão de ações da linha */}
              <Skeleton className="size-8 shrink-0 rounded-none" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
