import { ChevronLeft } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * O cabeçalho de página da Guilda.
 *
 * Existia em quatorze cópias e seis formatos diferentes — a string
 * "text-2xl font-semibold tracking-wide" estava digitada em onze arquivos, e
 * cada rota nova reinventava a moldura. Aqui o <h1> não carrega classe de
 * tamanho nenhuma: o tamanho vem da escala display no globals.css, então
 * mudar o passo de título é um lugar só.
 *
 * Cobre os seis formatos que existiam: título só, título + descrição,
 * título + ação à direita, título com ícone, título com badge ao lado e
 * título com link de volta.
 */
export function PageHeader({
  title,
  description,
  action,
  backHref,
  backLabel = "Voltar",
  badges,
  icon: Icon,
  className,
  titleClassName,
}: {
  title: string;
  /** Uma frase. Some no mobile? Não — mas fica presa a `max-w-prose`. */
  description?: React.ReactNode;
  /** Botões da direita (nova missão, importar, etc.). */
  action?: React.ReactNode;
  /** Quando existe, rende a saída para cima acima do título. */
  backHref?: string;
  backLabel?: string;
  /** Badges ao lado do título (status do clã, papel, etc.). */
  badges?: React.ReactNode;
  icon?: LucideIcon;
  className?: string;
  /** Para o título que é conteúdo, não rótulo de rota — ex.: `max-w-prose`
   *  no nome de uma missão, que pode ser longo. */
  titleClassName?: string;
}) {
  return (
    <header className={cn("grid gap-1.5", className)}>
      {backHref ? (
        <Link
          href={backHref}
          className="hud-label inline-flex w-fit items-center gap-1 py-1 transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" aria-hidden />
          {backLabel}
        </Link>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h1 className={cn("inline-flex items-center gap-2", titleClassName)}>
              {Icon ? (
                <Icon className="size-5 shrink-0 text-primary" aria-hidden />
              ) : null}
              {title}
            </h1>
            {badges}
          </div>
          {description ? (
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {action ? (
          <div className="flex flex-wrap items-center gap-2">{action}</div>
        ) : null}
      </div>
    </header>
  );
}
