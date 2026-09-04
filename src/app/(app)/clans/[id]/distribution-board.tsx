"use client";

import { Check, CircleCheckBig, Sparkles, UserRoundCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  quickCompleteUnassignedInformativeTask,
  revertCompletion,
} from "@/app/(app)/tasks/actions";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { acceptClanSuggestions, assignClanTasks } from "./actions";
import { toastWithUndo } from "@/lib/undo-toast";

import { ClanEmptyState, ClanSectionHeading } from "./clan-ui";

export interface BoardSuggestion {
  userId: string | null;
  name: string;
  recognized: boolean;
}

export interface BoardTask {
  id: string;
  title: string;
  clientName: string | null;
  dueDate: string | null;
  xpValue: number;
  suggestions: BoardSuggestion[];
}

export interface BoardGroup {
  key: string;
  informativeId: string | null;
  label: string;
  tasks: BoardTask[];
}

export interface BoardMember {
  userId: string;
  name: string;
  isLeader: boolean;
  openCount: number;
  overdueCount: number;
}

function formatDue(value: string | null): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));
}

/**
 * A fila de distribuição do clã.
 *
 * O modelo é sempre POR MISSÃO; o "pacote" é ação em lote sobre o grupo do
 * informativo. As sugestões do informativo aparecem como chips — elas nunca
 * atribuem sozinhas, só encurtam o caminho de quem decide.
 */
export function DistributionBoard({
  clanId,
  canDistribute,
  canQuickComplete,
  groups,
  members,
}: {
  clanId: string;
  canDistribute: boolean;
  canQuickComplete: boolean;
  groups: BoardGroup[];
  members: BoardMember[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [groupChoice, setGroupChoice] = useState<Record<string, string>>({});
  const [taskChoice, setTaskChoice] = useState<Record<string, string>>({});

  function run(action: () => Promise<{ ok: boolean; error?: string; data?: unknown }>) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error ?? "Não foi possível distribuir.");
        return;
      }
      const data = result.data as
        | { assigned?: number; ambiguous?: number; skipped?: number }
        | undefined;
      const assigned = data?.assigned ?? 0;
      if (assigned === 0) {
        toast.info("Nenhuma missão foi distribuída.");
      } else {
        toast.success(
          assigned === 1 ? "1 missão distribuída." : `${assigned} missões distribuídas.`,
        );
      }
      if (data?.ambiguous) {
        toast.info(
          `${data.ambiguous} ficaram para você decidir — sugestão dupla ou pessoa fora do clã.`,
        );
      }
      router.refresh();
    });
  }

  function completeDirectly(taskId: string) {
    startTransition(async () => {
      const result = await quickCompleteUnassignedInformativeTask({ taskId, clanId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      // Um clique na linha errada aqui concluía e creditava XP sem volta —
      // é a tela onde o engano é mais fácil, porque as linhas são parecidas.
      toastWithUndo({
        message: `Missão concluída diretamente. +${result.data?.xpValue ?? 0} XP`,
        undo: () =>
          revertCompletion({
            taskId,
            note: "Conclusão desfeita por quem concluiu.",
          }),
        undoneMessage:
          "Conclusão desfeita, XP estornado. A missão voltou como sua, em andamento.",
        onUndone: () => router.refresh(),
      });
      router.refresh();
    });
  }

  if (groups.length === 0) {
    return (
      <section className="grid gap-3">
        <ClanSectionHeading>Fila de distribuição</ClanSectionHeading>
        <ClanEmptyState
          icon={<Check className="size-5" aria-hidden />}
          title="Fila em ordem"
          description="Nenhuma missão está aguardando responsável."
          compact
        />
      </section>
    );
  }

  return (
    <section className="grid gap-3">
      <ClanSectionHeading>Fila de distribuição</ClanSectionHeading>

      {!canDistribute ? (
        <p className="panel-cut panel-cut-sm bg-card/35 p-3 text-center text-xs text-muted-foreground">
          Integrantes deste clã e administradores distribuem as missões. Você pode
          assumir uma missão pela página dela.
        </p>
      ) : null}

      <div className="grid gap-4">
        {groups.map((group) => {
          const selected = groupChoice[group.key] ?? "";
          const hasRecognized = group.tasks.some((task) =>
            task.suggestions.some((suggestion) => suggestion.recognized),
          );

          return (
            <div key={group.key} className="panel-cut overflow-hidden bg-card/50">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{group.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {group.tasks.length}{" "}
                    {group.tasks.length === 1 ? "missão" : "missões"} sem dono
                  </p>
                </div>

                {canDistribute ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {hasRecognized && group.informativeId ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={pending}
                        onClick={() =>
                          run(() =>
                            acceptClanSuggestions({
                              clanId,
                              informativeId: group.informativeId ?? undefined,
                            }),
                          )
                        }
                      >
                        <Sparkles className="size-4" aria-hidden /> Aceitar sugestões
                      </Button>
                    ) : null}

                    <Select
                      value={selected}
                      onValueChange={(value) =>
                        setGroupChoice((current) => ({ ...current, [group.key]: value }))
                      }
                    >
                      <SelectTrigger size="sm" className="w-40">
                        <SelectValue placeholder="Atribuir todas a…" />
                      </SelectTrigger>
                      <SelectContent>
                        {members.map((member) => (
                          <SelectItem key={member.userId} value={member.userId}>
                            {member.name} ({member.openCount})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Button
                      size="sm"
                      disabled={pending || !selected}
                      onClick={() =>
                        run(() =>
                          assignClanTasks({
                            clanId,
                            assigneeId: selected,
                            taskIds: group.tasks.map((task) => task.id),
                          }),
                        )
                      }
                    >
                      <UserRoundCheck className="size-4" aria-hidden /> Enviar
                    </Button>
                  </div>
                ) : null}
              </div>

              <ul className="divide-y">
                {group.tasks.map((task) => {
                  const due = formatDue(task.dueDate);
                  const choice = taskChoice[task.id] ?? "";

                  return (
                    <li key={task.id} className="grid gap-2 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <Link
                            href={`/tasks/${task.id}`}
                            className="font-medium hover:underline"
                          >
                            {task.title}
                          </Link>
                          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span className="font-mono text-gold">{task.xpValue} XP</span>
                            {due ? <span>vence {due}</span> : <span>sem prazo</span>}
                          </p>
                        </div>
                      </div>

                      {task.suggestions.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs text-muted-foreground">
                            Informativo sugeriu:
                          </span>
                          {task.suggestions.map((suggestion, index) => (
                            <Badge
                              key={`${task.id}-${suggestion.userId ?? suggestion.name}-${index}`}
                              variant={suggestion.recognized ? "secondary" : "outline"}
                              className={
                                suggestion.recognized ? "" : "text-muted-foreground"
                              }
                            >
                              {suggestion.name}
                              {suggestion.recognized ? "" : " (não reconhecido)"}
                            </Badge>
                          ))}
                        </div>
                      ) : null}

                      {canDistribute ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <Select
                            value={choice}
                            onValueChange={(value) =>
                              setTaskChoice((current) => ({
                                ...current,
                                [task.id]: value,
                              }))
                            }
                          >
                            <SelectTrigger size="sm" className="w-44">
                              <SelectValue placeholder="Responsável…" />
                            </SelectTrigger>
                            <SelectContent>
                              {members.map((member) => (
                                <SelectItem key={member.userId} value={member.userId}>
                                  {member.name} ({member.openCount})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={pending || !choice}
                            onClick={() =>
                              run(() =>
                                assignClanTasks({
                                  clanId,
                                  assigneeId: choice,
                                  taskIds: [task.id],
                                }),
                              )
                            }
                          >
                            Enviar
                          </Button>
                          {canQuickComplete && group.informativeId ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={pending}
                              className="border-success/35 text-success hover:bg-success/10 hover:text-success"
                              onClick={() => completeDirectly(task.id)}
                            >
                              <CircleCheckBig aria-hidden /> Concluir direto
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
