"use client";

import { Dices } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DRAW_LANDING_DELAY_MS,
  DRAW_ROLL_DELAYS_MS,
  pickClosingDraw,
} from "@/domain/closing-draw";
import { cn } from "@/lib/utils";

export interface ClosingDrawCandidate {
  id: string;
  name: string;
}

type DrawPhase = "idle" | "rolling" | "landed";

/** Casas acesas da grade 3×3 em cada face, como num dado de verdade. */
const PIPS: Record<number, readonly number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function otherFace(current: number): number {
  return 1 + ((current + Math.floor(Math.random() * 5)) % 6);
}

function otherCandidate(
  candidates: readonly ClosingDrawCandidate[],
  current: ClosingDrawCandidate | null,
): ClosingDrawCandidate {
  const index = Math.floor(Math.random() * candidates.length);
  if (candidates.length > 1 && candidates[index].id === current?.id) {
    return candidates[(index + 1) % candidates.length];
  }
  return candidates[index];
}

/** A empresa entra como busca na lista, com os outros filtros zerados. */
function companyHref(searchHref: string, name: string): string {
  const [path, query = ""] = searchHref.split("?");
  const params = new URLSearchParams(query);
  params.set("q", name);
  return `${path}?${params}`;
}

function DieFace({ face, phase }: { face: number; phase: DrawPhase }) {
  const lit = PIPS[face] ?? PIPS[5];
  return (
    <span
      aria-hidden
      data-state={phase}
      className="dice-tile grid size-12 shrink-0 grid-cols-3 grid-rows-3 place-items-center p-2.5"
    >
      {Array.from({ length: 9 }, (_, cell) => (
        <span
          key={cell}
          className={cn("size-1.5 rotate-45", lit.includes(cell) && "bg-primary")}
        />
      ))}
    </span>
  );
}

/**
 * Dado que sorteia a próxima empresa a fechar, entre as que ninguém tocou no
 * ano (regra em `@/domain/closing-draw`).
 *
 * O sorteio é do navegador de propósito: não grava nada, não dá XP e não
 * reserva a empresa — é um empurrão para escolher, e quem abre a empresa
 * decide se pega. Os nomes giram desacelerando até assentar; com "reduzir
 * movimento" ligado no sistema, a empresa aparece direto.
 */
export function ClosingDraw({
  year,
  candidates,
  searchHref,
}: {
  year: number;
  candidates: readonly ClosingDrawCandidate[];
  /** Endereço da lista da aba com os filtros zerados. */
  searchHref: string;
}) {
  const [phase, setPhase] = useState<DrawPhase>("idle");
  const [face, setFace] = useState(5);
  const [shown, setShown] = useState<ClosingDrawCandidate | null>(null);
  const [picked, setPicked] = useState<ClosingDrawCandidate | null>(null);
  const [tick, setTick] = useState(0);
  // A lista é sempre a mesma (só esvaziada com splice) para o cleanup do
  // efeito enxergar os timers criados depois dele.
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => window.clearTimeout(timer));
  }, []);

  function land(company: ClosingDrawCandidate, finalFace: number) {
    setShown(company);
    setPicked(company);
    setFace(finalFace);
    setPhase("landed");
  }

  function roll() {
    const chosen = pickClosingDraw(candidates, picked?.id ?? null, Math.random);
    if (!chosen) return;
    timers.current.splice(0).forEach((timer) => window.clearTimeout(timer));
    const finalFace = 1 + Math.floor(Math.random() * 6);

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      land(chosen, finalFace);
      return;
    }

    setPhase("rolling");
    setShown((current) => otherCandidate(candidates, current));
    setTick((value) => value + 1);
    let at = 0;
    for (const delay of DRAW_ROLL_DELAYS_MS) {
      at += delay;
      timers.current.push(
        window.setTimeout(() => {
          setShown((current) => otherCandidate(candidates, current));
          setFace(otherFace);
          setTick((value) => value + 1);
        }, at),
      );
    }
    timers.current.push(
      window.setTimeout(() => land(chosen, finalFace), at + DRAW_LANDING_DELAY_MS),
    );
  }

  const total = candidates.length;
  const rolling = phase === "rolling";
  const pool = `${total} ${total === 1 ? "empresa" : "empresas"} sem período nem observação em ${year}`;

  return (
    <div
      className={cn(
        "panel-cut grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 border bg-card/40 p-3 transition-colors sm:grid-cols-[auto_minmax(0,1fr)_auto]",
        phase === "landed" ? "border-primary/40" : "border-border/70",
      )}
    >
      <DieFace face={face} phase={phase} />

      <div className="min-w-0">
        <p className="hud-label">Sorteio da próxima empresa</p>
        {phase === "idle" || !shown ? (
          <p className="text-sm text-muted-foreground">
            {total === 0
              ? `Nenhuma empresa sem período nem observação em ${year}.`
              : `${pool}. Role o dado para escolher a próxima.`}
          </p>
        ) : (
          <>
            <p
              key={rolling ? tick : "landed"}
              aria-hidden={rolling}
              className={cn(
                "truncate font-semibold motion-safe:animate-in motion-safe:fade-in",
                rolling
                  ? "text-muted-foreground motion-safe:slide-in-from-bottom-1 motion-safe:duration-100"
                  : "text-foreground motion-safe:zoom-in-95 motion-safe:duration-200",
              )}
            >
              {shown.name}
            </p>
            <p className="text-xs text-muted-foreground">
              {rolling ? "Rolando…" : `Sorteada entre ${pool}.`}
            </p>
          </>
        )}
      </div>

      <div className="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-1 sm:justify-end">
        {phase === "landed" && picked ? (
          <Button asChild size="sm">
            <Link href={companyHref(searchHref, picked.name)}>Abrir na lista</Link>
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant={phase === "landed" ? "outline" : "default"}
          onClick={roll}
          disabled={rolling || total === 0}
          aria-busy={rolling}
        >
          <Dices aria-hidden />
          {phase === "landed" ? "Rolar de novo" : "Rolar o dado"}
        </Button>
      </div>

      <p className="sr-only" aria-live="polite">
        {phase === "landed" && picked ? `Empresa sorteada: ${picked.name}` : ""}
      </p>
    </div>
  );
}
