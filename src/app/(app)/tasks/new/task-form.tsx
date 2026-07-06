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
import { DIFFICULTY_LABELS, PRIORITY_LABELS } from "@/lib/task-ui";

import { createTask } from "../actions";

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
    toast.success("Tarefa criada!");
    router.push(`/tasks/${result.data?.taskId}`);
    router.refresh();
  }

  return (
    <Card>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <div className="grid gap-2">
            <Label htmlFor="title">Título</Label>
            <Input
              id="title"
              name="title"
              placeholder="Ex.: Revisar proposta comercial"
              maxLength={200}
              required
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="description">Descrição (opcional)</Label>
            <Textarea
              id="description"
              name="description"
              placeholder="Contexto, critérios de aceite…"
              rows={4}
              maxLength={5000}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="assignee">Responsável</Label>
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

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="priority">Prioridade</Label>
              <Select
                value={String(priority)}
                onValueChange={(v) => setPriority(Number(v))}
              >
                <SelectTrigger id="priority" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3].map((p) => (
                    <SelectItem key={p} value={String(p)}>
                      {PRIORITY_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="difficulty">Dificuldade</Label>
              <Select
                value={String(difficulty)}
                onValueChange={(v) => setDifficulty(Number(v))}
              >
                <SelectTrigger id="difficulty" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {d} — {DIFFICULTY_LABELS[d]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="dueDate">Prazo (opcional)</Label>
            <Input id="dueDate" name="dueDate" type="date" />
          </div>

          <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-4 py-3">
            <span className="text-sm text-muted-foreground">
              Recompensa ao concluir
            </span>
            <span className="inline-flex items-center gap-1 font-mono font-semibold text-gold">
              <Star className="size-4" aria-hidden />
              {xpPreview} XP
            </span>
          </div>

          <Button type="submit" disabled={submitting}>
            {submitting ? "Criando…" : "Criar tarefa"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
