import Link from "next/link";

import { cn } from "@/lib/utils";

export type SegmentedNavItem = {
  key: string;
  label: string;
  /** Rótulo alternativo abaixo de sm. Sem isto, usa `label` sempre. */
  shortLabel?: string;
  href: string;
};

/**
 * Navegação segmentada por URL (abas do clã, período do ranking, filtro de
 * regime, seções de campanhas).
 *
 * Substitui quatro cópias byte-idênticas de uma pílula `bg-background
 * shadow-sm` — o artefato mais genérico que existia no app, numa interface
 * cuja tese é placa de ferro chanfrada. Aqui o estado ativo é um trilho
 * sublinhado em `--primary`, que é o mesmo vocabulário do item ativo da
 * sidebar e do trilho de status da linha de missão.
 *
 * Server Component de propósito: navegar aqui é trocar a URL, não estado de
 * cliente — é por isso que não usa Radix Tabs.
 */
export function SegmentedNav({
  items,
  active,
  label,
  busy = false,
  className,
}: {
  items: readonly SegmentedNavItem[];
  /** `key` do item ativo. */
  active: string;
  /** Rótulo acessível do <nav> (ex.: "Seções do clã"). */
  label: string;
  /**
   * Navegação em voo. Trocar de aba aqui é round-trip de servidor, e sem
   * isto o toque no celular não produz reação nenhuma — o usuário toca de
   * novo. Quem controla é o call site, que sabe quando a rota resolveu.
   */
  busy?: boolean;
  className?: string;
}) {
  return (
    <nav
      aria-label={label}
      aria-busy={busy || undefined}
      className={cn(
        "flex max-w-full gap-1 overflow-x-auto border-b border-border",
        busy && "opacity-60 transition-opacity",
        className,
      )}
    >
      {items.map((item) => {
        const isActive = item.key === active;
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              // O trilho é `after`, e não `border-b`, para poder cobrir a
              // borda do <nav> sem deslocar o texto em 1px ao ativar.
              "relative shrink-0 whitespace-nowrap px-3 py-2.5 font-mono text-hud font-medium uppercase tracking-hud transition-colors",
              "after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:transition-colors",
              isActive
                ? "text-foreground after:bg-primary"
                : "text-muted-foreground after:bg-transparent hover:text-foreground hover:after:bg-border",
            )}
          >
            {item.shortLabel ? (
              <>
                <span className="sm:hidden">{item.shortLabel}</span>
                <span className="hidden sm:inline">{item.label}</span>
              </>
            ) : (
              item.label
            )}
          </Link>
        );
      })}
    </nav>
  );
}
