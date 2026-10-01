"use client";

import { Dices, Settings2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CHALLENGE_RULE_LIMITS,
  challengeClock,
  challengeResult,
  type ChallengeRules,
  type ChallengeStatus,
} from "@/domain/closing-challenge";
import { DRAW_LANDING_DELAY_MS, DRAW_ROLL_DELAYS_MS } from "@/domain/closing-draw";
import type { ClosingGroup } from "@/lib/closings-ui";
import { cn } from "@/lib/utils";

import {
  abandonClosingChallenge,
  releaseClosingChallenge,
  rollClosingChallenge,
  updateClosingChallengeSettings,
} from "./closing-challenge-actions";

export interface ChallengeCandidate {
  id: string;
  name: string;
}

export interface MyChallengeView {
  id: string;
  clientName: string;
  /** A lista filtrada na empresa — no regime e no ano do desafio. */
  href: string;
  status: ChallengeStatus;
  startedAt: string;
  deadlineAt: string;
  endedAt: string | null;
  inTime: boolean | null;
  awardedXp: number | null;
  capped: boolean;
  releasedByOther: boolean;
}

export interface PlayingView {
  id: string;
  userName: string;
  clientName: string;
  deadlineAt: string;
  isMine: boolean;
}

export interface ScoreView {
  userId: string;
  userName: string;
  closed: number;
  xp: number;
}

type DieState = "idle" | "rolling" | "landed";

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
  candidates: readonly ChallengeCandidate[],
  current: ChallengeCandidate | null,
): ChallengeCandidate | null {
  if (candidates.length === 0) return current;
  const index = Math.floor(Math.random() * candidates.length);
  if (candidates.length > 1 && candidates[index].id === current?.id) {
    return candidates[(index + 1) % candidates.length];
  }
  return candidates[index];
}

function DieFace({ face, state }: { face: number; state: DieState }) {
  const lit = PIPS[face] ?? PIPS[5];
  return (
    <span
      aria-hidden
      data-state={state}
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
 * Relógio da faixa corrigido pelo relógio do servidor: o prazo é gravado no
 * banco, e o computador de quem joga pode estar adiantado ou atrasado.
 */
function useServerNow(serverNow: string, running: boolean): number {
  const [now, setNow] = useState(() => Date.parse(serverNow));
  useEffect(() => {
    if (!running) return;
    const offset = Date.parse(serverNow) - Date.now();
    const id = window.setInterval(() => setNow(Date.now() + offset), 1000);
    return () => window.clearInterval(id);
  }, [serverNow, running]);
  return now;
}

const RULE_FIELDS = [
  { key: "timeLimitMinutes", label: "Prazo (minutos)" },
  { key: "baseXp", label: "XP ao fechar" },
  { key: "bonusXp", label: "Bônus no prazo (XP)" },
  { key: "dailyPaidCap", label: "Desafios pagos por dia" },
] as const;

function RulesDialog({ clanId, rules }: { clanId: string; rules: ChallengeRules }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function save(formData: FormData) {
    const values = Object.fromEntries(
      RULE_FIELDS.map((field) => [field.key, Number(formData.get(field.key))]),
    ) as Record<(typeof RULE_FIELDS)[number]["key"], number>;
    startTransition(async () => {
      const result = await updateClosingChallengeSettings({ clanId, ...values });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Regras do desafio salvas.");
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="touch-target"
          aria-label="Regras do desafio"
        >
          <Settings2 aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Regras do desafio</DialogTitle>
          <DialogDescription>
            Valem para as próximas roladas. Desafio em andamento segue as regras de
            quando foi rolado.
          </DialogDescription>
        </DialogHeader>
        <form action={save} className="grid gap-3">
          {RULE_FIELDS.map((field) => {
            const limits = CHALLENGE_RULE_LIMITS[field.key];
            return (
              <div key={field.key} className="grid gap-1.5">
                <Label htmlFor={`challenge-${field.key}`}>{field.label}</Label>
                <Input
                  id={`challenge-${field.key}`}
                  name={field.key}
                  type="number"
                  inputMode="numeric"
                  min={limits.min}
                  max={limits.max}
                  defaultValue={rules[field.key]}
                  required
                />
              </div>
            );
          })}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              Salvar regras
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Desafio do dado: rolar reserva a empresa e abre o prazo; fechar o período
 * na lista conclui — quem decide é o servidor, pelo sync que a porta única de
 * escrita chama. O giro espera a resposta do servidor e assenta na empresa
 * sorteada por ele, nunca numa escolhida aqui.
 */
export function ClosingChallenge({
  clanId,
  year,
  group,
  candidates,
  rules,
  paidToday,
  serverNow,
  mine,
  playing,
  scoreboard,
  canPlay,
  canConfigure,
}: {
  clanId: string;
  year: number;
  group: ClosingGroup;
  /** Só alimentam o giro; a sorteada sai do servidor. */
  candidates: readonly ChallengeCandidate[];
  rules: ChallengeRules;
  paidToday: number;
  serverNow: string;
  mine: MyChallengeView | null;
  playing: readonly PlayingView[];
  scoreboard: readonly ScoreView[];
  canPlay: boolean;
  canConfigure: boolean;
}) {
  const [rolling, setRolling] = useState(false);
  const [shown, setShown] = useState<ChallengeCandidate | null>(null);
  const [face, setFace] = useState(5);
  const [tick, setTick] = useState(0);
  const [landed, setLanded] = useState(false);
  const [pending, startTransition] = useTransition();
  // A lista é sempre a mesma (só esvaziada com splice) para o cleanup do
  // efeito enxergar os timers criados depois dele.
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const pendingTimers = timers.current;
    return () => pendingTimers.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const active = mine?.status === "active" ? mine : null;
  const finished = mine && mine.status !== "active" ? mine : null;
  const now = useServerNow(serverNow, Boolean(active) || playing.length > 0);
  const dieState: DieState = rolling ? "rolling" : landed ? "landed" : "idle";

  function spin(step: number) {
    setShown((current) => otherCandidate(candidates, current));
    setFace(otherFace);
    setTick((value) => value + 1);
    const delay = DRAW_ROLL_DELAYS_MS[Math.min(step, DRAW_ROLL_DELAYS_MS.length - 1)];
    timers.current.push(window.setTimeout(() => spin(step + 1), delay));
  }

  function roll() {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const startedAt = Date.now();
    const minimum = reduce
      ? 0
      : DRAW_ROLL_DELAYS_MS.reduce((sum, delay) => sum + delay, 0) + DRAW_LANDING_DELAY_MS;
    setRolling(true);
    if (!reduce) spin(0);
    startTransition(async () => {
      const result = await rollClosingChallenge({ clanId, year, group });
      const wait = minimum - (Date.now() - startedAt);
      if (wait > 0) await new Promise((resolve) => window.setTimeout(resolve, wait));
      timers.current.splice(0).forEach((timer) => window.clearTimeout(timer));
      setRolling(false);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (result.data) {
        setShown({ id: result.data.clientId, name: result.data.clientName });
      }
      setFace(1 + Math.floor(Math.random() * 6));
      setLanded(true);
    });
  }

  function abandon(challengeId: string) {
    startTransition(async () => {
      const result = await abandonClosingChallenge({ clanId, challengeId });
      if (!result.ok) toast.error(result.error);
    });
  }

  function release(challengeId: string) {
    startTransition(async () => {
      const result = await releaseClosingChallenge({ clanId, challengeId });
      if (!result.ok) toast.error(result.error);
      else toast.success("Empresa liberada para o sorteio.");
    });
  }

  const total = candidates.length;
  const rulesLine = `${rules.timeLimitMinutes} min · +${rules.baseXp} XP ao fechar · +${rules.bonusXp} no prazo · ${paidToday} de ${rules.dailyPaidCap} pagos hoje`;
  const result =
    finished && finished.status !== "active"
      ? challengeResult({
          status: finished.status,
          inTime: finished.inTime,
          awardedXp: finished.awardedXp,
          capped: finished.capped,
          startedAt: new Date(finished.startedAt),
          endedAt: finished.endedAt ? new Date(finished.endedAt) : null,
          releasedByOther: finished.releasedByOther,
        })
      : null;
  const clock = active ? challengeClock(Date.parse(active.deadlineAt), now) : null;

  return (
    <section
      aria-label="Desafio do dado"
      className={cn(
        "panel-cut grid min-w-0 grid-cols-1 gap-3 border bg-card/40 p-3",
        active ? "border-primary/40" : "border-border/70",
      )}
    >
      <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
        <DieFace face={face} state={dieState} />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1">
            <p className="hud-label">Desafio do dado</p>
            {canConfigure ? <RulesDialog clanId={clanId} rules={rules} /> : null}
          </div>
          {rolling ? (
            <p
              key={tick}
              aria-hidden
              className="truncate font-semibold text-muted-foreground motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-100"
            >
              {shown?.name ?? "Rolando…"}
            </p>
          ) : active && clock ? (
            <>
              <p className="truncate font-semibold">{active.clientName}</p>
              <p
                className={cn(
                  "font-mono text-sm tabular-nums",
                  clock.late ? "text-warning" : "text-primary",
                )}
              >
                {clock.late ? clock.label : `${clock.label} restantes`}
              </p>
            </>
          ) : finished && result ? (
            <>
              <p className="truncate font-semibold">{finished.clientName}</p>
              <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                {result.xp ? <span className="chip-loot">+{result.xp} XP</span> : null}
                {result.text}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {total === 0
                ? `Nenhuma empresa livre sem período nem observação em ${year}.`
                : `${total} ${total === 1 ? "empresa" : "empresas"} no sorteio de ${year}. A sorteada fica reservada para você.`}
            </p>
          )}
        </div>
        <div className="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-1 sm:justify-end">
          {active && !rolling ? (
            <>
              <Button asChild size="sm">
                <Link href={active.href}>Abrir na lista</Link>
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => abandon(active.id)}
              >
                Desistir
              </Button>
            </>
          ) : canPlay ? (
            <Button
              type="button"
              size="sm"
              variant={finished ? "outline" : "default"}
              onClick={roll}
              disabled={rolling || pending || total === 0}
              aria-busy={rolling}
            >
              <Dices aria-hidden />
              {finished ? "Rolar de novo" : "Rolar o dado"}
            </Button>
          ) : null}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{rulesLine}</p>
      {active ? (
        <p className="text-xs text-muted-foreground">
          Registre o período como fechado na lista para concluir. Observação nesta
          empresa encerra o desafio sem XP.
        </p>
      ) : null}

      {playing.length > 0 || scoreboard.length > 0 ? (
        <div className="grid min-w-0 grid-cols-1 gap-3 border-t border-border/50 pt-3 sm:grid-cols-2">
          <div className="grid min-w-0 grid-cols-1 content-start gap-1">
            <p className="hud-label">Jogando agora</p>
            {playing.length === 0 ? (
              <p className="text-xs text-muted-foreground">Ninguém com desafio aberto.</p>
            ) : (
              <ul className="grid min-w-0 grid-cols-1 divide-y divide-border/40">
                {playing.map((item) => {
                  const itemClock = challengeClock(Date.parse(item.deadlineAt), now);
                  return (
                    <li
                      key={item.id}
                      className="flex min-w-0 items-center justify-between gap-2 py-1 text-sm"
                    >
                      <span className="min-w-0 truncate">
                        {item.userName} · {item.clientName}
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        <span
                          className={cn(
                            "font-mono text-xs tabular-nums",
                            itemClock.late ? "text-warning" : "text-muted-foreground",
                          )}
                        >
                          {itemClock.label}
                        </span>
                        {canConfigure && !item.isMine ? (
                          <Button
                            type="button"
                            size="xs"
                            variant="ghost"
                            className="touch-target"
                            disabled={pending}
                            onClick={() => release(item.id)}
                          >
                            Liberar
                          </Button>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="grid min-w-0 grid-cols-1 content-start gap-1">
            <p className="hud-label">Placar de hoje</p>
            {scoreboard.length === 0 ? (
              <p className="text-xs text-muted-foreground">Ninguém fechou desafio hoje.</p>
            ) : (
              <ol className="grid min-w-0 grid-cols-1 divide-y divide-border/40">
                {scoreboard.map((row) => (
                  <li
                    key={row.userId}
                    className="flex min-w-0 items-center justify-between gap-2 py-1 text-sm"
                  >
                    <span className="min-w-0 truncate">{row.userName}</span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        {row.closed} {row.closed === 1 ? "fechada" : "fechadas"}
                      </span>
                      {row.xp > 0 ? <span className="chip-loot">+{row.xp} XP</span> : null}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      ) : null}

      <p className="sr-only" aria-live="polite">
        {active
          ? `Desafio em andamento: ${active.clientName}.`
          : finished && result
            ? `${finished.clientName}: ${result.xp ? `+${result.xp} XP, ` : ""}${result.text}.`
            : ""}
      </p>
    </section>
  );
}
