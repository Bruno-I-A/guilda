import { cn } from "@/lib/utils";

/**
 * Medalhão losangular de nível — o "escudo" do HUD.
 * Dois quadros rotacionados 45° emoldurando o número em Cinzel ouro.
 */
export function LevelEmblem({
  level,
  className,
}: {
  level: number;
  className?: string;
}) {
  return (
    <div
      className={cn("relative size-24 shrink-0", className)}
      role="img"
      aria-label={`Nível ${level}`}
    >
      <div className="absolute inset-[9%] rotate-45 border-2 border-gold/55 bg-card shadow-[inset_0_0_0_1px_oklch(1_0_0_/_4%)]" />
      <div className="absolute inset-[18%] rotate-45 border border-gold/25" />
      <div className="relative flex h-full flex-col items-center justify-center">
        <span className="font-heading text-4xl font-bold leading-none text-gold">
          {level}
        </span>
      </div>
    </div>
  );
}
