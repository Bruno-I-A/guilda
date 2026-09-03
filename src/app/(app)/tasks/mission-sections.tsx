import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Peças de chrome da lista de missões: título de seção com contagem,
 * vazio explicado e o bloco recolhido das encerradas.
 *
 * Título é `<h2>` de verdade (18px Cinzel) — a contagem em mono ao lado é
 * o dado; a régua ornamental fecha a linha. Nada de `.hud-label` em heading.
 */
export function MissionSection({
  title,
  count,
  hint,
  children,
  className,
}: {
  title: string;
  count?: number;
  /** Uma frase curta à direita: o que esta seção espera de quem lê. */
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("grid gap-2", className)}>
      <div className="flex items-center gap-3">
        <h2 className="shrink-0">{title}</h2>
        {count !== undefined ? (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {count}
          </span>
        ) : null}
        <span className="divider-rune min-w-6 flex-1" aria-hidden />
        {hint ? <span className="hud-label hidden sm:inline">{hint}</span> : null}
      </div>
      {children}
    </section>
  );
}

export function MissionEmpty({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="panel-cut panel-cut-sm grid gap-1 bg-card/35 px-4 py-4 text-center">
      <p className="text-sm font-medium">{title}</p>
      {children ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>
      ) : null}
    </div>
  );
}

/**
 * Encerradas ficam dobradas: são histórico, não trabalho. Detalhe nativo
 * porque a lista é Server Component e abrir/fechar não precisa de estado.
 */
export function ClosedMissions({
  title = "Encerradas",
  count,
  children,
}: {
  title?: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <details className="group grid gap-2">
      <summary className="flex cursor-pointer list-none items-center gap-3 py-1 [&::-webkit-details-marker]:hidden">
        <ChevronDown
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          aria-hidden
        />
        <h2 className="shrink-0 text-muted-foreground group-open:text-foreground">
          {title}
        </h2>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {count}
        </span>
        <span className="divider-rune min-w-6 flex-1" aria-hidden />
        <span className="hud-label hidden sm:inline group-open:hidden">abrir</span>
      </summary>
      <div className="grid gap-1.5">{children}</div>
    </details>
  );
}
