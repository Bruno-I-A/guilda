import { Building2, CalendarClock, Star, UsersRound } from "lucide-react";
import Link from "next/link";

import { Pips } from "@/components/pips";
import { Badge } from "@/components/ui/badge";
import type { TaskStatus } from "@/domain/task-state";
import {
  formatDueDate,
  isOverdue,
  STATUS_BADGE_CLASSES,
  STATUS_LABELS,
  STATUS_RAIL_CLASSES,
} from "@/lib/task-ui";
import { cn } from "@/lib/utils";

export type MissionRowTask = {
  id: string;
  title: string;
  status: TaskStatus;
  xpValue: number;
  dueDate: Date | null;
  /** Só a variante `full` mostra os pips. */
  priority?: number;
  difficulty?: number;
  clanName?: string | null;
  clientName?: string | null;
  assigneeName?: string | null;
};

/**
 * A linha de missão — o objeto principal do app.
 *
 * Existia em dois designs sem relação: `/tasks` e `/dashboard` tinham painel
 * chanfrado, trilho de status e chip de loot; a Mesa do Líder em
 * `/clans/[id]` tinha um `rounded-lg` sem nenhum dos três. Justamente a tela
 * cuja finalidade é triagem era a que derrubava os sinais de triagem.
 *
 * Os metadados vêm em DOIS grupos, não numa fileira de seis:
 *   estado      → badge de status + pips de prioridade/dificuldade
 *   atribuição  → empresa · clã · responsável · prazo
 * Antes tudo dividia uma flex row com `gap-x-4` e nada dizia onde um assunto
 * terminava e o outro começava.
 */
export function MissionRow({
  task,
  variant = "full",
  frame = "panel",
  href,
  showStatus = true,
  trailing,
  after,
  className,
}: {
  task: MissionRowTask;
  /** `full` abre os dois grupos de metadado; `compact` resume numa linha. */
  variant?: "full" | "compact";
  /**
   * `panel` é a linha solta, com o painel chanfrado próprio. `flat` é a linha
   * DENTRO de um painel maior (o pacote de um Informativo): só o trilho de
   * status e o hover, sem chanfro dentro de chanfro.
   */
  frame?: "panel" | "flat";
  /**
   * Destino do clique. O padrão é a página da missão; a lista passa o
   * `returnTo` para a pessoa voltar ao mesmo recorte de onde saiu.
   */
  href?: string;
  /** Na `compact`, some com o rótulo de status (quem já sabe o status pelo contexto). */
  showStatus?: boolean;
  /** Slot ANTES do chip de XP: avatar do responsável, etiqueta "disponível". */
  trailing?: React.ReactNode;
  /**
   * Slot DEPOIS do chip de XP, na borda direita. É onde mora o chevron:
   * "isso leva a algum lugar" é afordância da borda da linha, não um
   * metadado — se entrar antes do chip, empurra a recompensa para o meio.
   */
  after?: React.ReactNode;
  className?: string;
}) {
  const overdue = isOverdue(task.dueDate, task.status);
  const rail = overdue ? "border-l-destructive" : STATUS_RAIL_CLASSES[task.status];
  const target = href ?? `/tasks/${task.id}`;
  const surface =
    frame === "panel"
      ? "panel-cut panel-cut-sm hover:bg-accent/40"
      : "hover:bg-accent/30";

  const due = task.dueDate ? (
    <span
      className={cn(
        "inline-flex items-center gap-1",
        overdue && "font-medium text-destructive",
      )}
    >
      <CalendarClock className="size-3.5 shrink-0" aria-hidden />
      {overdue ? "atrasada · " : ""}
      <span className="font-mono tabular-nums">{formatDueDate(task.dueDate)}</span>
    </span>
  ) : null;

  const xpChip = (
    <span className="chip-loot shrink-0">
      <Star className="size-3" aria-hidden /> {task.xpValue} XP
    </span>
  );

  if (variant === "compact") {
    // Uma linha secundária só: o que dá para ler de relance sem abrir.
    const parts = [
      showStatus ? STATUS_LABELS[task.status] : null,
      task.clientName ?? task.clanName ?? null,
      task.assigneeName ?? null,
    ].filter(Boolean);

    return (
      <Link
        href={target}
        className={cn(
          "flex items-center gap-3 border-l-2 px-4 py-2.5 transition-colors",
          surface,
          rail,
          className,
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{task.title}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            {parts.length > 0 ? <span className="truncate">{parts.join(" · ")}</span> : null}
            {parts.length > 0 && due ? <span aria-hidden>·</span> : null}
            {due}
          </span>
        </span>
        {trailing}
        {xpChip}
        {after}
      </Link>
    );
  }

  return (
    <Link
      href={target}
      className={cn(
        "flex flex-col gap-2 border-l-2 px-4 py-3 transition-colors",
        surface,
        rail,
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 flex-1 truncate font-medium leading-snug">
          {task.title}
        </span>
        {xpChip}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
        {/* Grupo 1 — estado */}
        <span className="inline-flex items-center gap-2">
          <Badge className={cn("h-4 px-1.5", STATUS_BADGE_CLASSES[task.status])}>
            {STATUS_LABELS[task.status]}
          </Badge>
          {task.priority !== undefined ? (
            <Pips value={task.priority} max={3} label="Prioridade" />
          ) : null}
          {task.difficulty !== undefined ? (
            <Pips
              value={task.difficulty}
              max={5}
              label="Dificuldade"
              tone="silver"
            />
          ) : null}
        </span>

        <span aria-hidden className="hidden h-3 w-px bg-border sm:block" />

        {/* Grupo 2 — atribuição */}
        <span className="inline-flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          {task.clientName ? (
            <span className="inline-flex min-w-0 items-center gap-1">
              <Building2 className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{task.clientName}</span>
            </span>
          ) : null}
          <span className="inline-flex min-w-0 items-center gap-1">
            <UsersRound className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{task.clanName ?? "Sem clã"}</span>
          </span>
          <span className="truncate">
            responsável: {task.assigneeName ?? "Sem responsável"}
          </span>
          {due}
        </span>

        {trailing}
      </div>
    </Link>
  );
}
