"use client";

import {
  Check,
  ChevronDown,
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
import { Textarea } from "@/components/ui/textarea";
import type { ClosingStatus } from "@/lib/closings-ui";
import { CLOSING_YEAR_XP } from "@/domain/xp";
import {
  TAX_REGIME_BADGE_CLASSES,
  TAX_REGIME_LABELS,
  type TaxRegime,
} from "@/lib/clients-ui";
import { cn } from "@/lib/utils";

import {
  createClosing,
  deleteClosing,
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
  cashBalance: string | null;
  periodResult: string | null;
  shareholderLoan: string | null;
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
                <Input
                  id="closing-cash-balance"
                  name="cashBalance"
                  inputMode="decimal"
                  defaultValue={initial?.cashBalance ?? ""}
                  placeholder="Ex.: 15.000,00 ou -2.500,00"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="closing-period-result">Resultado</Label>
                <Input
                  id="closing-period-result"
                  name="periodResult"
                  inputMode="decimal"
                  defaultValue={initial?.periodResult ?? ""}
                  placeholder="Ex.: 8.500,00 ou -1.200,00"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="closing-shareholder-loan">
                Empréstimo de sócio
              </Label>
              <Input
                id="closing-shareholder-loan"
                name="shareholderLoan"
                inputMode="decimal"
                defaultValue={initial?.shareholderLoan ?? ""}
                placeholder="Ex.: 20.000,00"
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

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatMoney(value: string): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(value));
}

function ClosingRow({
  closing,
  company,
  year,
}: {
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
            <Badge className="h-5 border-emerald-400/25 bg-emerald-400/10 px-1.5 text-emerald-300">
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
                    ? "text-red-300"
                    : "text-emerald-300",
                )}
              >
                {formatMoney(closing.cashBalance)}
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
                    ? "text-red-300"
                    : "text-emerald-300",
                )}
              >
                {formatMoney(closing.periodResult)}
              </dd>
            </div>
          ) : null}
          {closing.shareholderLoan !== null ? (
            <div>
              <dt className="text-xs text-muted-foreground">
                Empréstimo de sócio
              </dt>
              <dd className="font-mono font-medium">
                {formatMoney(closing.shareholderLoan)}
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
}: {
  company: CompanyClosingView;
  year: number;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const yearClosed = Boolean(company.yearClosedAt);
  const defisCompleted = Boolean(company.defisCompletedAt);
  const hasClosings = company.closings.length > 0;
  const hasNotes = Boolean(
    company.yearNotes ||
      company.defisNotes ||
      company.closings.some((closing) => closing.notes),
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
      if (result.data?.xpAwarded) {
        toast.success(`Você ganhou ${result.data.xp} XP pelo fechamento anual.`);
      }
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
    <article
      className={cn(
        "panel-cut panel-cut-sm overflow-hidden transition-colors",
        hasClosings &&
          "border-emerald-400/30 bg-emerald-400/[0.04] shadow-[inset_3px_0_0_rgba(52,211,153,0.8)]",
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
              hasClosings && "text-emerald-300",
              expanded && "rotate-180",
            )}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2
                className={cn(
                  "truncate font-semibold",
                  hasClosings && "text-emerald-100",
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
                <Badge className="h-5 border-emerald-400/35 bg-emerald-400/15 px-1.5 text-emerald-200">
                  <ClipboardCheck aria-hidden />
                  com fechamento
                </Badge>
              ) : null}
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
              {hasNotes ? (
                <Badge className="h-5 border-amber-400/30 bg-amber-400/10 px-1.5 text-amber-300">
                  <MessageSquareText aria-hidden /> observação
                </Badge>
              ) : null}
            </div>
            <p
              className={cn(
                "mt-1 flex items-center gap-1.5 font-mono text-xs text-muted-foreground",
                hasClosings && "font-semibold text-emerald-300",
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
}: {
  companies: CompanyClosingView[];
  year: number;
}) {
  return (
    <div className="grid gap-2">
      {companies.map((company) => (
        <CompanyCard
          key={company.id}
          company={company}
          year={year}
        />
      ))}
    </div>
  );
}
