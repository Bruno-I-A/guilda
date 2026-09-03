"use client";

import { CalendarClock, Flag, Star, Swords, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Pips } from "@/components/pips";
import { Button } from "@/components/ui/button";
import {
  parseQuickMission,
  quickMissionMentionAtCursor,
  suggestQuickMissionTargets,
  type QuickMissionClan,
  type QuickMissionMember,
  type QuickMissionTarget,
} from "@/domain/quick-mission";
import { calculateTaskXp } from "@/domain/xp";
import { PRIORITY_LABELS } from "@/lib/task-ui";
import { cn } from "@/lib/utils";

import { createTask } from "./actions";

function formatDue(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(year, month - 1, day));
}

function targetLabel(target: QuickMissionTarget): string {
  if (target.kind === "self") return "você";
  if (target.kind === "clan") return `clã ${target.name}`;
  return target.name;
}

/**
 * Criação de missão avulsa em UMA linha, no topo da própria lista.
 *
 * O formulário completo continua existindo para quem precisa de descrição
 * ou empresa; aqui é o caminho de 90% dos pedidos do dia a dia: "faz isso,
 * pra fulano, até sexta". Tudo que o parser lê vira campo estruturado e o
 * XP é só prévia — o servidor recalcula e congela na criação.
 */
export function QuickMissionComposer({
  members,
  clans,
  viewerId,
}: {
  members: readonly QuickMissionMember[];
  clans: readonly QuickMissionClan[];
  viewerId: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [cursor, setCursor] = useState(0);
  const [dismissedMention, setDismissedMention] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const parsed = useMemo(
    () => parseQuickMission(text, { members, clans, now: new Date() }),
    [text, members, clans],
  );
  const mention = quickMissionMentionAtCursor(text, cursor);
  const mentionKey = mention ? `${mention.start}:${mention.query}` : null;
  const suggestions =
    mention && dismissedMention !== mentionKey
      ? suggestQuickMissionTargets(mention.query, { members, clans })
      : [];

  const viewer = members.find((member) => member.userId === viewerId);
  const selfBlocked =
    parsed.target.kind === "self" ? (viewer?.resolutionError ?? null) : null;
  const xpPreview = calculateTaskXp(parsed.difficulty, parsed.priority);
  const hasText = text.trim().length > 0;
  const canSubmit =
    parsed.title.length >= 3 &&
    parsed.issues.length === 0 &&
    !selfBlocked &&
    !pending;

  function syncCursor(element: HTMLInputElement) {
    setCursor(element.selectionStart ?? element.value.length);
  }

  function applySuggestion(target: QuickMissionTarget) {
    if (!mention || target.kind === "self") return;
    const before = text.slice(0, mention.start);
    const after = text.slice(cursor).replace(/^\s+/, "");
    const inserted = `${before}@${target.name} `;
    const next = `${inserted}${after}`;
    setText(next);
    setCursor(inserted.length);
    requestAnimationFrame(() => {
      const element = inputRef.current;
      if (!element) return;
      element.focus();
      element.setSelectionRange(inserted.length, inserted.length);
    });
  }

  function submit() {
    if (!canSubmit) return;
    const target = parsed.target;
    startTransition(async () => {
      const common = {
        title: parsed.title,
        description: "",
        priority: parsed.priority,
        difficulty: parsed.difficulty,
        dueDate: parsed.dueDate ?? "",
      };
      const result =
        target.kind === "clan"
          ? await createTask({ ...common, assignmentType: "clan", clanId: target.clanId })
          : await createTask({
              ...common,
              assignmentType: "individual",
              assigneeId: target.kind === "person" ? target.userId : viewerId,
            });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        target.kind === "self"
          ? `Missão criada para você. ${xpPreview} XP ao concluir.`
          : `Missão criada para ${targetLabel(target)}.`,
      );
      setText("");
      setCursor(0);
      router.refresh();
    });
  }

  return (
    <section
      aria-label="Criar missão avulsa"
      className="panel-cut texture-iron grid gap-3 p-3 sm:p-4"
    >
      <div className="relative">
        <div
          className={cn(
            "flex items-center gap-2 border border-border bg-background/60 pl-3 pr-1.5 transition-colors focus-within:border-primary",
            pending && "opacity-70",
          )}
        >
          <Swords className="size-4 shrink-0 text-primary" aria-hidden />
          <input
            ref={inputRef}
            type="text"
            value={text}
            disabled={pending}
            maxLength={240}
            autoComplete="off"
            aria-label="Nova missão avulsa"
            aria-describedby="quick-mission-help"
            placeholder="Nova missão avulsa… ex.: Conferir DAS de agosto @Camila !alta ~sexta"
            className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            onChange={(event) => {
              setText(event.target.value);
              syncCursor(event.target);
            }}
            onSelect={(event) => syncCursor(event.currentTarget)}
            onKeyUp={(event) => syncCursor(event.currentTarget)}
            onClick={(event) => syncCursor(event.currentTarget)}
            // Sair do campo fecha a lista; clicar numa sugestão não sai
            // (o mousedown dela cancela o blur).
            onBlur={() => setDismissedMention(mentionKey)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && suggestions.length > 0) {
                event.preventDefault();
                setDismissedMention(mentionKey);
                return;
              }
              if ((event.key === "Enter" || event.key === "Tab") && suggestions.length > 0) {
                event.preventDefault();
                applySuggestion(suggestions[0]);
                return;
              }
              if (event.key === "Enter") {
                event.preventDefault();
                submit();
              }
            }}
          />
          <Button size="sm" disabled={!canSubmit} onClick={submit}>
            {pending ? "Criando…" : "Criar"}
          </Button>
        </div>

        {suggestions.length > 0 ? (
          <ul
            role="listbox"
            aria-label="Pessoas e clãs"
            className="absolute left-0 z-20 mt-1 w-full max-w-sm border border-border bg-popover shadow-md"
          >
            {suggestions.map((suggestion, index) => {
              if (suggestion.kind === "self") return null;
              const key = suggestion.kind === "person" ? suggestion.userId : suggestion.clanId;
              return (
                <li key={key} role="option" aria-selected={index === 0}>
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted",
                      index === 0 && "bg-muted/60",
                    )}
                    // mousedown, não click: o click chega depois do blur e
                    // a lista já teria sumido.
                    onMouseDown={(event) => {
                      event.preventDefault();
                      applySuggestion(suggestion);
                    }}
                  >
                    {suggestion.kind === "clan" ? (
                      <Flag className="size-3.5 text-primary" aria-hidden />
                    ) : (
                      <UserRound className="size-3.5 text-muted-foreground" aria-hidden />
                    )}
                    <span className="min-w-0 flex-1 truncate">{suggestion.name}</span>
                    <span className="hud-label">
                      {suggestion.kind === "clan" ? "clã" : "pessoa"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <span className="hud-label">para</span>
          <span className={cn("font-medium", parsed.target.kind === "self" && "text-muted-foreground")}>
            {targetLabel(parsed.target)}
          </span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="hud-label">prioridade</span>
          <Pips value={parsed.priority} max={3} label="Prioridade" />
          <span className="text-muted-foreground">{PRIORITY_LABELS[parsed.priority]}</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="hud-label">dificuldade</span>
          <Pips value={parsed.difficulty} max={5} label="Dificuldade" tone="silver" />
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="hud-label">prazo</span>
          {parsed.dueDate ? (
            <span className="inline-flex items-center gap-1 font-mono tabular-nums">
              <CalendarClock className="size-3.5" aria-hidden />
              {formatDue(parsed.dueDate)}
            </span>
          ) : (
            <span className="text-muted-foreground">sem prazo</span>
          )}
        </span>
        <span className={cn("chip-loot ml-auto", !hasText && "opacity-60")}>
          <Star className="size-3" aria-hidden /> +{xpPreview} XP
        </span>
      </div>

      {parsed.issues.length > 0 || selfBlocked ? (
        <ul className="grid gap-0.5 text-xs text-destructive" aria-live="polite">
          {parsed.issues.map((issue) => (
            <li key={issue.token}>
              <span className="font-mono">{issue.token}</span> — {issue.message}
            </li>
          ))}
          {selfBlocked ? (
            <li>
              Você ainda não tem clã principal, então a missão precisa de um{" "}
              <span className="font-mono">@clã</span> ou de outra pessoa. ({selfBlocked})
            </li>
          ) : null}
        </ul>
      ) : null}

      <p id="quick-mission-help" className="text-xs text-muted-foreground">
        Atalhos: <span className="font-mono">@pessoa</span> ou{" "}
        <span className="font-mono">@clã</span> · <span className="font-mono">!alta</span>{" "}
        <span className="font-mono">!baixa</span> · <span className="font-mono">~sexta</span>{" "}
        <span className="font-mono">~15/09</span> <span className="font-mono">~+3</span> ·{" "}
        <span className="font-mono">#1</span>–<span className="font-mono">#5</span> dificuldade.
        Sem <span className="font-mono">@</span>, a missão é sua.{" "}
        <Link href="/tasks/new" className="font-medium text-primary hover:underline">
          Precisa de descrição ou empresa? Formulário completo.
        </Link>
      </p>
    </section>
  );
}
