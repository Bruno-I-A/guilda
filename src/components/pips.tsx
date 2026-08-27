import { cn } from "@/lib/utils";

/**
 * Pips de intensidade (prioridade/dificuldade): ▮▮▯ legível de relance.
 *
 * O `tone` existe porque prioridade e dificuldade aparecem LADO A LADO na
 * linha de missão, e dois conjuntos de pips da mesma cor eram
 * indistinguíveis à primeira vista. Prioridade fica no azul-gelo do acento;
 * dificuldade, na prata fosca. Nenhum dos dois em ouro — ouro é recompensa.
 */
const TONE_CLASSES = {
  primary: { on: "bg-primary", off: "bg-secondary" },
  silver: { on: "bg-silver/70", off: "bg-secondary" },
} as const;

export function Pips({
  value,
  max,
  label,
  tone = "primary",
  className,
}: {
  value: number;
  max: number;
  label: string;
  tone?: keyof typeof TONE_CLASSES;
  className?: string;
}) {
  const colors = TONE_CLASSES[tone];
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
            i < value ? colors.on : colors.off,
          )}
        />
      ))}
    </span>
  );
}
