"use client";

import { Info, Star, UserRound, UsersRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
  clans,
  currentUserId,
}: {
  members: {
    userId: string;
    name: string;
    clanName: string | null;
    resolutionError: string | null;
  }[];
  clans: { id: string; name: string }[];
  currentUserId: string;
}) {
  const router = useRouter();
  const eligibleMembers = members.filter((member) => !member.resolutionError);
  const initialAssignee =
    eligibleMembers.find((member) => member.userId === currentUserId)?.userId ??
    eligibleMembers[0]?.userId ??
    "";
  const [assignmentType, setAssignmentType] = useState<"individual" | "clan">(
    initialAssignee ? "individual" : "clan",
  );
  const [assigneeId, setAssigneeId] = useState(initialAssignee);
  const [clanId, setClanId] = useState(clans[0]?.id ?? "");
  const [priority, setPriority] = useState(2);
  const [difficulty, setDifficulty] = useState(2);
  const [submitting, setSubmitting] = useState(false);

  // Apenas PREVIEW — o valor real é recalculado e congelado no servidor.
  const xpPreview = difficulty * 20 + (priority - 1) * 10;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    const common = {
      title: String(form.get("title") ?? ""),
      description: String(form.get("description") ?? ""),
      priority,
      difficulty,
      dueDate: String(form.get("dueDate") ?? ""),
    };
    const result = assignmentType === "individual"
      ? await createTask({ ...common, assignmentType, assigneeId })
      : await createTask({ ...common, assignmentType, clanId });
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
          <fieldset className="grid gap-2">
            <legend className="hud-label mb-2">Destino da missão</legend>
            <div className="grid grid-cols-2 rounded-lg border p-1" role="radiogroup">
              <button
                type="button"
                role="radio"
                aria-checked={assignmentType === "individual"}
                onClick={() => setAssignmentType("individual")}
                disabled={eligibleMembers.length === 0}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                  assignmentType === "individual"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <UserRound aria-hidden className="size-4" /> Para uma pessoa
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={assignmentType === "clan"}
                onClick={() => setAssignmentType("clan")}
                disabled={clans.length === 0}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                  assignmentType === "clan"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <UsersRound aria-hidden className="size-4" /> Para um clã
              </button>
            </div>
          </fieldset>

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
            <p className="text-xs text-muted-foreground">
              Acrescente o contexto, os documentos necessários e o que define a
              missão como concluída.
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="grid content-start gap-2">
              {assignmentType === "individual" ? (
                <>
                  <Label htmlFor="assignee" className="hud-label">
                    Pessoa responsável
                  </Label>
                  <Select value={assigneeId} onValueChange={setAssigneeId}>
                    <SelectTrigger id="assignee" className="w-full">
                      <SelectValue placeholder="Escolha uma pessoa" />
                    </SelectTrigger>
                    <SelectContent>
                      {members.map((member) => (
                        <SelectItem
                          key={member.userId}
                          value={member.userId}
                          disabled={Boolean(member.resolutionError)}
                        >
                          {member.name}
                          {member.userId === currentUserId ? " (você)" : ""}
                          {member.clanName ? ` · ${member.clanName}` : ""}
                          {member.resolutionError ? ` · ${member.resolutionError}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    O clã será definido automaticamente pelo cadastro da pessoa.
                  </p>
                </>
              ) : (
                <>
                  <Label htmlFor="clan" className="hud-label">
                    Clã responsável
                  </Label>
                  <Select value={clanId} onValueChange={setClanId}>
                    <SelectTrigger id="clan" className="w-full">
                      <SelectValue placeholder="Escolha um clã" />
                    </SelectTrigger>
                    <SelectContent>
                      {clans.map((clan) => (
                        <SelectItem key={clan.id} value={clan.id}>
                          {clan.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    A missão fica sem responsável até alguém do clã assumir.
                  </p>
                </>
              )}
            </div>
            <div className="grid content-start gap-2">
              <Label htmlFor="dueDate" className="hud-label">
                Prazo (opcional)
              </Label>
              <Input id="dueDate" name="dueDate" type="date" />
            </div>
          </div>

          {eligibleMembers.length === 0 ? (
            <Alert>
              <Info aria-hidden />
              <AlertDescription>
                Nenhuma pessoa possui um clã determinável. Crie a missão para
                um clã ou peça a um admin para configurar os vínculos.
              </AlertDescription>
            </Alert>
          ) : null}

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

          <Button
            type="submit"
            disabled={
              submitting ||
              (assignmentType === "individual" ? !assigneeId : !clanId)
            }
            size="lg"
          >
            {submitting ? "Criando…" : "Criar missão"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
