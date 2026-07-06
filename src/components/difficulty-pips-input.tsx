"use client";

import { DIFFICULTY_LABELS } from "@/lib/task-ui";
import { cn } from "@/lib/utils";

/** Seletor de dificuldade como pips clicáveis (1–5), estilo alocação de pontos. */
export function DifficultyPips({
  value,
  onChange,
}: {
  value: number;
  onChange: (d: number) => void;
}) {
  return (
    <div
      className="flex items-center gap-3"
      role="radiogroup"
      aria-label="Dificuldade"
    >
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((d) => (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={value === d}
            aria-label={`${d} — ${DIFFICULTY_LABELS[d]}`}
            onClick={() => onChange(d)}
            className={cn(
              "h-7 w-4 skew-x-[-8deg] border transition-colors focus-visible:outline-2 focus-visible:outline-ring",
              d <= value
                ? "border-primary/60 bg-primary"
                : "border-border bg-secondary hover:bg-accent",
            )}
          />
        ))}
      </div>
      <span className="font-mono text-xs text-muted-foreground">
        {value} — {DIFFICULTY_LABELS[value]}
      </span>
    </div>
  );
}
