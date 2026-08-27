"use client"

import * as React from "react"
import { Progress as ProgressPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        // Mesmo trilho de aço da XpBar (borda + sombra interna, canto reto),
        // mas preenchido em azul-gelo: progresso NEUTRO não pode usar ouro,
        // que é exclusivo de recompensa. As duas barras passam a falar a
        // mesma língua sem que uma roube o sinal da outra.
        "relative flex h-1 w-full items-center overflow-x-hidden border border-border bg-secondary shadow-[inset_0_1px_2px_oklch(0_0_0_/_35%)]",
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="size-full flex-1 bg-primary transition-all"
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
