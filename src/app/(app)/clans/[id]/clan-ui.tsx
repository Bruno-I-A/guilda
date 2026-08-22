import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface ClanStatusItem {
  label: string;
  value: ReactNode;
  detail?: string;
  tone?: "neutral" | "positive" | "warning" | "danger";
}

/** Leitura rápida da situação do clã, sem transformar cada número em um card. */
export function ClanStatusStrip({
  items,
  className,
}: {
  items: readonly ClanStatusItem[];
  className?: string;
}) {
  return (
    <dl
      className={cn(
        "grid border-y border-border/80 bg-card/25 sm:grid-flow-col sm:auto-cols-fr",
        className,
      )}
    >
      {items.map((item, index) => (
        <div
          key={item.label}
          className={cn(
            "relative flex min-h-16 items-center gap-3 px-3 py-2.5 sm:px-4",
            index > 0 && "border-t border-border/60 sm:border-t-0 sm:border-l",
          )}
        >
          <dd
            className={cn(
              "min-w-8 font-mono text-lg font-semibold text-foreground",
              item.tone === "positive" && "text-emerald-400",
              item.tone === "warning" && "text-amber-300",
              item.tone === "danger" && "text-destructive",
            )}
          >
            {item.value}
          </dd>
          <div className="min-w-0">
            <dt className="text-sm font-medium text-foreground/90">{item.label}</dt>
            {item.detail ? (
              <p className="truncate text-[11px] text-muted-foreground">
                {item.detail}
              </p>
            ) : null}
          </div>
        </div>
      ))}
    </dl>
  );
}

export function ClanSectionHeading({
  children,
  aside,
  className,
}: {
  children: ReactNode;
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <h2 className="hud-label shrink-0 text-foreground/80">{children}</h2>
      <span className="h-px flex-1 bg-gradient-to-r from-border via-border/70 to-transparent" />
      <span className="size-1.5 shrink-0 rotate-45 border border-primary/70" aria-hidden />
      {aside ? <div className="shrink-0">{aside}</div> : null}
    </div>
  );
}

export function ClanEmptyState({
  icon,
  title,
  description,
  compact = false,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "panel-cut panel-cut-sm grid justify-items-center border-0 bg-card/35 text-center",
        compact ? "gap-1.5 px-4 py-3" : "gap-2 px-6 py-8",
        className,
      )}
    >
      {icon ? <span className="text-primary/80">{icon}</span> : null}
      <p className={cn("font-medium", compact && "text-sm")}>{title}</p>
      {description ? (
        <p className="max-w-lg text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      ) : null}
    </div>
  );
}
