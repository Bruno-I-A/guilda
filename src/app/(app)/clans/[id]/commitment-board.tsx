"use client";

import {
  Archive,
  ArchiveRestore,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  Pencil,
  Plus,
  Repeat2,
  Send,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
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
import {
  CADENCE_LABELS,
  COMMITMENT_CADENCES,
  commitmentPeriodLabel,
  firstOpenPeriod,
  nextCommitmentPeriod,
  periodsForCadence,
  periodsForCadenceRange,
  periodsPerYear,
  type CommitmentCadence,
  type CommitmentPeriodCoordinate,
} from "@/domain/commitments";
import { cn } from "@/lib/utils";

import {
  createCommitment,
  createMissionsForPeriods,
  planCommitmentPeriods,
  setCommitmentActive,
  updateCommitment,
  updateCommitmentPeriod,
  updateDistributionClosingNote,
} from "./commitment-actions";

export interface CommitmentPeriodView {
  id: string;
  year: number;
  index: number;
  label: string;
  dueDate: string;
  notes: string | null;
  distributedAmount: string | null;
  completedAt: string | null;
  completedByName: string | null;
  taskId: string | null;
  overdue: boolean;
}

export interface CommitmentView {
  id: string;
  clientId: string;
  clientName: string;
  notes: string | null;
  targetAmount: string | null;
  cadence: CommitmentCadence;
  difficulty: number;
  active: boolean;
  latestPeriod: CommitmentPeriodCoordinate | null;
  periods: CommitmentPeriodView[];
}

export interface ClosingNoteView {
  clientId: string;
  clientName: string;
  notes: string;
}

interface ClientOption {
  id: string;
  name: string;
}

function formatDate(value: string): string {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("pt-BR", {
    timeZone: "UTC",
  });
}

function formatMoney(value: string): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(value));
}

function moneyInput(value: string | null): string {
  return value === null ? "" : Number(value).toFixed(2).replace(".", ",");
}

function periodOptions(cadence: CommitmentCadence, year: number) {
  return periodsForCadence(cadence, year).map((period) => ({
    value: String(period.index),
    label: commitmentPeriodLabel(cadence, year, period.index),
  }));
}

function RangeFields({
  cadence,
  start,
  end,
  onStart,
  onEnd,
}: {
  cadence: CommitmentCadence;
  start: CommitmentPeriodCoordinate;
  end: CommitmentPeriodCoordinate;
  onStart: (value: CommitmentPeriodCoordinate) => void;
  onEnd: (value: CommitmentPeriodCoordinate) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="grid gap-2">
        <Label>Começar em</Label>
        <div className="grid grid-cols-[1fr_6.5rem] gap-2">
          <Select
            value={String(start.index)}
            onValueChange={(value) => onStart({ ...start, index: Number(value) })}
          >
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {periodOptions(cadence, start.year).map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="number"
            min={2000}
            max={2100}
            value={start.year}
            onChange={(event) => onStart({ ...start, year: Number(event.target.value) })}
            aria-label="Ano inicial"
          />
        </div>
      </div>
      <div className="grid gap-2">
        <Label>Planejar até</Label>
        <div className="grid grid-cols-[1fr_6.5rem] gap-2">
          <Select
            value={String(end.index)}
            onValueChange={(value) => onEnd({ ...end, index: Number(value) })}
          >
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {periodOptions(cadence, end.year).map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="number"
            min={2000}
            max={2100}
            value={end.year}
            onChange={(event) => onEnd({ ...end, year: Number(event.target.value) })}
            aria-label="Ano final"
          />
        </div>
      </div>
    </div>
  );
}

function PeriodEditorDialog({
  clanId,
  period,
  completeOnSave,
  onClose,
  onSaved,
}: {
  clanId: string;
  period: CommitmentPeriodView;
  completeOnSave: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [dueDate, setDueDate] = useState(period.dueDate);
  const [amount, setAmount] = useState(moneyInput(period.distributedAmount));
  const [notes, setNotes] = useState(period.notes ?? "");

  function submit() {
    startTransition(async () => {
      const result = await updateCommitmentPeriod({
        clanId,
        periodId: period.id,
        dueDate,
        distributedAmount: amount,
        notes,
        ...(completeOnSave ? { completed: true } : {}),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(completeOnSave ? "Distribuição concluída." : "Período atualizado.");
      onClose();
      onSaved();
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {completeOnSave ? "Concluir distribuição" : "Editar distribuição"}
          </DialogTitle>
          <DialogDescription>
            {period.label} · registre o valor total e o que precisa permanecer no histórico.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="distribution-due-date">Prazo</Label>
              <Input
                id="distribution-due-date"
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="distribution-amount">Valor distribuído</Label>
              <Input
                id="distribution-amount"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="Ex.: 18.500,00"
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="distribution-period-notes">Observações do período</Label>
            <Textarea
              id="distribution-period-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="Sócios, condições, pendências ou cuidados deste período…"
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="button" disabled={pending || !dueDate} onClick={submit}>
            {completeOnSave ? "Salvar e concluir" : "Salvar alterações"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PlanRangeDialog({
  clanId,
  commitment,
  today,
  onClose,
  onSaved,
}: {
  clanId: string;
  commitment: CommitmentView;
  today: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const suggestedStart = commitment.latestPeriod
    ? nextCommitmentPeriod(commitment.cadence, commitment.latestPeriod)
    : firstOpenPeriod(commitment.cadence, today);
  const [start, setStart] = useState(suggestedStart);
  const [end, setEnd] = useState<CommitmentPeriodCoordinate>({
    year: suggestedStart.year,
    index: periodsPerYear(commitment.cadence),
  });
  const preview = useMemo(
    () => periodsForCadenceRange(commitment.cadence, start, end),
    [commitment.cadence, start, end],
  );

  function submit() {
    startTransition(async () => {
      const result = await planCommitmentPeriods({
        clanId,
        commitmentId: commitment.id,
        startYear: start.year,
        startIndex: start.index,
        endYear: end.year,
        endIndex: end.index,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.data?.periods
          ? `${result.data.periods} nova(s) distribuição(ões) planejada(s).`
          : "Este intervalo já estava planejado.",
      );
      onClose();
      onSaved();
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Planejar próximas distribuições</DialogTitle>
          <DialogDescription>
            {commitment.clientName} · períodos já existentes não serão duplicados.
          </DialogDescription>
        </DialogHeader>
        <RangeFields
          cadence={commitment.cadence}
          start={start}
          end={end}
          onStart={setStart}
          onEnd={setEnd}
        />
        <p className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
          {preview.length > 0
            ? `${preview.length} período(s): ${commitmentPeriodLabel(commitment.cadence, preview[0].year, preview[0].index)} até ${commitmentPeriodLabel(commitment.cadence, preview.at(-1)!.year, preview.at(-1)!.index)}.`
            : "Escolha um intervalo válido."}
        </p>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="button" disabled={pending || preview.length === 0} onClick={submit}>
            Planejar períodos
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CommitmentEditorDialog({
  clanId,
  commitment,
  onClose,
  onSaved,
}: {
  clanId: string;
  commitment: CommitmentView;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [targetAmount, setTargetAmount] = useState(
    moneyInput(commitment.targetAmount),
  );
  const [notes, setNotes] = useState(commitment.notes ?? "");
  const [difficulty, setDifficulty] = useState(String(commitment.difficulty));

  function submit() {
    startTransition(async () => {
      const result = await updateCommitment({
        clanId,
        commitmentId: commitment.id,
        targetAmount,
        notes,
        difficulty: Number(difficulty),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Distribuição atualizada.");
      onClose();
      onSaved();
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar distribuição</DialogTitle>
          <DialogDescription>
            {commitment.clientName} · {CADENCE_LABELS[commitment.cadence]}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="distribution-target">Meta de distribuição (opcional)</Label>
            <Input
              id="distribution-target"
              value={targetAmount}
              onChange={(event) => setTargetAmount(event.target.value)}
              inputMode="decimal"
              placeholder="Ex.: 200.000,00"
              maxLength={20}
            />
            <p className="text-xs text-muted-foreground">
              A meta orienta o planejamento; o valor efetivo continua registrado em cada período.
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="distribution-plan-notes">Combinado geral (opcional)</Label>
            <Textarea
              id="distribution-plan-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="Condições gerais, sócios ou cuidados recorrentes…"
            />
          </div>
          <div className="grid gap-2">
            <Label>Dificuldade das missões futuras</Label>
            <Select value={difficulty} onValueChange={setDifficulty}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5].map((value) => (
                  <SelectItem key={value} value={String(value)}>Nível {value}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="button" disabled={pending} onClick={submit}>Salvar alterações</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PeriodRow({
  clanId,
  period,
  canManage,
  selected,
  onSelected,
  onEdit,
  onComplete,
  onSaved,
}: {
  clanId: string;
  period: CommitmentPeriodView;
  canManage: boolean;
  selected: boolean;
  onSelected: (selected: boolean) => void;
  onEdit: () => void;
  onComplete: () => void;
  onSaved: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const selectable = canManage && !period.completedAt && !period.taskId;

  function createMission() {
    startTransition(async () => {
      const result = await createMissionsForPeriods({
        clanId,
        periodIds: [period.id],
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Missão criada na fila da Contabilidade.");
      onSaved();
    });
  }

  return (
    <li
      className={cn(
        "grid gap-2 rounded-md px-3 py-2 text-sm sm:grid-cols-[auto_1fr_auto] sm:items-center",
        period.completedAt
          ? "bg-muted/25"
          : period.overdue
            ? "bg-destructive/10"
            : "bg-muted/40",
      )}
    >
      {selectable ? (
        <input
          type="checkbox"
          checked={selected}
          onChange={(event) => onSelected(event.target.checked)}
          aria-label={`Selecionar ${period.label}`}
          className="size-4 accent-primary"
        />
      ) : <span className="hidden sm:block" />}

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="min-w-20 font-mono text-xs font-semibold">{period.label}</span>
          <span
            className={cn(
              "flex items-center gap-1 text-xs",
              period.overdue && !period.completedAt
                ? "text-destructive"
                : "text-muted-foreground",
            )}
          >
            <CalendarClock className="size-3.5" aria-hidden />
            {formatDate(period.dueDate)}
          </span>
          {period.distributedAmount !== null ? (
            <span className="font-mono text-xs text-emerald-300">
              {formatMoney(period.distributedAmount)}
            </span>
          ) : period.completedAt ? (
            <span className="text-xs text-amber-300">valor não informado</span>
          ) : null}
          {period.completedAt ? (
            <Badge variant="outline" className="gap-1 border-transparent bg-primary/10">
              <Check className="size-3" aria-hidden />
              {period.completedByName ?? "concluído"}
            </Badge>
          ) : null}
        </div>
        {period.notes ? (
          <p className="mt-1 truncate text-xs text-muted-foreground" title={period.notes}>
            {period.notes}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-1">
        {period.taskId ? (
          <Link
            href={`/tasks/${period.taskId}`}
            className="px-2 font-mono text-xs text-primary hover:underline"
          >
            ver missão →
          </Link>
        ) : canManage && !period.completedAt ? (
          <>
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={createMission}>
              <Send className="size-3.5" aria-hidden /> Gerar missão
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onComplete}>
              <Check className="size-3.5" aria-hidden /> Concluir
            </Button>
          </>
        ) : null}
        {canManage ? (
          <Button type="button" size="icon-sm" variant="ghost" onClick={onEdit} aria-label={`Editar ${period.label}`}>
            <Pencil className="size-3.5" aria-hidden />
          </Button>
        ) : null}
      </div>
    </li>
  );
}

export function CommitmentBoard({
  clanId,
  canManage,
  commitments,
  clients,
  closingNotes,
  year,
  today,
}: {
  clanId: string;
  canManage: boolean;
  commitments: readonly CommitmentView[];
  clients: readonly ClientOption[];
  closingNotes: readonly ClosingNoteView[];
  year: number;
  today: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [createOpen, setCreateOpen] = useState(false);
  const [clientId, setClientId] = useState("");
  const [cadence, setCadence] = useState<CommitmentCadence>("quarterly");
  const initialStart = firstOpenPeriod("quarterly", today);
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState<CommitmentPeriodCoordinate>({
    year: initialStart.year,
    index: periodsPerYear("quarterly"),
  });
  const [notes, setNotes] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [difficulty, setDifficulty] = useState("2");
  const [expandedCommitments, setExpandedCommitments] = useState<Set<string>>(
    new Set(),
  );
  const [selectedPeriods, setSelectedPeriods] = useState<Set<string>>(new Set());
  const [periodEditor, setPeriodEditor] = useState<{
    period: CommitmentPeriodView;
    complete: boolean;
  } | null>(null);
  const [planning, setPlanning] = useState<CommitmentView | null>(null);
  const [editing, setEditing] = useState<CommitmentView | null>(null);
  const [closingDraft, setClosingDraft] = useState<{
    clientId: string;
    notes: string;
  } | null>(null);

  const refresh = () => router.refresh();
  const createPreview = useMemo(
    () => periodsForCadenceRange(cadence, start, end),
    [cadence, start, end],
  );

  function changeCadence(value: CommitmentCadence) {
    const next = firstOpenPeriod(value, today);
    setCadence(value);
    setStart(next);
    setEnd({ year: next.year, index: periodsPerYear(value) });
  }

  function submitCreate() {
    if (!clientId || createPreview.length === 0) return;
    startTransition(async () => {
      const result = await createCommitment({
        clanId,
        clientId,
        cadence,
        notes,
        targetAmount,
        difficulty: Number(difficulty),
        startYear: start.year,
        startIndex: start.index,
        endYear: end.year,
        endIndex: end.index,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${result.data?.periods ?? 0} distribuição(ões) planejada(s).`);
      setCreateOpen(false);
      setClientId("");
      setNotes("");
      setTargetAmount("");
      refresh();
    });
  }

  function createSelectedMissions() {
    const ids = [...selectedPeriods];
    if (ids.length === 0) return;
    startTransition(async () => {
      const result = await createMissionsForPeriods({ clanId, periodIds: ids });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${result.data?.created ?? 0} missão(ões) criada(s).`);
      setSelectedPeriods(new Set());
      refresh();
    });
  }

  function toggleSelected(id: string, selected: boolean) {
    setSelectedPeriods((current) => {
      const next = new Set(current);
      if (selected) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleExpanded(id: string) {
    setExpandedCommitments((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const active = commitments.filter((commitment) => commitment.active);
  const archived = commitments.filter((commitment) => !commitment.active);
  const activeClientIds = new Set(active.map((commitment) => commitment.clientId));
  const planningClients = clients.filter((client) => !activeClientIds.has(client.id));
  const openOverdue = active.reduce(
    (total, commitment) =>
      total + commitment.periods.filter((period) => period.overdue).length,
    0,
  );

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="hud-label">Distribuição de lucros</p>
          <p className="text-sm text-muted-foreground">
            Planeje os períodos, gere missões quando necessário e mantenha o valor distribuído no histórico.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-lg border bg-muted/40 p-0.5">
            <Link href={`/clans/${clanId}?tab=commitments&distributionYear=${year - 1}`} className="flex size-8 items-center justify-center rounded-md hover:bg-background" aria-label={`Ver ${year - 1}`}>
              <ChevronLeft className="size-4" aria-hidden />
            </Link>
            <span className="min-w-16 text-center font-mono text-sm font-semibold">{year}</span>
            <Link href={`/clans/${clanId}?tab=commitments&distributionYear=${year + 1}`} className="flex size-8 items-center justify-center rounded-md hover:bg-background" aria-label={`Ver ${year + 1}`}>
              <ChevronRight className="size-4" aria-hidden />
            </Link>
          </div>
          {canManage ? (
            <Button
              type="button"
              size="sm"
              disabled={planningClients.length === 0}
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="size-4" aria-hidden /> Nova distribuição
            </Button>
          ) : null}
        </div>
      </div>

      {openOverdue > 0 ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {openOverdue} {openOverdue === 1 ? "período vencido" : "períodos vencidos"} sem conclusão em {year}.
        </p>
      ) : null}

      {selectedPeriods.size > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/5 p-3">
          <span className="text-sm">{selectedPeriods.size} período(s) selecionado(s)</span>
          <Button type="button" size="sm" disabled={pending} onClick={createSelectedMissions}>
            <Send className="size-4" aria-hidden /> Gerar missões selecionadas
          </Button>
        </div>
      ) : null}

      {active.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nenhuma empresa possui planejamento ativo de distribuição de lucros.
        </p>
      ) : (
        active.map((commitment) => {
          const expanded = expandedCommitments.has(commitment.id);
          return (
            <section key={commitment.id} className="panel-cut overflow-hidden rounded-lg border bg-card/50">
              <div className="flex items-center gap-1 p-2">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-expanded={expanded}
                  aria-controls={`distribution-${commitment.id}`}
                  onClick={() => toggleExpanded(commitment.id)}
                >
                  {expanded ? (
                    <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  ) : (
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <h3 className="min-w-0 flex-1 truncate font-medium">{commitment.clientName}</h3>
                  {commitment.targetAmount !== null ? (
                    <span className="flex shrink-0 items-center gap-1.5 rounded-md border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 font-mono text-sm font-semibold text-emerald-400">
                      <CircleDollarSign className="size-3.5" aria-hidden />
                      Meta {formatMoney(commitment.targetAmount)}
                    </span>
                  ) : commitment.notes ? (
                    <span
                      className="flex max-w-40 shrink-0 items-center gap-1.5 truncate rounded-md border border-emerald-400/25 bg-emerald-400/8 px-2.5 py-1 text-sm font-medium text-emerald-300 sm:max-w-64"
                      title={commitment.notes}
                    >
                      <CircleDollarSign className="size-3.5 shrink-0" aria-hidden />
                      <span className="truncate">{commitment.notes}</span>
                    </span>
                  ) : null}
                </button>
                {canManage ? (
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Editar distribuição de ${commitment.clientName}`}
                    onClick={() => setEditing(commitment)}
                  >
                    <Pencil className="size-3.5" aria-hidden />
                  </Button>
                ) : null}
              </div>

              {expanded ? (
                <div id={`distribution-${commitment.id}`} className="grid gap-3 border-t p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Badge variant="secondary" className="gap-1">
                        <Repeat2 className="size-3" aria-hidden /> {CADENCE_LABELS[commitment.cadence]}
                      </Badge>
                      {commitment.notes ? (
                        <p className="mt-2 whitespace-pre-wrap rounded-md bg-muted/35 px-3 py-2 text-sm text-foreground/85">
                          {commitment.notes}
                        </p>
                      ) : null}
                    </div>
                    {canManage ? (
                      <div className="flex items-center gap-1">
                        <Button type="button" size="sm" variant="outline" onClick={() => setPlanning(commitment)}>
                          <Plus className="size-3.5" aria-hidden /> Planejar próximas
                        </Button>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          disabled={pending}
                          aria-label={`Arquivar distribuição de ${commitment.clientName}`}
                          onClick={() => startTransition(async () => {
                            const result = await setCommitmentActive({ clanId, commitmentId: commitment.id, active: false });
                            if (!result.ok) toast.error(result.error);
                            else { toast.info("Planejamento arquivado."); refresh(); }
                          })}
                        >
                          <Archive className="size-3.5" aria-hidden />
                        </Button>
                      </div>
                    ) : null}
                  </div>

                  {commitment.periods.length > 0 ? (
                    <ul className="grid gap-1">
                      {commitment.periods.map((period) => (
                        <PeriodRow
                          key={period.id}
                          clanId={clanId}
                          period={period}
                          canManage={canManage}
                          selected={selectedPeriods.has(period.id)}
                          onSelected={(selected) => toggleSelected(period.id, selected)}
                          onEdit={() => setPeriodEditor({ period, complete: false })}
                          onComplete={() => setPeriodEditor({ period, complete: true })}
                          onSaved={refresh}
                        />
                      ))}
                    </ul>
                  ) : (
                    <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                      Nenhum período planejado para {year}.
                    </p>
                  )}
                </div>
              ) : null}
            </section>
          );
        })
      )}

      <section className="grid gap-3 rounded-lg border bg-card/35 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="hud-label">Empresas a fechar · {year}</p>
            <p className="text-sm text-muted-foreground">
              Anotações gerais, mesmo sem distribuição planejada ou missão. Também aparecem em Fechamentos.
            </p>
          </div>
          {canManage ? (
            <Button type="button" size="sm" variant="outline" disabled={clients.length === 0} onClick={() => setClosingDraft({ clientId: clients[0]?.id ?? "", notes: "" })}>
              <ClipboardList className="size-4" aria-hidden /> Anotar empresa
            </Button>
          ) : null}
        </div>
        {closingNotes.length > 0 ? (
          <ul className="grid gap-2 sm:grid-cols-2">
            {closingNotes.map((note) => (
              <li key={note.clientId} className="rounded-md bg-muted/35 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{note.clientName}</p>
                    <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{note.notes}</p>
                  </div>
                  {canManage ? (
                    <Button type="button" size="icon-sm" variant="ghost" onClick={() => setClosingDraft({ clientId: note.clientId, notes: note.notes })} aria-label={`Editar observação de ${note.clientName}`}>
                      <Pencil className="size-3.5" aria-hidden />
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
            Nenhuma anotação de fechamento em {year}.
          </p>
        )}
      </section>

      {archived.length > 0 ? (
        <section className="grid gap-2">
          <h3 className="hud-label">Planejamentos arquivados</h3>
          {archived.map((commitment) => (
            <div key={commitment.id} className="flex items-center gap-2 rounded-md bg-muted/25 px-3 py-2 text-sm text-muted-foreground">
              <span className="flex-1">{commitment.clientName} · {CADENCE_LABELS[commitment.cadence]}</span>
              {canManage ? (
                <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => startTransition(async () => {
                  const result = await setCommitmentActive({ clanId, commitmentId: commitment.id, active: true });
                  if (!result.ok) toast.error(result.error);
                  else { toast.success("Planejamento reativado."); refresh(); }
                })}>
                  <ArchiveRestore className="size-3.5" aria-hidden /> Reativar
                </Button>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Nova distribuição de lucros</DialogTitle>
            <DialogDescription>
              Planeja apenas o intervalo escolhido. As missões continuam opcionais.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>Empresa</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Escolha a empresa" /></SelectTrigger>
                <SelectContent>
                  {planningClients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Periodicidade</Label>
                <Select value={cadence} onValueChange={(value) => changeCadence(value as CommitmentCadence)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {COMMITMENT_CADENCES.map((option) => <SelectItem key={option} value={option}>{CADENCE_LABELS[option]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Dificuldade das missões</Label>
                <Select value={difficulty} onValueChange={setDifficulty}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5].map((value) => <SelectItem key={value} value={String(value)}>Nível {value}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <RangeFields cadence={cadence} start={start} end={end} onStart={setStart} onEnd={setEnd} />
            <div className="grid gap-2">
              <Label htmlFor="new-distribution-target">Meta de distribuição (opcional)</Label>
              <Input
                id="new-distribution-target"
                value={targetAmount}
                onChange={(event) => setTargetAmount(event.target.value)}
                inputMode="decimal"
                placeholder="Ex.: 200.000,00"
                maxLength={20}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="distribution-notes">Combinado geral (opcional)</Label>
              <Textarea id="distribution-notes" value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} maxLength={2000} placeholder="Condições gerais, sócios ou cuidados recorrentes…" />
            </div>
            <p className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
              {createPreview.length > 0 ? `${createPreview.length} período(s) serão planejados; nenhuma missão será criada agora.` : "Escolha um intervalo válido."}
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button type="button" disabled={pending || !clientId || createPreview.length === 0} onClick={submitCreate}>
              <CircleDollarSign className="size-4" aria-hidden /> Criar planejamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {periodEditor ? (
        <PeriodEditorDialog
          key={`${periodEditor.period.id}-${periodEditor.complete}`}
          clanId={clanId}
          period={periodEditor.period}
          completeOnSave={periodEditor.complete}
          onClose={() => setPeriodEditor(null)}
          onSaved={refresh}
        />
      ) : null}
      {planning ? (
        <PlanRangeDialog
          key={planning.id}
          clanId={clanId}
          commitment={planning}
          today={today}
          onClose={() => setPlanning(null)}
          onSaved={refresh}
        />
      ) : null}
      {editing ? (
        <CommitmentEditorDialog
          key={editing.id}
          clanId={clanId}
          commitment={editing}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      ) : null}
      {closingDraft ? (
        <ClosingNoteDialog
          key={`${closingDraft.clientId}-${year}`}
          clanId={clanId}
          clients={clients}
          year={year}
          initial={closingDraft}
          onClose={() => setClosingDraft(null)}
          onSaved={refresh}
        />
      ) : null}
    </div>
  );
}

function ClosingNoteDialog({
  clanId,
  clients,
  year,
  initial,
  onClose,
  onSaved,
}: {
  clanId: string;
  clients: readonly ClientOption[];
  year: number;
  initial: { clientId: string; notes: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [clientId, setClientId] = useState(initial.clientId);
  const [notes, setNotes] = useState(initial.notes);

  function submit() {
    startTransition(async () => {
      const result = await updateDistributionClosingNote({ clanId, clientId, year, notes });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(notes.trim() ? "Anotação salva." : "Anotação removida.");
      onClose();
      onSaved();
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Anotar empresa a fechar</DialogTitle>
          <DialogDescription>
            Registro geral de {year}; não cria distribuição nem missão.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Empresa</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="closing-note">Observação do fechamento</Label>
            <Textarea id="closing-note" value={notes} onChange={(event) => setNotes(event.target.value)} rows={5} maxLength={3000} placeholder="Pendências, documentos ou cuidados antes de fechar a empresa…" />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="button" disabled={pending || !clientId} onClick={submit}>Salvar anotação</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
