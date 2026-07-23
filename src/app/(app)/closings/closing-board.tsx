"use client";

import {
  CalendarDays,
  Check,
  CircleAlert,
  CircleDot,
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
  updateClosing,
} from "./actions";

export interface ClosingClientOption {
  id: string;
  name: string;
  taxRegime: TaxRegime;
}

export interface ClosingView {
  id: string;
  clientId: string;
  clientName: string;
  taxRegime: TaxRegime;
  title: string;
  dueDate: string;
  status: ClosingStatus;
  notes: string | null;
  completedAt: string | null;
  completedBy: string | null;
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
  clients,
  year,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clients: ClosingClientOption[];
  year: number;
  initial?: ClosingView;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [clientId, setClientId] = useState(initial?.clientId ?? clients[0]?.id ?? "");
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
      toast.success(initial ? "Fechamento atualizado." : "Fechamento planejado.");
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
            {initial ? "Editar fechamento" : "Novo fechamento"}
          </DialogTitle>
          <DialogDescription>
            Defina livremente o que precisa ser fechado e até quando.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            submit({
              clientId,
              title: String(form.get("title") ?? ""),
              dueDate: String(form.get("dueDate") ?? ""),
              status,
              notes: String(form.get("notes") ?? ""),
            });
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="closing-client">Empresa</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger id="closing-client" className="w-full">
                <SelectValue>
                  {clients.find((client) => client.id === clientId)?.name ??
                    "Escolha uma empresa"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {clients.map((client) => (
                  <SelectItem key={client.id} value={client.id}>
                    {client.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="closing-title">Identificação do fechamento</Label>
            <Input
              id="closing-title"
              name="title"
              defaultValue={initial?.title ?? ""}
              placeholder="Ex.: Fechamento solicitado pelo cliente"
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
              placeholder="Ex.: aguardando extratos; documento com divergência; solicitar novamente ao cliente…"
              maxLength={3000}
              rows={5}
              required={status === "blocked"}
            />
            <p className="text-xs text-muted-foreground">
              Registre documentos faltantes, erros encontrados e próximos passos.
            </p>
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
            <Button type="submit" disabled={pending || !clientId}>
              {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
              {initial ? "Salvar alterações" : "Adicionar fechamento"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function NewClosingButton({
  clients,
  year,
}: {
  clients: ClosingClientOption[];
  year: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button disabled={clients.length === 0} onClick={() => setOpen(true)}>
        <Plus aria-hidden /> Novo fechamento
      </Button>
      {open ? (
        <ClosingFormDialog
          open={open}
          onOpenChange={setOpen}
          clients={clients}
          year={year}
        />
      ) : null}
    </>
  );
}

function formatDueDate(value: string): string {
  return new Intl.DateTimeFormat("pt-BR").format(new Date(`${value}T12:00:00`));
}

function formatCompletedAt(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function ClosingRow({
  closing,
  clients,
  year,
  today,
}: {
  closing: ClosingView;
  clients: ClosingClientOption[];
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
      toast.success(completed ? "Fechamento reaberto." : "Fechamento concluído.");
      router.refresh();
    });
  }

  return (
    <li
      className={cn(
        "panel-cut panel-cut-sm grid gap-3 border-l-2 p-4",
        completed
          ? "border-l-emerald-400/60 opacity-75"
          : overdue
            ? "border-l-destructive"
            : closing.status === "blocked"
              ? "border-l-destructive/70"
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
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{closing.clientName}</span>
            <Badge
              className={cn(
                "h-4 px-1.5",
                TAX_REGIME_BADGE_CLASSES[closing.taxRegime],
              )}
            >
              {TAX_REGIME_LABELS[closing.taxRegime]}
            </Badge>
            <span
              className={cn(
                "inline-flex items-center gap-1 font-mono",
                overdue && "font-semibold text-destructive",
              )}
            >
              <CalendarDays className="size-3" aria-hidden />
              {overdue ? "Atrasado · " : "Prazo "}
              {formatDueDate(closing.dueDate)}
            </span>
          </div>
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

      {completed && closing.completedAt && closing.completedBy ? (
        <p className="font-mono text-[11px] text-muted-foreground">
          Concluído por {closing.completedBy} em{" "}
          {formatCompletedAt(closing.completedAt)}
        </p>
      ) : null}

      {editOpen ? (
        <ClosingFormDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          clients={clients}
          year={year}
          initial={closing}
        />
      ) : null}
    </li>
  );
}

export function ClosingBoard({
  closings,
  clients,
  year,
  today,
}: {
  closings: ClosingView[];
  clients: ClosingClientOption[];
  year: number;
  today: string;
}) {
  return (
    <ul className="grid gap-2">
      {closings.map((closing) => (
        <ClosingRow
          key={closing.id}
          closing={closing}
          clients={clients}
          year={year}
          today={today}
        />
      ))}
    </ul>
  );
}
