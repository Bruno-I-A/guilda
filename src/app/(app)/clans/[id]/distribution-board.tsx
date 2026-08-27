"use client";

import { Sparkles, Star, UserRoundCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";

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
  groups,
  members,
}: {
  clanId: string;
  canDistribute: boolean;
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

  if (groups.length === 0) {
    return (
      <section className="grid gap-3">
        <h2>Fila de distribuição</h2>
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nenhuma missão esperando dono. Quando um informativo chegar, as missões
          deste clã aparecem aqui.
        </p>
      </section>
    );
  }

  return (
    <section className="grid gap-3">
      <h2>Fila de distribuição</h2>

      {!canDistribute ? (
        <p className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
          Só o líder deste clã ou um admin distribui as missões. Você pode
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
            // `panel-cut` já traz fundo, aresta interna e canto chanfrado:
            // `rounded-lg border` só reintroduzia o retângulo que o chanfro
            // existe para remover.
            <div key={group.key} className="panel-cut">
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
                            {/* Mesmo chip de loot da linha de missão — a
                                recompensa tem uma forma só no app inteiro. */}
                            <span className="chip-loot">
                              <Star className="size-3" aria-hidden />
                              <span className="tabular-nums">{task.xpValue}</span> XP
                            </span>
                            {due ? (
                              <span>
                                vence{" "}
                                <span className="font-mono tabular-nums">{due}</span>
                              </span>
                            ) : (
                              <span>sem prazo</span>
                            )}
                          </p>
                        </div>
                      </div>

                      {task.suggestions.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {/* Rótulo de um dado, não título de seção — este é o
                              uso legítimo de `.hud-label`. */}
                          <span className="hud-label">Informativo sugeriu</span>
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
