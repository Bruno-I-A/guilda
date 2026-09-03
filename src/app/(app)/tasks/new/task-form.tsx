"use client";

import { Info, Star, UserRound, UsersRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { searchCompanyFlowClients } from "@/lib/company-flows/client-search";
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
  clients,
  currentUserId,
}: {
  members: {
    userId: string;
    name: string;
    clanName: string | null;
    resolutionError: string | null;
  }[];
  clans: { id: string; name: string }[];
  clients: { id: string; name: string; cnpj: string | null }[];
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
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientQuery, setClientQuery] = useState("");
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [priority, setPriority] = useState(2);
  const [difficulty, setDifficulty] = useState(2);
  const [submitting, setSubmitting] = useState(false);

  const matchingClients = searchCompanyFlowClients(clients, clientQuery);

  /**
   * Só o navegador sabe o fuso de quem preenche. Com hora, converte aqui para
   * ISO; sem hora, manda a data pura e o servidor a ancora ao meio-dia UTC.
   */
  function prazoParaEnvio(): string {
    if (!dueDate) return "";
    if (!dueTime) return dueDate;
    const local = new Date(`${dueDate}T${dueTime}`);
    return Number.isNaN(local.getTime()) ? dueDate : local.toISOString();
  }

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
      dueDate: prazoParaEnvio(),
      clientId: clientId || undefined,
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
    <Card className="panel-cut texture-iron rounded-none border-0 ring-0">
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-5" noValidate>
          {/*
            Rótulo de campo é 14px normal, não HUD: este formulário é usado no
            celular, e 11px mono com 0.18em de tracking não se lê de relance.
            O único `.hud-label` que sobra aqui é o do banner de recompensa,
            que etiqueta um DADO (o XP), não um campo.
          */}
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">Destino da missão</legend>
            {/* Mesmo desenho do seletor de prioridade abaixo: segmentos retos
                colados, sem canto arredondado. */}
            <div className="grid grid-cols-2 border border-border" role="radiogroup">
              <button
                type="button"
                role="radio"
                aria-checked={assignmentType === "individual"}
                onClick={() => setAssignmentType("individual")}
                disabled={eligibleMembers.length === 0}
                className={cn(
                  "flex items-center justify-center gap-2 border-r border-border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50",
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
                  "flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50",
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
            <p className="text-xs text-muted-foreground">
              Acrescente o contexto, os documentos necessários e o que define a
              missão como concluída.
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="grid content-start gap-2">
              {assignmentType === "individual" ? (
                <>
                  <Label htmlFor="assignee">Pessoa responsável</Label>
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
                  <Label htmlFor="clan">Clã responsável</Label>
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
              <Label htmlFor="dueDate">Prazo (opcional)</Label>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <Input
                  id="dueDate"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                  type="date"
                />
                <Input
                  aria-label="Hora do prazo"
                  value={dueTime}
                  onChange={(event) => setDueTime(event.target.value)}
                  type="time"
                  disabled={!dueDate}
                  className="w-28"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Sem hora, o prazo vale para o dia inteiro.
              </p>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="client">Empresa (opcional)</Label>
            <div className="relative">
              <Input
                id="client"
                value={clientQuery}
                onChange={(event) => {
                  setClientQuery(event.target.value);
                  setClientId("");
                  setClientPickerOpen(true);
                }}
                onFocus={() => setClientPickerOpen(true)}
                placeholder="Pesquise pelo nome ou CNPJ"
                autoComplete="off"
              />
              {clientPickerOpen && clientQuery.trim() ? (
                <div className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
                  {matchingClients.length > 0 ? (
                    matchingClients.map((client) => (
                      <button
                        key={client.id}
                        type="button"
                        className="flex w-full flex-col items-start rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
                        onClick={() => {
                          setClientId(client.id);
                          setClientQuery(client.name);
                          setClientPickerOpen(false);
                        }}
                      >
                        <span>{client.name}</span>
                        {client.cnpj ? (
                          <span className="font-mono text-xs text-muted-foreground">
                            {client.cnpj}
                          </span>
                        ) : null}
                      </button>
                    ))
                  ) : (
                    <p className="px-2 py-1.5 text-sm text-muted-foreground">
                      Nenhuma empresa encontrada.
                    </p>
                  )}
                </div>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              {clientId
                ? "Empresa vinculada — a missão aparece no histórico dela."
                : "Deixe em branco para uma missão que não é de nenhuma empresa."}
            </p>
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
              {/* Span e não <Label>: o controle abaixo é um radiogroup com
                  `aria-label` próprio — aqui o texto é só o rótulo visível. */}
              <span className="text-sm font-medium">Prioridade</span>
              <PrioritySegments value={priority} onChange={setPriority} />
            </div>
            <div className="grid content-start gap-2">
              <span className="text-sm font-medium">Dificuldade</span>
              <DifficultyPips value={difficulty} onChange={setDifficulty} />
            </div>
          </div>

          {/* Banner de loot: a recompensa reage às escolhas acima. */}
          <div className="panel-cut panel-cut-sm flex items-center justify-between bg-gold/10 px-4 py-3 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--gold)_35%,transparent)]">
            <span className="hud-label !text-gold/80">Recompensa ao concluir</span>
            <span className="inline-flex items-center gap-1.5 font-mono text-lg font-bold tabular-nums text-gold">
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
