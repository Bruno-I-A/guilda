"use client";

import {
  Check,
  ChevronDown,
  ListChecks,
  ClipboardCheck,
  FileCheck2,
  LoaderCircle,
  MessageSquareText,
  Pencil,
  Plus,
  Send,
  Trash2,
  Undo2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
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
import { Textarea } from "@/components/ui/textarea";
import type { ClosingStatus } from "@/lib/closings-ui";
import { formatBRLCurrency } from "@/lib/currency";
import { CLOSING_YEAR_XP } from "@/domain/xp";
import {
  TAX_REGIME_BADGE_CLASSES,
  TAX_REGIME_LABELS,
  type TaxRegime,
} from "@/lib/clients-ui";
import {
  OBSERVATION_SCOPE_LABELS,
  OBSERVATION_STATE_LABELS,
  observationBadge,
  suggestedMissionTitle,
  summarizeObservations,
  type ObservationScope,
  type ObservationState,
} from "@/domain/closing-observations";
import { clanTabHref } from "@/lib/clan-tabs";

import { ClanSectionHeading } from "./clan-ui";
import { STATUS_LABELS } from "@/lib/task-ui";
import type { TaskStatus } from "@/domain/task-state";
import { cn } from "@/lib/utils";

import {
  createClosing,
  deleteClosing,
  setDefisCompleted,
  setYearClosed,
  updateClosing,
  addClosingObservation,
  createMissionFromClosingObservation,
  setClosingObservationResolved,
} from "./closing-actions";

export interface ClosingView {
  id: string;
  clientId: string;
  title: string;
  dueDate: string;
  status: ClosingStatus;
  notes: string | null;
  cashBalance: string | null;
  periodResult: string | null;
  shareholderLoan: string | null;
  completedAt: string | null;
  completedBy: string | null;
}

export interface ClosingObservationView {
  id: string;
  scope: ObservationScope;
  /** Preenchido quando a observação pertence a um período. */
  closingId: string | null;
  body: string;
  /** Null nas observações migradas do texto livre antigo. */
  authorName: string | null;
  taskId: string | null;
  taskTitle: string | null;
  taskStatus: TaskStatus | null;
  taskAssignee: string | null;
  state: ObservationState;
  resolvedAt: string | null;
  createdAt: string;
}

export interface CompanyClosingView {
  id: string;
  name: string;
  taxRegime: TaxRegime;
  yearClosedAt: string | null;
  yearNotes: string | null;
  defisCompletedAt: string | null;
  defisNotes: string | null;
  closings: ClosingView[];
  observations: ClosingObservationView[];
}

interface ClosingFields {
  clientId: string;
  year: number;
  title: string;
  notes: string;
  cashBalance: string;
  periodResult: string;
  shareholderLoan: string;
}

function ClosingFormDialog({
  open,
  onOpenChange,
  clanId,
  company,
  year,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clanId: string;
  company: Pick<CompanyClosingView, "id" | "name">;
  year: number;
  initial?: ClosingView;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function submit(fields: ClosingFields) {
    startTransition(async () => {
      const result = initial
        ? await updateClosing({ clanId, closingId: initial.id, ...fields })
        : await createClosing({ clanId, ...fields });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(initial ? "Fechamento atualizado." : "Período adicionado.");
      onOpenChange(false);
      router.refresh();
    });
  }

  function remove() {
    if (!initial) return;
    if (!window.confirm(`Excluir o fechamento “${initial.title}”?`)) return;
    startTransition(async () => {
      const result = await deleteClosing({ clanId, closingId: initial.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Fechamento excluído.");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {initial ? "Editar período" : "Adicionar período fechado"}
          </DialogTitle>
          <DialogDescription>
            {company.name} · registre somente um período que já foi fechado.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            submit({
              clientId: company.id,
              year,
              title: String(form.get("title") ?? ""),
              notes: String(form.get("notes") ?? ""),
              cashBalance: String(form.get("cashBalance") ?? ""),
              periodResult: String(form.get("periodResult") ?? ""),
              shareholderLoan: String(form.get("shareholderLoan") ?? ""),
            });
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="closing-title">Período ou identificação</Label>
            <Input
              id="closing-title"
              name="title"
              defaultValue={initial?.title ?? ""}
              placeholder="Ex.: Janeiro a abril ou Fechamento solicitado em maio"
              maxLength={160}
              required
            />
          </div>

          <div className="grid gap-2">
            <div>
              <p className="text-sm font-medium">Valores do período (opcional)</p>
              <p className="text-xs text-muted-foreground">
                Use o sinal de menos para informar saldo ou resultado negativo.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="closing-cash-balance">Saldo de caixa</Label>
                <CurrencyInput
                  id="closing-cash-balance"
                  name="cashBalance"
                  defaultValue={initial?.cashBalance ?? ""}
                  placeholder="R$ 15.000,00"
                  allowNegative
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="closing-period-result">Resultado</Label>
                <CurrencyInput
                  id="closing-period-result"
                  name="periodResult"
                  defaultValue={initial?.periodResult ?? ""}
                  placeholder="R$ 8.500,00"
                  allowNegative
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="closing-shareholder-loan">
                Empréstimo de sócio
              </Label>
              <CurrencyInput
                id="closing-shareholder-loan"
                name="shareholderLoan"
                defaultValue={initial?.shareholderLoan ?? ""}
                placeholder="R$ 20.000,00"
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="closing-notes">Observações (opcional)</Label>
            <Textarea
              id="closing-notes"
              name="notes"
              defaultValue={initial?.notes ?? ""}
              placeholder="O que foi fechado, documentos faltantes, divergências, erros ou próximos cuidados…"
              maxLength={3000}
              rows={5}
            />
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            {initial ? (
              <Button
                type="button"
                variant="destructive"
                disabled={pending}
                onClick={remove}
              >
                <Trash2 aria-hidden /> Excluir
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit" disabled={pending}>
              {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
              {initial ? "Salvar alterações" : "Adicionar período"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function ClosingRow({
  clanId,
  closing,
  company,
  year,
}: {
  clanId: string;
  closing: ClosingView;
  company: CompanyClosingView;
  year: number;
}) {
  const [editOpen, setEditOpen] = useState(false);

  return (
    <li className="grid gap-3 rounded-lg border border-l-2 border-l-emerald-400/60 bg-background/45 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{closing.title}</p>
            <Badge className="h-5 border-success/25 bg-success/10 px-1.5 text-success">
              <Check aria-hidden />
              fechado
            </Badge>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Editar ${closing.title}`}
            onClick={() => setEditOpen(true)}
          >
            <Pencil aria-hidden />
          </Button>
        </div>
      </div>
      {closing.cashBalance !== null ||
      closing.periodResult !== null ||
      closing.shareholderLoan !== null ? (
        <dl className="grid gap-2 rounded-md border bg-muted/20 p-3 text-sm sm:grid-cols-3">
          {closing.cashBalance !== null ? (
            <div>
              <dt className="text-xs text-muted-foreground">Saldo de caixa</dt>
              <dd
                className={cn(
                  "font-mono font-medium",
                  Number(closing.cashBalance) < 0
                    ? "text-destructive"
                    : "text-success",
                )}
              >
                {formatBRLCurrency(closing.cashBalance)}
              </dd>
            </div>
          ) : null}
          {closing.periodResult !== null ? (
            <div>
              <dt className="text-xs text-muted-foreground">Resultado</dt>
              <dd
                className={cn(
                  "font-mono font-medium",
                  Number(closing.periodResult) < 0
                    ? "text-destructive"
                    : "text-success",
                )}
              >
                {formatBRLCurrency(closing.periodResult)}
              </dd>
            </div>
          ) : null}
          {closing.shareholderLoan !== null ? (
            <div>
              <dt className="text-xs text-muted-foreground">
                Empréstimo de sócio
              </dt>
              <dd className="font-mono font-medium">
                {formatBRLCurrency(closing.shareholderLoan)}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {closing.notes ? (
        <div className="flex gap-2 border-l-2 border-border pl-3 text-sm text-muted-foreground">
          <MessageSquareText className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p className="whitespace-pre-wrap">{closing.notes}</p>
        </div>
      ) : null}
      {closing.completedAt ? (
        <p className="font-mono text-[11px] text-muted-foreground">
          Registrado{closing.completedBy ? ` por ${closing.completedBy}` : ""} em{" "}
          {formatDateTime(closing.completedAt)}
        </p>
      ) : null}
      {editOpen ? (
        <ClosingFormDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          clanId={clanId}
          company={company}
          year={year}
          initial={closing}
        />
      ) : null}
    </li>
  );
}

export interface ClosingMemberOption {
  userId: string;
  name: string;
}

/**
 * Painel de observações da empresa no ano.
 *
 * Substitui o diálogo "Observações de {ano}", que era um textarea por ano e
 * outro pela DEFIS. Texto livre não respondia o que importa — isso ainda
 * precisa de alguém? —, então cada recado virou item com autor, data e
 * estado, e ganhou o encaminhamento que faltava: virar missão de quem vai
 * fazer, que costuma ser de outra área.
 */
function ObservationsPanel({
  clanId,
  company,
  year,
  members,
  viewerCanManage,
}: {
  clanId: string;
  company: CompanyClosingView;
  year: number;
  members: readonly ClosingMemberOption[];
  viewerCanManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [novoEscopo, setNovoEscopo] = useState<ObservationScope | null>(null);
  const [novoPeriodo, setNovoPeriodo] = useState<string>("");
  const [texto, setTexto] = useState("");
  const [missaoDe, setMissaoDe] = useState<ClosingObservationView | null>(null);

  const abertas = company.observations.filter((o) => o.state === "open");
  const encaminhadas = company.observations.filter((o) => o.state !== "open");

  function salvar() {
    if (!novoEscopo) return;
    startTransition(async () => {
      const result = await addClosingObservation({
        clanId,
        clientId: company.id,
        year,
        scope: novoEscopo,
        closingId: novoEscopo === "closing" ? novoPeriodo : null,
        body: texto,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Observação registrada.");
      setTexto("");
      setNovoEscopo(null);
      setNovoPeriodo("");
      router.refresh();
    });
  }

  function alternarResolvida(observation: ClosingObservationView) {
    const resolvendo = observation.state !== "resolved";
    startTransition(async () => {
      const result = await setClosingObservationResolved({
        clanId,
        observationId: observation.id,
        resolved: resolvendo,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(resolvendo ? "Observação resolvida." : "Observação reaberta.");
      router.refresh();
    });
  }

  return (
    <section className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ClanSectionHeading count={company.observations.length}>
          Observações
        </ClanSectionHeading>
        {viewerCanManage ? (
          <div className="flex flex-wrap gap-1">
            <Button size="sm" variant="outline" onClick={() => setNovoEscopo("year")}>
              <Plus aria-hidden /> No ano
            </Button>
            {company.taxRegime === "simples" ? (
              <Button size="sm" variant="outline" onClick={() => setNovoEscopo("defis")}>
                <Plus aria-hidden /> Na DEFIS
              </Button>
            ) : null}
            {company.closings.length > 0 ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setNovoPeriodo(company.closings[0].id);
                  setNovoEscopo("closing");
                }}
              >
                <Plus aria-hidden /> Num período
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {novoEscopo ? (
        <div className="panel-cut grid gap-2 border border-border/70 bg-background/40 p-3">
          <p className="hud-label">
            Nova observação · {OBSERVATION_SCOPE_LABELS[novoEscopo]}
          </p>
          {novoEscopo === "closing" ? (
            <select
              value={novoPeriodo}
              onChange={(event) => setNovoPeriodo(event.target.value)}
              aria-label="Período da observação"
              className="h-9 w-full border border-input bg-background px-2 text-sm"
            >
              {company.closings.map((closing) => (
                <option key={closing.id} value={closing.id}>
                  {closing.title}
                </option>
              ))}
            </select>
          ) : null}
          <Textarea
            value={texto}
            onChange={(event) => setTexto(event.target.value)}
            placeholder="Ex.: Tem rubricas para configurar em 30/08"
            rows={2}
            maxLength={3000}
            aria-label="Texto da observação"
          />
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setNovoEscopo(null);
                setTexto("");
              }}
            >
              Cancelar
            </Button>
            <Button size="sm" disabled={pending || texto.trim().length < 3} onClick={salvar}>
              Registrar
            </Button>
          </div>
        </div>
      ) : null}

      {company.observations.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">
          Nenhuma observação em {year}.
        </p>
      ) : (
        <ul className="grid gap-1.5">
          {[...abertas, ...encaminhadas].map((observation) => (
            <ObservationRow
              key={observation.id}
              clanId={clanId}
              observation={observation}
              company={company}
              pending={pending}
              viewerCanManage={viewerCanManage}
              onToggleResolved={() => alternarResolvida(observation)}
              onGenerateMission={() => setMissaoDe(observation)}
            />
          ))}
        </ul>
      )}

      {missaoDe ? (
        <ObservationMissionDialog
          clanId={clanId}
          observation={missaoDe}
          companyName={company.name}
          members={members}
          onClose={() => setMissaoDe(null)}
        />
      ) : null}
    </section>
  );
}

const OBSERVATION_STATE_CLASSES: Record<ObservationState, string> = {
  open: "border-warning/40 bg-warning/10 text-warning",
  assigned: "border-primary/40 bg-primary/10 text-primary",
  resolved: "border-success/40 bg-success/10 text-success",
};

function ObservationRow({
  clanId,
  observation,
  company,
  pending,
  viewerCanManage,
  onToggleResolved,
  onGenerateMission,
}: {
  clanId: string;
  observation: ClosingObservationView;
  company: CompanyClosingView;
  pending: boolean;
  viewerCanManage: boolean;
  onToggleResolved: () => void;
  onGenerateMission: () => void;
}) {
  const periodo =
    observation.scope === "closing"
      ? company.closings.find((closing) => closing.id === observation.closingId)?.title
      : null;

  return (
    <li
      className={cn(
        "panel-cut panel-cut-sm grid gap-1.5 border-l-2 bg-background/40 px-3 py-2",
        observation.state === "open" ? "border-l-warning/70" : "border-l-border/60",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm">{observation.body}</p>
        <Badge
          className={cn("h-5 shrink-0 px-1.5", OBSERVATION_STATE_CLASSES[observation.state])}
        >
          {OBSERVATION_STATE_LABELS[observation.state]}
        </Badge>
      </div>

      <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <span className="hud-label">
          {periodo ?? OBSERVATION_SCOPE_LABELS[observation.scope]}
        </span>
        <span aria-hidden>·</span>
        <span>{observation.authorName ?? "autor não registrado"}</span>
        <span aria-hidden>·</span>
        <span className="font-mono tabular-nums">
          {new Date(observation.createdAt).toLocaleDateString("pt-BR")}
        </span>
      </p>

      {observation.taskId ? (
        <Link
          href={clanTabHref(clanId, "closings")}
          className="sr-only"
          aria-hidden
          tabIndex={-1}
        >
          {""}
        </Link>
      ) : null}

      {observation.taskId ? (
        <Link
          href={`/tasks/${observation.taskId}?returnTo=${encodeURIComponent(
            clanTabHref(clanId, "closings"),
          )}`}
          className="flex flex-wrap items-center gap-2 text-xs text-primary hover:underline"
        >
          <ListChecks className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{observation.taskTitle ?? "Missão gerada"}</span>
          {observation.taskStatus ? (
            <span className="text-muted-foreground">
              · {STATUS_LABELS[observation.taskStatus]}
              {observation.taskAssignee ? ` · ${observation.taskAssignee}` : ""}
            </span>
          ) : null}
        </Link>
      ) : null}

      {viewerCanManage ? (
        <div className="flex flex-wrap justify-end gap-1">
          {!observation.taskId && observation.state !== "resolved" ? (
            <Button size="sm" variant="outline" disabled={pending} onClick={onGenerateMission}>
              <Send aria-hidden /> Gerar missão
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" disabled={pending} onClick={onToggleResolved}>
            {observation.state === "resolved" ? (
              <>
                <Undo2 aria-hidden /> Reabrir
              </>
            ) : (
              <>
                <Check aria-hidden /> Resolver
              </>
            )}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

/** Formulário da missão gerada, com o título já sugerido a partir do recado. */
function ObservationMissionDialog({
  clanId,
  observation,
  companyName,
  members,
  onClose,
}: {
  clanId: string;
  observation: ClosingObservationView;
  companyName: string;
  members: readonly ClosingMemberOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [assigneeId, setAssigneeId] = useState(members[0]?.userId ?? "");
  const [title, setTitle] = useState(
    suggestedMissionTitle({ body: observation.body, clientName: companyName }),
  );
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState(2);
  const [difficulty, setDifficulty] = useState(2);

  function gerar() {
    startTransition(async () => {
      const result = await createMissionFromClosingObservation({
        clanId,
        observationId: observation.id,
        assigneeId,
        title,
        dueDate,
        priority,
        difficulty,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.data?.alreadyExisted
          ? "Esta observação já tinha uma missão."
          : "Missão criada e vinculada à observação.",
      );
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(aberto) => (aberto ? null : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Gerar missão a partir da observação</DialogTitle>
          <DialogDescription>
            A missão nasce como pedido seu para outra pessoa, então volta com
            retorno escrito quando ela terminar.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <p className="panel-cut border border-border/70 bg-background/40 p-2.5 text-sm text-muted-foreground">
            {observation.body}
          </p>

          <div className="grid gap-1.5">
            <Label htmlFor="obs-assignee">Quem vai fazer</Label>
            <select
              id="obs-assignee"
              value={assigneeId}
              onChange={(event) => setAssigneeId(event.target.value)}
              className="h-9 w-full border border-input bg-background px-2 text-sm"
            >
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="obs-title">Título da missão</Label>
            <Input
              id="obs-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={200}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="obs-due">Prazo (opcional)</Label>
              <Input
                id="obs-due"
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="obs-priority">Prioridade</Label>
              <select
                id="obs-priority"
                value={priority}
                onChange={(event) => setPriority(Number(event.target.value))}
                className="h-9 w-full border border-input bg-background px-2 text-sm"
              >
                <option value={1}>Baixa</option>
                <option value={2}>Média</option>
                <option value={3}>Alta</option>
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="obs-difficulty">Dificuldade</Label>
              <select
                id="obs-difficulty"
                value={difficulty}
                onChange={(event) => setDifficulty(Number(event.target.value))}
                className="h-9 w-full border border-input bg-background px-2 text-sm"
              >
                {[1, 2, 3, 4, 5].map((valor) => (
                  <option key={valor} value={valor}>
                    {valor}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={pending || title.trim().length < 3 || !assigneeId} onClick={gerar}>
            <Send aria-hidden /> Gerar missão
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CompanyCard({
  clanId,
  company,
  year,
  members,
  viewerCanManage,
}: {
  clanId: string;
  company: CompanyClosingView;
  year: number;
  members: readonly ClosingMemberOption[];
  viewerCanManage: boolean;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const yearClosed = Boolean(company.yearClosedAt);
  const defisCompleted = Boolean(company.defisCompletedAt);
  const hasClosings = company.closings.length > 0;
  // O selo dizia "observação" tanto para recado resolvido quanto para pedido
  // parado ha um mes. Agora diz quantos esperam alguem.
  const observationBadgeInfo = observationBadge(
    summarizeObservations(
      company.observations.map((observation) => ({
        taskId: observation.taskId,
        resolvedAt: observation.resolvedAt ? new Date(observation.resolvedAt) : null,
      })),
    ),
  );

  function toggleYear() {
    if (
      yearClosed &&
      !window.confirm(
        `Reabrir ${year} para ${company.name}? A DEFIS também voltará a pendente.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await setYearClosed({
        clanId,
        clientId: company.id,
        year,
        closed: !yearClosed,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(yearClosed ? "Ano reaberto." : `${year} marcado como fechado.`);
      if (result.data?.xpAwarded) {
        toast.success(`Você ganhou ${result.data.xp} XP pelo fechamento anual.`);
      }
      router.refresh();
    });
  }

  function toggleDefis() {
    startTransition(async () => {
      const result = await setDefisCompleted({
        clanId,
        clientId: company.id,
        year,
        completed: !defisCompleted,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        defisCompleted ? "DEFIS reaberta." : "DEFIS marcada como entregue.",
      );
      router.refresh();
    });
  }

  return (
    <article
      className={cn(
        "panel-cut panel-cut-sm overflow-hidden transition-colors",
        hasClosings &&
          "border-success/30 bg-success/[0.04] shadow-[inset_3px_0_0_color-mix(in oklab, var(--success) 0.8%, transparent)]",
      )}
    >
      <div className="flex items-center gap-2 p-3 sm:p-4">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              hasClosings && "text-success",
              expanded && "rotate-180",
            )}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2
                className={cn(
                  "truncate font-semibold",
                  hasClosings && "text-success",
                )}
              >
                {company.name}
              </h2>
              <Badge
                className={cn(
                  "h-5 px-1.5",
                  TAX_REGIME_BADGE_CLASSES[company.taxRegime],
                )}
              >
                {TAX_REGIME_LABELS[company.taxRegime]}
              </Badge>
              {hasClosings ? (
                <Badge className="h-5 border-success/35 bg-success/15 px-1.5 text-success">
                  <ClipboardCheck aria-hidden />
                  com fechamento
                </Badge>
              ) : null}
              {yearClosed ? (
                <Badge className="h-5 border-success/30 bg-success/10 px-1.5 text-success">
                  <Check aria-hidden /> {year} fechado
                </Badge>
              ) : (
                <Badge variant="outline" className="h-5 px-1.5 text-muted-foreground">
                  {year} em aberto
                </Badge>
              )}
              {company.taxRegime === "simples" && yearClosed ? (
                <Badge
                  className={cn(
                    "h-5 px-1.5",
                    defisCompleted
                      ? "border-success/30 bg-success/10 text-success"
                      : "border-warning/30 bg-warning/10 text-warning",
                  )}
                >
                  <FileCheck2 aria-hidden />
                  {defisCompleted ? "DEFIS entregue" : "DEFIS pendente"}
                </Badge>
              ) : null}
              {observationBadgeInfo ? (
                <Badge
                  className={cn(
                    "h-5 px-1.5",
                    observationBadgeInfo.tone === "attention"
                      ? "border-warning/30 bg-warning/10 text-warning"
                      : "border-border/60 bg-secondary text-muted-foreground",
                  )}
                >
                  <MessageSquareText aria-hidden /> {observationBadgeInfo.label}
                </Badge>
              ) : null}
            </div>
            <p
              className={cn(
                "mt-1 flex items-center gap-1.5 font-mono text-xs text-muted-foreground",
                hasClosings && "font-semibold text-success",
              )}
            >
              {hasClosings ? (
                <ClipboardCheck className="size-3.5" aria-hidden />
              ) : null}
              {hasClosings
                ? `${company.closings.length} período${company.closings.length === 1 ? "" : "s"} fechado${company.closings.length === 1 ? "" : "s"}`
                : "Nenhum período lançado"}
            </p>
          </div>
        </button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setExpanded(true);
            setCreateOpen(true);
          }}
        >
          <Plus aria-hidden />
          <span className="hidden sm:inline">Adicionar período</span>
        </Button>
      </div>

      {expanded ? (
        <div className="grid gap-4 border-t bg-background/20 p-3 sm:p-4">
          <div className="grid gap-3 lg:grid-cols-2">
            <section className="rounded-lg border bg-muted/20 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="hud-label">Encerramento de {year}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Confirme somente quando o ano estiver totalmente encerrado.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={yearClosed ? "outline" : "default"}
                  disabled={pending}
                  onClick={toggleYear}
                >
                  {pending ? (
                    <LoaderCircle className="animate-spin" aria-hidden />
                  ) : yearClosed ? (
                    <Undo2 aria-hidden />
                  ) : (
                    <ClipboardCheck aria-hidden />
                  )}
                  {yearClosed ? "Reabrir ano" : `Fechar ${year} · +${CLOSING_YEAR_XP} XP`}
                </Button>
              </div>
              {company.yearNotes ? (
                <p className="mt-3 whitespace-pre-wrap border-l-2 border-border pl-3 text-sm text-muted-foreground">
                  {company.yearNotes}
                </p>
              ) : null}
            </section>

            {company.taxRegime === "simples" ? (
              <section className="rounded-lg border bg-muted/20 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="hud-label">DEFIS {year}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {yearClosed
                        ? "Controle a entrega feita após o fechamento."
                        : `Disponível depois que ${year} for fechado.`}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={defisCompleted ? "outline" : "default"}
                    disabled={pending || !yearClosed}
                    onClick={toggleDefis}
                  >
                    {pending ? (
                      <LoaderCircle className="animate-spin" aria-hidden />
                    ) : defisCompleted ? (
                      <Undo2 aria-hidden />
                    ) : (
                      <FileCheck2 aria-hidden />
                    )}
                    {defisCompleted ? "Reabrir DEFIS" : "Marcar entregue"}
                  </Button>
                </div>
                {company.defisNotes ? (
                  <p className="mt-3 whitespace-pre-wrap border-l-2 border-border pl-3 text-sm text-muted-foreground">
                    {company.defisNotes}
                  </p>
                ) : null}
              </section>
            ) : null}
          </div>

          {/* As observações vêm ANTES dos períodos: são o que pede ação de
              alguém, e o card existe para mostrar o que falta. O antigo botão
              "Observações do ano" saiu — o painel abaixo cobre os três lugares
              (ano, DEFIS e período), com autor, data e encaminhamento. */}
          <ObservationsPanel
            clanId={clanId}
            company={company}
            year={year}
            members={members}
            viewerCanManage={viewerCanManage}
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="hud-label">Períodos e demandas de {year}</p>
            <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus aria-hidden /> Adicionar período
            </Button>
          </div>

          {company.closings.length > 0 ? (
            <ul className="grid gap-2">
              {company.closings.map((closing) => (
                <ClosingRow
                  key={closing.id}
                  clanId={clanId}
                  closing={closing}
                  company={company}
                  year={year}
                />
              ))}
            </ul>
          ) : (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              Nenhum período registrado em {year}. Adicione quando surgir uma
              demanda ou quando um período for fechado.
            </div>
          )}
        </div>
      ) : null}

      {createOpen ? (
        <ClosingFormDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          clanId={clanId}
          company={company}
          year={year}
        />
      ) : null}
    </article>
  );
}

export function CompanyClosingBoard({
  clanId,
  companies,
  year,
  members,
  viewerCanManage,
}: {
  clanId: string;
  companies: CompanyClosingView[];
  year: number;
  members: readonly ClosingMemberOption[];
  viewerCanManage: boolean;
}) {
  return (
    <div className="grid gap-2">
      {companies.map((company) => (
        <CompanyCard
          key={company.id}
          clanId={clanId}
          company={company}
          year={year}
          members={members}
          viewerCanManage={viewerCanManage}
        />
      ))}
    </div>
  );
}
