import { cn } from "@/lib/utils";

/**
 * Barra de XP estilo HUD: trilho de aço sempre visível, preenchimento ouro,
 * entalhes segmentados e valor em mono dentro da barra — legível até com 0 XP.
 */
export function XpBar({
  current,
  target,
  label,
  className,
}: {
  /** XP acumulado dentro do nível atual. */
  current: number;
  /** XP total necessário para fechar o nível. */
  target: number;
  label?: string;
  className?: string;
}) {
  const ratio = target > 0 ? Math.min(Math.max(current / target, 0), 1) : 0;
  return (
    <div
      className={cn("grid gap-1", className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={target}
      aria-valuenow={current}
      aria-label={label ?? "Progresso de XP"}
    >
      <div className="relative h-5 overflow-hidden border border-border bg-secondary shadow-[inset_0_1px_2px_oklch(0_0_0_/_35%)]">
        <div
          className="h-full bg-gradient-to-b from-gold to-gold/75 transition-[width]"
          style={{ width: `${ratio * 100}%` }}
        />
        {/* Entalhes: 10 segmentos */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "repeating-linear-gradient(to right, transparent 0 calc(10% - 1px), oklch(0.14 0.02 252 / 45%) calc(10% - 1px) 10%)",
          }}
        />
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="bg-background/70 px-1.5 py-px font-mono text-xs font-semibold tabular-nums tracking-wider text-foreground">
            {current} / {target} XP
          </span>
        </span>
      </div>
    </div>
  );
}
