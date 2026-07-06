import { cn } from "@/lib/utils";

/** Pips de intensidade (prioridade/dificuldade): ▮▮▯ legível de relance. */
export function Pips({
  value,
  max,
  label,
  className,
}: {
  value: number;
  max: number;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn("inline-flex items-center gap-0.5", className)}
      role="img"
      aria-label={`${label}: ${value} de ${max}`}
    >
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          aria-hidden
          className={cn(
            "h-3 w-1.5 skew-x-[-8deg]",
            i < value ? "bg-primary" : "bg-secondary",
          )}
        />
      ))}
    </span>
  );
}
