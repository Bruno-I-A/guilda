"use client";

import { Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PRIORITY_LABELS } from "@/lib/task-ui";
import { cn } from "@/lib/utils";

import { DifficultyPips } from "@/components/difficulty-pips-input";

import { createTask } from "../actions";

/** Prioridade como 3 botões segmentados. */
function PrioritySegments({
  value,
  onChange,
}: {
  value: number;
  onChange: (p: number) => void;
}) {
  return (
    <div
      className="grid grid-cols-3 border border-border"
      role="radiogroup"
      aria-label="Prioridade"
    >
      {[1, 2, 3].map((p) => (
        <button
          key={p}
          type="button"
          role="radio"
          aria-checked={value === p}
          onClick={() => onChange(p)}
          className={cn(
            "px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring",
            value === p
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
            p < 3 && "border-r border-border",
          )}
        >
          {PRIORITY_LABELS[p]}
        </button>
      ))}
    </div>
  );
}

export function TaskForm({
  members,
  currentUserId,
}: {
  members: { userId: string; name: string }[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [assigneeId, setAssigneeId] = useState(currentUserId);
  const [priority, setPriority] = useState(2);
  const [difficulty, setDifficulty] = useState(2);
  const [submitting, setSubmitting] = useState(false);

  // Apenas PREVIEW — o valor real é recalculado e congelado no servidor.
  const xpPreview = difficulty * 20 + (priority - 1) * 10;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    const result = await createTask({
      title: String(form.get("title") ?? ""),
      description: String(form.get("description") ?? ""),
      assigneeId,
      priority,
      difficulty,
      dueDate: String(form.get("dueDate") ?? ""),
    });
    if (!result.ok) {
      setSubmitting(false);
      toast.error(result.error);
      return;
    }
    toast.success("Missão criada!");
    router.push(`/tasks/${result.data?.taskId}`);
    router.refresh();
  }

  return (
    <Card className="panel-cut texture-iron">
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-5" noValidate>
          <div className="grid gap-2">
            <Label htmlFor="title" className="hud-label">
              Título
            </Label>
            <Input
              id="title"
              name="title"
              placeholder="Ex.: Revisar proposta comercial"
              maxLength={200}
              required
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="description" className="hud-label">
              Descrição (opcional)
            </Label>
            <Textarea
              id="description"
              name="description"
              placeholder="Contexto, critérios de aceite…"
              rows={4}
              maxLength={5000}
            />
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="grid content-start gap-2">
              <Label htmlFor="assignee" className="hud-label">
                Responsável
              </Label>
              <Select value={assigneeId} onValueChange={setAssigneeId}>
                <SelectTrigger id="assignee" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {members.map((m) => (
                    <SelectItem key={m.userId} value={m.userId}>
                      {m.name}
                      {m.userId === currentUserId ? " (você)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid content-start gap-2">
              <Label htmlFor="dueDate" className="hud-label">
                Prazo (opcional)
              </Label>
              <Input id="dueDate" name="dueDate" type="date" />
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="grid content-start gap-2">
              <span className="hud-label">Prioridade</span>
              <PrioritySegments value={priority} onChange={setPriority} />
            </div>
            <div className="grid content-start gap-2">
              <span className="hud-label">Dificuldade</span>
              <DifficultyPips value={difficulty} onChange={setDifficulty} />
            </div>
          </div>

          {/* Banner de loot: a recompensa reage às escolhas acima. */}
          <div className="panel-cut panel-cut-sm flex items-center justify-between bg-gold/10 px-4 py-3 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--gold)_35%,transparent)]">
            <span className="hud-label !text-gold/80">Recompensa ao concluir</span>
            <span className="inline-flex items-center gap-1.5 font-mono text-lg font-bold text-gold">
              <Star className="size-4" aria-hidden />
              {xpPreview} XP
            </span>
          </div>

          <Button type="submit" disabled={submitting} size="lg">
            {submitting ? "Criando…" : "Criar missão"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
