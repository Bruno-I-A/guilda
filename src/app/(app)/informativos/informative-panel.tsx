"use client";

import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Flag,
  ListChecks,
  Pencil,
  Plus,
  Repeat2,
  Trash2,
  UserRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { CADENCE_LABELS, type CommitmentCadence } from "@/domain/commitments";
import type { ClanMissionPreset } from "@/lib/informatives/mission-presets";

import {
  cancelInformativeDraft,
  confirmInformativeDraft,
  prepareStructuredInformative,
  reviseInformativeDraft,
} from "./actions";
import {
  ClanMissionEditor,
  clanMissionGroupsAreValid,
  clanMissionGroupsFromPresets,
  emptyClanMissionGroup,
  flattenClanMissionGroups,
  type ClanMissionEditorClan,
  type ClanMissionGroupDraft,
} from "./clan-mission-editor";
import { NewClientWizard } from "./new-client-wizard";
import { AccountantChangeWizard } from "./accountant-change-wizard";
import { DirectCompanyInformativeWizard } from "./direct-company-informative-wizard";
import { FreeInformativeWizard } from "./free-informative-wizard";

export interface DraftTaskView {
  index: number;
  title: string;
  description: string;
  assignmentType: "individual" | "clan" | "pending";
  clanId: string | null;
  clanName: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  reason: string | null;
}

export interface DraftView {
  informativeId: string;
  revision: string;
  expiresAt: string;
  kind: "new_client" | "client_change" | "client_closure" | "general_task";
  freeNotice: { title: string; body: string } | null;
  company: {
    legalName: string | null;
    cnpj: string | null;
    taxRegime: string | null;
    createClient: boolean;
    cnaeDescription: string | null;
    openedAt: string | null;
    /** Combinado do Fiscal — vai para a carteira, não vira missão. */
    pendingFiscalNote: string | null;
  };
  tasks: DraftTaskView[];
  /** Distribuições de lucros recorrentes — viram planejamento, não missão. */
  commitments: {
    clanName: string;
    title: string;
    cadence: CommitmentCadence;
    notes: string | null;
  }[];
  observations: string[];
  unresolvedAssignees: string[];
  warnings: string[];
}

interface AmendmentSummaryView {
  companyName: string;
  changes: readonly {
    label: string;
    previous: string | null;
    next: string;
  }[];
  observations: string | null;
  hasExternalRegistrationTask: boolean;
}

interface FlowInformativeSummaryView {
  kind: "opening" | "amendment" | "closure";
  companyName: string;
  observations: string | null;
}

/** Destino escolhido na tela para uma linha que veio pendente. */
type Decision = { kind: "clan"; clanId: string } | { kind: "person"; assigneeId: string };
type TaskEditor = { type: "add" } | { type: "edit"; index: number };

export function InformativePanel({
  draft,
  clans,
  members,
  clients,
  flowId,
  amendmentSummary,
  flowSummary,
  flowMissionPresets = [],
  generalAccess = true,
  flowTaskId,
  expiredDraftId,
}: {
  draft: DraftView | null;
  clans: ClanMissionEditorClan[];
  members: { userId: string; name: string }[];
  clients: { id: string; name: string; cnpj: string | null; taxRegime: "mei" | "simples" | "presumido" | "association" | "real" }[];
  flowId?: string;
  amendmentSummary?: AmendmentSummaryView | null;
  flowSummary?: FlowInformativeSummaryView | null;
  flowMissionPresets?: readonly ClanMissionPreset[];
  generalAccess?: boolean;
  flowTaskId?: string | null;
  expiredDraftId?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [decisions, setDecisions] = useState<Record<number, Decision>>({});
  const [taskEditor, setTaskEditor] = useState<TaskEditor | null>(null);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [taskClanId, setTaskClanId] = useState("");
  const [missionGroups, setMissionGroups] = useState<ClanMissionGroupDraft[]>(
    () => {
      const presets = clanMissionGroupsFromPresets(
        clans,
        flowMissionPresets,
        `fluxo-${flowSummary?.kind ?? "geral"}`,
      );
      if (
        flowId &&
        (presets.length > 0 || flowSummary?.kind === "amendment")
      ) {
        return presets;
      }
      return [emptyClanMissionGroup()];
    },
  );
  const [wizardOpen, setWizardOpen] = useState(false);
  const [accountantChangeOpen, setAccountantChangeOpen] = useState(false);
  const [directKind, setDirectKind] = useState<"amendment" | "closure" | null>(null);
  const [freeOpen, setFreeOpen] = useState(false);

  const pendingTasks = draft?.tasks.filter((t) => t.assignmentType === "pending") ?? [];
  const undecided = pendingTasks.filter((task) => !decisions[task.index]);
  const structuredMissionCount = flattenClanMissionGroups(missionGroups).length;
  const missionsMayBeEmpty = flowId && flowSummary?.kind === "amendment";
  const missionGroupsValid =
    (missionsMayBeEmpty && missionGroups.length === 0) ||
    clanMissionGroupsAreValid(missionGroups);
  // Espelha draftIsBlocked no servidor: prévia sem missão continua
  // confirmável quando há empresa nova a cadastrar (as linhas podem ser todas
  // combinado do Fiscal ou "sem particularidades").
  const blocked =
    !draft ||
    (draft.tasks.length === 0 &&
      !draft.company.createClient &&
      draft.kind !== "client_change" &&
      !draft.freeNotice) ||
    draft.unresolvedAssignees.length > 0 ||
    undecided.length > 0;

  function handleAnalyze() {
    startTransition(async () => {
      const result = await prepareStructuredInformative({
        missions: flattenClanMissionGroups(missionGroups),
        flowId,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Prévia gerada sem processamento de IA.");
      setDecisions({});
      router.refresh();
    });
  }

  function handleConfirm() {
    if (!draft) return;
    startTransition(async () => {
      const result = await confirmInformativeDraft({
        informativeId: draft.informativeId,
        expectedRevision: draft.revision,
        decisions: Object.entries(decisions).map(([index, decision]) => ({
          index: Number(index),
          clanId: decision.kind === "clan" ? decision.clanId : null,
          assigneeId: decision.kind === "person" ? decision.assigneeId : null,
        })),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.data?.message ?? "Missões criadas.");
      setMissionGroups([emptyClanMissionGroup()]);
      setDecisions({});
      if (flowTaskId) router.push(`/tasks/${flowTaskId}`);
      else router.refresh();
    });
  }

  function handleCancel() {
    const informativeId = draft?.informativeId ?? expiredDraftId;
    if (!informativeId) return;
    startTransition(async () => {
      const result = await cancelInformativeDraft({
        informativeId,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.info(result.data?.message ?? "Prévia cancelada.");
      setDecisions({});
      if (flowTaskId) router.push(`/tasks/${flowTaskId}`);
      else router.refresh();
    });
  }

  function openTaskEditor(task?: DraftTaskView) {
    setTaskEditor(task ? { type: "edit", index: task.index } : { type: "add" });
    setTaskTitle(task?.title ?? "");
    setTaskDescription(task?.description ?? "");
    setTaskClanId(task ? "keep" : "");
  }

  function saveTaskRevision() {
    if (!draft || !taskEditor) return;
    const change = taskEditor.type === "add"
      ? {
          type: "add" as const,
          title: taskTitle,
          description: taskDescription,
          clanId: taskClanId,
        }
      : {
          type: "edit" as const,
          index: taskEditor.index,
          title: taskTitle,
          description: taskDescription,
          clanId: taskClanId === "keep" ? null : taskClanId,
        };
    startTransition(async () => {
      const result = await reviseInformativeDraft({
        informativeId: draft.informativeId,
        expectedRevision: draft.revision,
        change,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(taskEditor.type === "add" ? "Missão adicionada à prévia." : "Missão atualizada na prévia.");
      setTaskEditor(null);
      setDecisions({});
      router.refresh();
    });
  }

  function removeTaskFromDraft(task: DraftTaskView) {
    if (!draft) return;
    startTransition(async () => {
      const result = await reviseInformativeDraft({
        informativeId: draft.informativeId,
        expectedRevision: draft.revision,
        change: { type: "remove", index: task.index },
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Missão removida da prévia.");
      setDecisions({});
      router.refresh();
    });
  }

  return (
    <div className="grid gap-5">
      {expiredDraftId ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4">
          <p className="text-sm">A prévia deste Fluxo expirou. Descarte-a para gerar outra.</p>
          <Button variant="outline" size="sm" disabled={pending} onClick={handleCancel}>
            Descartar prévia expirada
          </Button>
        </div>
      ) : null}
      {wizardOpen ? (
        <NewClientWizard clans={clans} onDone={() => setWizardOpen(false)} />
      ) : accountantChangeOpen ? (
        <AccountantChangeWizard clans={clans} clients={clients} onDone={() => setAccountantChangeOpen(false)} />
      ) : directKind ? (
        <DirectCompanyInformativeWizard
          kind={directKind}
          clans={clans}
          clients={clients}
          onDone={() => setDirectKind(null)}
        />
      ) : freeOpen ? (
        <FreeInformativeWizard
          clans={clans}
          clients={clients}
          onDone={() => setFreeOpen(false)}
        />
      ) : (
        <div className="grid gap-2">
          <div className="flex flex-wrap justify-end gap-2">
            {generalAccess && !flowId ? (
              <Button variant="outline" size="sm" onClick={() => setFreeOpen(true)}>
                <Plus className="size-4" aria-hidden /> Informativo livre
              </Button>
            ) : null}
            {generalAccess && !flowId ? (
              <Button variant="outline" size="sm" onClick={() => setDirectKind("amendment")}>
                Alteração de empresa
              </Button>
            ) : null}
            {generalAccess && !flowId ? (
              <Button variant="outline" size="sm" onClick={() => setDirectKind("closure")}>
                Baixa de empresa
              </Button>
            ) : null}
            {generalAccess && !flowId ? <Button variant="outline" size="sm" onClick={() => setAccountantChangeOpen(true)}>Baixa por desligamento</Button> : null}
            {generalAccess ? (
              <Button variant="outline" size="sm" onClick={() => setWizardOpen(true)}>
                <Building2 className="size-4" aria-hidden /> Novo cliente
              </Button>
            ) : null}
          </div>
          {amendmentSummary ? (
            <section className="grid gap-4 rounded-lg border border-primary/35 bg-primary/[0.04] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="border-primary/35 bg-primary/10 text-primary">
                  Alteração
                </Badge>
                <h2 className="font-medium">
                  {amendmentSummary.companyName}
                </h2>
              </div>
              <div>
                <p className="hud-label">O que foi alterado</p>
                {amendmentSummary.changes.length > 0 ? (
                  <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                    {amendmentSummary.changes.map((change) => (
                      <li key={`${change.label}-${change.next}`} className="rounded-md border bg-background/35 p-3">
                        <p className="text-xs font-medium text-primary">{change.label}</p>
                        <div className="mt-1 flex items-center gap-2 text-sm">
                          {change.previous ? (
                            <>
                              <span className="text-muted-foreground line-through">{change.previous}</span>
                              <ArrowRight className="size-3.5 shrink-0 text-primary" aria-hidden />
                            </>
                          ) : null}
                          <span className="font-medium">{change.next}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">
                    A solicitação não possui campos estruturados; confira as observações abaixo.
                  </p>
                )}
              </div>
              {amendmentSummary.observations ? (
                <div className="rounded-md bg-muted/30 p-3">
                  <p className="hud-label">Observações da solicitação</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                    {amendmentSummary.observations}
                  </p>
                </div>
              ) : null}
            </section>
          ) : flowSummary ? (
            <section className="grid gap-2 rounded-lg border border-primary/35 bg-primary/[0.04] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="border-primary/35 bg-primary/10 text-primary">
                  {flowSummary.kind === "opening" ? "Abertura" : "Baixa"}
                </Badge>
                <h2 className="font-medium">{flowSummary.companyName}</h2>
              </div>
              {flowSummary.observations ? (
                <p className="max-w-prose whitespace-pre-wrap text-sm text-muted-foreground">
                  {flowSummary.observations}
                </p>
              ) : null}
            </section>
          ) : null}

          <ClanMissionEditor
            clans={clans}
            groups={missionGroups}
            onChange={setMissionGroups}
            disabled={pending}
            description={
              flowSummary?.kind === "amendment"
                ? "As sugestões do Fluxo já estão separadas por clã. Todas são opcionais e podem ser editadas."
                : flowId
                  ? "As missões sugeridas pelo Fluxo já estão separadas por clã. Edite, remova ou acrescente o que for necessário."
                  : undefined
            }
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {structuredMissionCount} {structuredMissionCount === 1 ? "missão" : "missões"} · sem processamento de IA
            </span>
            {!flowId || (!draft && !expiredDraftId) ? (
              <Button
                onClick={handleAnalyze}
                disabled={pending || !missionGroupsValid}
              >
                <ListChecks className="size-4" aria-hidden /> Gerar prévia
              </Button>
            ) : null}
          </div>
        </div>
      )}

      {!draft ? null : (
        <div className="panel-cut grid gap-4 rounded-lg border bg-card/50 p-4">
          {draft.freeNotice ? (
            <section className="grid gap-2 rounded-md border border-primary/30 bg-primary/5 p-3">
              <p className="hud-label">Prévia do aviso no Mural</p>
              <h3>{draft.freeNotice.title}</h3>
              <p className="max-w-prose whitespace-pre-wrap text-sm">{draft.freeNotice.body}</p>
            </section>
          ) : null}
          <div>
            <h2 className="font-medium">
              {draft.company.legalName ?? (draft.freeNotice ? "Sem empresa vinculada" : "Missões sem empresa")}
            </h2>
            {draft.company.legalName ? (
              <p className="text-xs text-muted-foreground">
                {draft.company.cnpj ? `${draft.company.cnpj} · ` : ""}
                {draft.company.taxRegime ?? "regime não informado"}
                {draft.company.createClient ? " · empresa nova, será cadastrada" : ""}
              </p>
            ) : null}
            {draft.company.cnaeDescription ? (
              <p className="text-xs text-muted-foreground">
                {draft.company.cnaeDescription}
                {draft.company.openedAt
                  ? ` · aberta em ${new Date(`${draft.company.openedAt}T12:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC" })}`
                  : ""}
              </p>
            ) : null}
          </div>

          {draft.unresolvedAssignees.length > 0 ? (
            <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
              <span>
                Nomes não reconhecidos: {draft.unresolvedAssignees.join(", ")}.
                Corrija o cadastro dessas pessoas antes de confirmar.
              </span>
            </p>
          ) : null}

          {/* O combinado do Fiscal não vira missão: mostrar aqui é o que prova
              para quem confere que a informação não se perdeu. */}
          {draft.company.pendingFiscalNote ? (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
              <p className="hud-label">Vai para a carteira do Fiscal</p>
              <p className="mt-1 text-sm whitespace-pre-wrap">
                {draft.company.pendingFiscalNote}
              </p>
              <p className="mt-1.5 text-xs text-muted-foreground">
                A equipe Fiscal escolhe quem assume a empresa na aba Carteira.
              </p>
            </div>
          ) : null}

          {draft.warnings.map((warning) => (
            <p key={warning} className="text-xs text-muted-foreground">
              {warning}
            </p>
          ))}

          {draft.commitments.length > 0 ? (
            <div className="grid gap-2 rounded-md border border-primary/30 bg-primary/5 p-3">
              <p className="hud-label">Vira planejamento de distribuição de lucros</p>
              <ul className="grid gap-1.5">
                {draft.commitments.map((commitment) => (
                  <li key={`${commitment.clanName}-${commitment.title}`} className="text-sm">
                    <span className="font-medium">{commitment.title}</span>
                    <Badge variant="secondary" className="ml-2 gap-1">
                      <Repeat2 className="size-3" aria-hidden />
                      {CADENCE_LABELS[commitment.cadence]}
                    </Badge>
                    <span className="ml-2 text-xs text-muted-foreground">
                      clã {commitment.clanName}
                    </span>
                    {commitment.notes ? (
                      <p className="text-xs text-muted-foreground">{commitment.notes}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                Os períodos ainda abertos do ano são planejados na aba Distribuição
                de lucros; cada missão é gerada somente quando necessário.
              </p>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <div>
              <h3>Missões da prévia</h3>
              <p className="text-xs text-muted-foreground">
                Revise as missões antes de confirmar. Nada foi criado ainda.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending || draft.tasks.length >= 60}
              onClick={() => openTaskEditor()}
            >
              <Plus aria-hidden /> Adicionar missão
            </Button>
          </div>

          {draft.tasks.length === 0 ? (
            <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
              {draft.freeNotice
                ? "Nenhuma missão será criada. Ao confirmar, este informativo será publicado no Mural."
                : draft.kind === "client_change"
                ? "Esta alteração não exige missão adicional. Ao confirmar, o cadastro e o mural serão atualizados."
                : draft.company.createClient
                  ? "Nenhuma missão nesta prévia. Ao confirmar, a empresa será cadastrada e entrará na carteira do Fiscal."
                  : "Nenhuma missão nesta prévia. Adicione uma missão antes de confirmar ou descarte a prévia."}
            </p>
          ) : null}

          <ul className="grid gap-2">
            {draft.tasks.map((task) => {
              const decision = decisions[task.index];
              return (
                <li key={task.index} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 font-medium">{task.title}</p>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() => openTaskEditor(task)}
                        aria-label={`Editar missão ${task.title}`}
                      >
                        <Pencil aria-hidden /> Editar
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() => removeTaskFromDraft(task)}
                        aria-label={`Remover missão ${task.title}`}
                      >
                        <Trash2 aria-hidden /> Remover
                      </Button>
                    </div>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {task.description}
                  </p>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {task.assignmentType === "clan" ? (
                      <Badge variant="secondary" className="gap-1">
                        <Flag className="size-3" aria-hidden /> Clã {task.clanName}
                      </Badge>
                    ) : null}
                    {task.assignmentType === "individual" ? (
                      <Badge variant="outline" className="gap-1">
                        <UserRound className="size-3" aria-hidden /> {task.assigneeName}
                      </Badge>
                    ) : null}
                    {task.assignmentType === "pending" ? (
                      <>
                        <Badge variant="outline" className="gap-1 text-destructive">
                          <AlertTriangle className="size-3" aria-hidden /> Sem destino
                        </Badge>
                        {task.reason ? (
                          <span className="text-xs text-muted-foreground">
                            {task.reason}
                          </span>
                        ) : null}
                      </>
                    ) : null}
                  </div>

                  {task.assignmentType === "pending" ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Select
                        value={decision?.kind === "clan" ? decision.clanId : ""}
                        onValueChange={(clanId) =>
                          setDecisions((current) => ({
                            ...current,
                            [task.index]: { kind: "clan", clanId },
                          }))
                        }
                      >
                        <SelectTrigger size="sm" className="w-40">
                          <SelectValue placeholder="Mandar para o clã…" />
                        </SelectTrigger>
                        <SelectContent>
                          {clans.map((clan) => (
                            <SelectItem key={clan.id} value={clan.id}>
                              {clan.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Select
                        value={decision?.kind === "person" ? decision.assigneeId : ""}
                        onValueChange={(assigneeId) =>
                          setDecisions((current) => ({
                            ...current,
                            [task.index]: { kind: "person", assigneeId },
                          }))
                        }
                      >
                        <SelectTrigger size="sm" className="w-44">
                          <SelectValue placeholder="Ou direto para…" />
                        </SelectTrigger>
                        <SelectContent>
                          {members.map((member) => (
                            <SelectItem key={member.userId} value={member.userId}>
                              {member.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>

          {draft.observations.length > 0 ? (
            <div className="rounded-md border border-dashed p-3">
              <p className="hud-label">Não vira missão — vai para o mural</p>
              <ul className="mt-1.5 grid gap-1 text-sm text-muted-foreground">
                {draft.observations.map((observation) => (
                  <li key={observation}>• {observation}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <Button variant="ghost" onClick={handleCancel} disabled={pending}>
              <Trash2 className="size-4" aria-hidden /> Descartar prévia
            </Button>
            <Button onClick={handleConfirm} disabled={pending || blocked}>
              {draft.freeNotice
                ? draft.tasks.length === 0
                  ? "Publicar informativo"
                  : `Publicar e criar ${draft.tasks.length} ${draft.tasks.length === 1 ? "missão" : "missões"}`
                : draft.tasks.length === 0
                ? draft.kind === "client_change"
                  ? "Confirmar alteração"
                  : "Cadastrar empresa"
                : `Criar ${draft.tasks.length} ${draft.tasks.length === 1 ? "missão" : "missões"}`}
            </Button>
          </div>

          {undecided.length > 0 ? (
            <p className="text-right text-xs text-muted-foreground">
              {undecided.length}{" "}
              {undecided.length === 1 ? "linha precisa" : "linhas precisam"} de
              destino antes de confirmar.
            </p>
          ) : null}
        </div>
      )}

      {taskEditor && draft ? (
        <Dialog open onOpenChange={(open) => !open && setTaskEditor(null)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {taskEditor.type === "add" ? "Adicionar missão" : "Editar missão"}
              </DialogTitle>
              <DialogDescription>
                As alterações ficam na prévia até você confirmar a criação das missões.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="informative-task-title">Título</Label>
                <Input
                  id="informative-task-title"
                  value={taskTitle}
                  onChange={(event) => setTaskTitle(event.target.value)}
                  maxLength={200}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="informative-task-description">Descrição</Label>
                <Textarea
                  id="informative-task-description"
                  value={taskDescription}
                  onChange={(event) => setTaskDescription(event.target.value)}
                  maxLength={5000}
                  rows={4}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="informative-task-clan">Clã responsável</Label>
                <Select value={taskClanId} onValueChange={setTaskClanId}>
                  <SelectTrigger id="informative-task-clan" className="w-full">
                    <SelectValue placeholder="Escolha um clã" />
                  </SelectTrigger>
                  <SelectContent>
                    {taskEditor.type === "edit" ? (
                      <SelectItem value="keep">Manter destino atual</SelectItem>
                    ) : null}
                    {clans.map((clan) => (
                      <SelectItem key={clan.id} value={clan.id}>
                        {clan.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {taskEditor.type === "edit" ? (
                  <p className="text-xs text-muted-foreground">
                    Escolher outro clã substitui o destino atual da missão.
                  </p>
                ) : null}
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={pending} onClick={() => setTaskEditor(null)}>
                Cancelar
              </Button>
              <Button
                type="button"
                disabled={
                  pending ||
                  taskTitle.trim().length < 3 ||
                  !taskDescription.trim() ||
                  !taskClanId
                }
                onClick={saveTaskRevision}
              >
                Salvar na prévia
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
