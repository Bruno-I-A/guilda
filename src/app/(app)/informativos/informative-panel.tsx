"use client";

import {
  AlertTriangle,
  Building2,
  Flag,
  Repeat2,
  ScanText,
  Trash2,
  UserRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
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
import { Textarea } from "@/components/ui/textarea";

import { CADENCE_LABELS, type CommitmentCadence } from "@/domain/commitments";

import {
  analyzeInformative,
  cancelInformativeDraft,
  confirmInformativeDraft,
} from "./actions";
import { NewClientWizard } from "./new-client-wizard";

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
  expiresAt: string;
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

/** Destino escolhido na tela para uma linha que veio pendente. */
type Decision = { kind: "clan"; clanId: string } | { kind: "person"; assigneeId: string };

export function InformativePanel({
  draft,
  clans,
  members,
}: {
  draft: DraftView | null;
  clans: { id: string; name: string }[];
  members: { userId: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sourceText, setSourceText] = useState("");
  const [decisions, setDecisions] = useState<Record<number, Decision>>({});
  const [wizardOpen, setWizardOpen] = useState(false);

  const pendingTasks = draft?.tasks.filter((t) => t.assignmentType === "pending") ?? [];
  const undecided = pendingTasks.filter((task) => !decisions[task.index]);
  // Espelha draftIsBlocked no servidor: prévia sem missão continua
  // confirmável quando há empresa nova a cadastrar (as linhas podem ser todas
  // combinado do Fiscal ou "sem particularidades").
  const blocked =
    !draft ||
    (draft.tasks.length === 0 && !draft.company.createClient) ||
    draft.unresolvedAssignees.length > 0 ||
    undecided.length > 0;

  function handleAnalyze() {
    startTransition(async () => {
      const result = await analyzeInformative({ sourceText });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Prévia gerada. Confira antes de confirmar.");
      setDecisions({});
      router.refresh();
    });
  }

  function handleConfirm() {
    if (!draft) return;
    startTransition(async () => {
      const result = await confirmInformativeDraft({
        informativeId: draft.informativeId,
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
      setSourceText("");
      setDecisions({});
      router.refresh();
    });
  }

  function handleCancel() {
    if (!draft) return;
    startTransition(async () => {
      const result = await cancelInformativeDraft({
        informativeId: draft.informativeId,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.info(result.data?.message ?? "Prévia cancelada.");
      setDecisions({});
      router.refresh();
    });
  }

  return (
    <div className="grid gap-5">
      {wizardOpen ? (
        <NewClientWizard onDone={() => setWizardOpen(false)} />
      ) : (
        <div className="grid gap-2">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => setWizardOpen(true)}>
              <Building2 className="size-4" aria-hidden /> Novo cliente
            </Button>
          </div>
          <Textarea
            value={sourceText}
            onChange={(event) => setSourceText(event.target.value)}
            rows={10}
            maxLength={12_000}
            placeholder={
              "INFORMATIVO — NOVO CLIENTE\n\nRazão social: ...\nCNPJ: ...\nEnquadramento: ...\n\nAÇÕES\nFiscal - Camila - parametrizar ...\nRH - cadastrar o pró-labore ..."
            }
            className="font-mono text-xs"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {sourceText.length}/12.000
            </span>
            <Button
              onClick={handleAnalyze}
              disabled={pending || sourceText.trim().length < 10}
            >
              <ScanText className="size-4" aria-hidden /> Analisar
            </Button>
          </div>
        </div>
      )}

      {!draft ? null : (
        <div className="panel-cut grid gap-4 rounded-lg border bg-card/50 p-4">
          <div>
            <h2 className="font-medium">
              {draft.company.legalName ?? "Missões sem empresa"}
            </h2>
            <p className="text-xs text-muted-foreground">
              {draft.company.cnpj ? `${draft.company.cnpj} · ` : ""}
              {draft.company.taxRegime ?? "regime não informado"}
              {draft.company.createClient ? " · empresa nova, será cadastrada" : ""}
            </p>
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
                O líder do Fiscal escolhe quem assume a empresa na aba Carteira.
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

          {draft.tasks.length === 0 ? (
            <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
              Nenhuma missão nesta prévia — as linhas eram combinado ou “sem
              particularidades”. A empresa será cadastrada e entra na fila da
              carteira do Fiscal.
            </p>
          ) : null}

          <ul className="grid gap-2">
            {draft.tasks.map((task) => {
              const decision = decisions[task.index];
              return (
                <li key={task.index} className="rounded-md border p-3">
                  <p className="font-medium">{task.title}</p>
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
              {draft.tasks.length === 0
                ? "Cadastrar empresa"
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
    </div>
  );
}
