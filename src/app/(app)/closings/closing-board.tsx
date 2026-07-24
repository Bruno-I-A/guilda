"use client";

import {
  CalendarDays,
  Check,
  ChevronDown,
  CircleAlert,
  CircleDot,
  ClipboardCheck,
  FileCheck2,
  LoaderCircle,
  MessageSquareText,
  Pencil,
  Plus,
  Trash2,
  Undo2,
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
import {
  CLOSING_STATUSES,
  CLOSING_STATUS_BADGE_CLASSES,
  CLOSING_STATUS_LABELS,
  isClosingOverdue,
  type ClosingStatus,
} from "@/lib/closings-ui";
import {
  TAX_REGIME_BADGE_CLASSES,
  TAX_REGIME_LABELS,
  type TaxRegime,
} from "@/lib/clients-ui";
import { cn } from "@/lib/utils";

import {
  createClosing,
  deleteClosing,
  setClosingStatus,
  setDefisCompleted,
  setYearClosed,
  updateClosing,
  updateYearNotes,
} from "./actions";

export interface ClosingView {
  id: string;
  clientId: string;
  title: string;
  dueDate: string;
  status: ClosingStatus;
  notes: string | null;
  completedAt: string | null;
  completedBy: string | null;
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
}

interface ClosingFields {
  clientId: string;
  title: string;
  dueDate: string;
  status: ClosingStatus;
  notes: string;
}

function ClosingFormDialog({
  open,
  onOpenChange,
  company,
  year,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company: Pick<CompanyClosingView, "id" | "name">;
  year: number;
  initial?: ClosingView;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<ClosingStatus>(initial?.status ?? "pending");

  function submit(fields: ClosingFields) {
    startTransition(async () => {
      const result = initial
        ? await updateClosing({ closingId: initial.id, ...fields })
        : await createClosing(fields);
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
      const result = await deleteClosing({ closingId: initial.id });
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
            {company.name} · registre o período, o prazo e tudo que falta resolver.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            submit({
              clientId: company.id,
              title: String(form.get("title") ?? ""),
              dueDate: String(form.get("dueDate") ?? ""),
              status,
              notes: String(form.get("notes") ?? ""),
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

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="closing-due-date">Prazo</Label>
              <Input
                id="closing-due-date"
                name="dueDate"
                type="date"
                min={`${year}-01-01`}
                max={`${year}-12-31`}
                defaultValue={initial?.dueDate ?? ""}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="closing-status">Situação</Label>
              <Select
                value={status}
                onValueChange={(value) => setStatus(value as ClosingStatus)}
              >
                <SelectTrigger id="closing-status" className="w-full">
                  <SelectValue>{CLOSING_STATUS_LABELS[status]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {CLOSING_STATUSES.map((item) => (
                    <SelectItem key={item} value={item}>
                      {CLOSING_STATUS_LABELS[item]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="closing-notes">
              Observações {status === "blocked" ? "(obrigatórias)" : "(opcional)"}
            </Label>
            <Textarea
              id="closing-notes"
              name="notes"
              defaultValue={initial?.notes ?? ""}
              placeholder="Documentos faltantes, divergências, erros e próximos passos…"
              maxLength={3000}
              rows={5}
              required={status === "blocked"}
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

function AnnualNotesDialog({
  open,
  onOpenChange,
  company,
  year,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company: CompanyClosingView;
  year: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Observações de {year}</DialogTitle>
          <DialogDescription>
            {company.name} · anotações gerais separadas dos períodos.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            startTransition(async () => {
              const result = await updateYearNotes({
                clientId: company.id,
                year,
                notes: String(form.get("notes") ?? ""),
                defisNotes: String(form.get("defisNotes") ?? ""),
              });
              if (!result.ok) {
                toast.error(result.error);
                return;
              }
              toast.success("Observações salvas.");
              onOpenChange(false);
              router.refresh();
            });
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="year-notes">Observações do fechamento anual</Label>
            <Textarea
              id="year-notes"
              name="notes"
              defaultValue={company.yearNotes ?? ""}
              placeholder="Pendências gerais, ajustes finais e informações importantes…"
              maxLength={3000}
              rows={4}
            />
          </div>
          {company.taxRegime === "simples" ? (
            <div className="grid gap-2">
              <Label htmlFor="defis-notes">Observações da DEFIS</Label>
              <Textarea
                id="defis-notes"
                name="defisNotes"
                defaultValue={company.defisNotes ?? ""}
                placeholder="Pendências da declaração, recibo, divergências…"
                maxLength={3000}
                rows={4}
              />
            </div>
          ) : null}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
              Salvar observações
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("pt-BR").format(new Date(`${value}T12:00:00`));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function ClosingRow({
  closing,
  company,
  year,
  today,
}: {
  closing: ClosingView;
  company: CompanyClosingView;
  year: number;
  today: string;
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const overdue = isClosingOverdue(closing.dueDate, closing.status, today);
  const completed = closing.status === "completed";

  function toggleCompleted() {
    startTransition(async () => {
      const result = await setClosingStatus({
        closingId: closing.id,
        status: completed ? "pending" : "completed",
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(completed ? "Período reaberto." : "Período concluído.");
      router.refresh();
    });
  }

  return (
    <li
      className={cn(
        "grid gap-3 rounded-lg border border-l-2 bg-background/45 p-3",
        completed
          ? "border-l-emerald-400/60 opacity-80"
          : overdue || closing.status === "blocked"
            ? "border-l-destructive"
            : "border-l-primary/60",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className={cn("font-medium", completed && "line-through")}>
              {closing.title}
            </p>
            <Badge
              className={cn(
                "h-5 px-1.5",
                CLOSING_STATUS_BADGE_CLASSES[closing.status],
              )}
            >
              {closing.status === "blocked" ? (
                <CircleAlert aria-hidden />
              ) : completed ? (
                <Check aria-hidden />
              ) : (
                <CircleDot aria-hidden />
              )}
              {CLOSING_STATUS_LABELS[closing.status]}
            </Badge>
          </div>
          <span
            className={cn(
              "mt-1 inline-flex items-center gap-1 font-mono text-xs text-muted-foreground",
              overdue && "font-semibold text-destructive",
            )}
          >
            <CalendarDays className="size-3" aria-hidden />
            {overdue ? "Atrasado · " : "Prazo "}
            {formatDate(closing.dueDate)}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant={completed ? "ghost" : "outline"}
            size="sm"
            disabled={pending}
            onClick={toggleCompleted}
          >
            {pending ? (
              <LoaderCircle className="animate-spin" aria-hidden />
            ) : completed ? (
              <Undo2 aria-hidden />
            ) : (
              <Check aria-hidden />
            )}
            {completed ? "Reabrir" : "Concluir"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={pending}
            aria-label={`Editar ${closing.title}`}
            onClick={() => setEditOpen(true)}
          >
            <Pencil aria-hidden />
          </Button>
        </div>
      </div>
      {closing.notes ? (
        <div className="flex gap-2 border-l-2 border-border pl-3 text-sm text-muted-foreground">
          <MessageSquareText className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p className="whitespace-pre-wrap">{closing.notes}</p>
        </div>
      ) : null}
      {completed && closing.completedAt ? (
        <p className="font-mono text-[11px] text-muted-foreground">
          Concluído{closing.completedBy ? ` por ${closing.completedBy}` : ""} em{" "}
          {formatDateTime(closing.completedAt)}
        </p>
      ) : null}
      {editOpen ? (
        <ClosingFormDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          company={company}
          year={year}
          initial={closing}
        />
      ) : null}
    </li>
  );
}

function CompanyCard({
  company,
  year,
  today,
}: {
  company: CompanyClosingView;
  year: number;
  today: string;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const yearClosed = Boolean(company.yearClosedAt);
  const defisCompleted = Boolean(company.defisCompletedAt);
  const openPeriods = company.closings.filter(
    (closing) => closing.status !== "completed",
  ).length;
  const blocked = company.closings.some(
    (closing) =>
      closing.status === "blocked" ||
      isClosingOverdue(closing.dueDate, closing.status, today),
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
        clientId: company.id,
        year,
        closed: !yearClosed,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(yearClosed ? "Ano reaberto." : `${year} marcado como fechado.`);
      router.refresh();
    });
  }

  function toggleDefis() {
    startTransition(async () => {
      const result = await setDefisCompleted({
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
    <article className="panel-cut panel-cut-sm overflow-hidden">
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
              expanded && "rotate-180",
            )}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate font-semibold">{company.name}</h2>
              <Badge
                className={cn(
                  "h-5 px-1.5",
                  TAX_REGIME_BADGE_CLASSES[company.taxRegime],
                )}
              >
                {TAX_REGIME_LABELS[company.taxRegime]}
              </Badge>
              {yearClosed ? (
                <Badge className="h-5 border-emerald-400/30 bg-emerald-400/10 px-1.5 text-emerald-300">
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
                      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                      : "border-amber-400/30 bg-amber-400/10 text-amber-300",
                  )}
                >
                  <FileCheck2 aria-hidden />
                  {defisCompleted ? "DEFIS entregue" : "DEFIS pendente"}
                </Badge>
              ) : null}
              {blocked ? (
                <Badge className="h-5 border-destructive/30 bg-destructive/10 px-1.5 text-destructive">
                  <CircleAlert aria-hidden /> pendência
                </Badge>
              ) : null}
            </div>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {company.closings.length === 0
                ? "Nenhum período lançado"
                : `${company.closings.length} período${company.closings.length === 1 ? "" : "s"} · ${openPeriods} em aberto`}
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
                  {yearClosed ? "Reabrir ano" : `Fechar ${year}`}
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

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="hud-label">Períodos e demandas de {year}</p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setNotesOpen(true)}
              >
                <MessageSquareText aria-hidden /> Observações do ano
              </Button>
              <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
                <Plus aria-hidden /> Adicionar período
              </Button>
            </div>
          </div>

          {company.closings.length > 0 ? (
            <ul className="grid gap-2">
              {company.closings.map((closing) => (
                <ClosingRow
                  key={closing.id}
                  closing={closing}
                  company={company}
                  year={year}
                  today={today}
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
          company={company}
          year={year}
        />
      ) : null}
      {notesOpen ? (
        <AnnualNotesDialog
          open={notesOpen}
          onOpenChange={setNotesOpen}
          company={company}
          year={year}
        />
      ) : null}
    </article>
  );
}

export function CompanyClosingBoard({
  companies,
  year,
  today,
}: {
  companies: CompanyClosingView[];
  year: number;
  today: string;
}) {
  return (
    <div className="grid gap-2">
      {companies.map((company) => (
        <CompanyCard
          key={company.id}
          company={company}
          year={year}
          today={today}
        />
      ))}
    </div>
  );
}
