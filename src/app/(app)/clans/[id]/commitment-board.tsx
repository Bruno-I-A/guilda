"use client";

import {
  Archive,
  ArchiveRestore,
  CalendarClock,
  Check,
  Plus,
  Repeat2,
  Send,
} from "lucide-react";
import Link from "next/link";
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
  CADENCE_LABELS,
  COMMITMENT_CADENCES,
  type CommitmentCadence,
} from "@/domain/commitments";
import type { ActionResult } from "@/lib/action-context";
import { cn } from "@/lib/utils";

import {
  createCommitment,
  createMissionForPeriod,
  setCommitmentActive,
  updateCommitmentPeriod,
} from "./commitment-actions";

export interface CommitmentPeriodView {
  id: string;
  label: string;
  dueDate: string;
  completedAt: string | null;
  completedByName: string | null;
  taskId: string | null;
  overdue: boolean;
}

export interface CommitmentView {
  id: string;
  clientId: string;
  clientName: string;
  title: string;
  notes: string | null;
  cadence: CommitmentCadence;
  active: boolean;
  periods: CommitmentPeriodView[];
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

/**
 * Uma ocorrência do ano. Três estados que importam: concluída (o histórico),
 * com missão viva (já está na fila de alguém) e em aberto — dessa última, a
 * vencida aparece destacada, porque é a única que pede ação agora.
 */
function PeriodRow({
  clanId,
  period,
  canManage,
  onDone,
}: {
  clanId: string;
  period: CommitmentPeriodView;
  canManage: boolean;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<ActionResult<unknown>>, message: string) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(message);
      onDone();
    });
  }

  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-md px-2.5 py-1.5 text-sm",
        period.completedAt
          ? "bg-muted/25"
          : period.overdue
            ? "bg-destructive/10"
            : "bg-muted/40",
      )}
    >
      <span className="min-w-20 font-mono text-xs">{period.label}</span>
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

      {period.completedAt ? (
        <Badge variant="outline" className="gap-1 border-transparent bg-primary/10">
          <Check className="size-3" aria-hidden />
          {period.completedByName ?? "concluído"}
        </Badge>
      ) : null}

      <span className="flex-1" />

      {period.taskId ? (
        <Link
          href={`/tasks/${period.taskId}`}
          className="font-mono text-xs text-primary hover:underline"
        >
          ver missão →
        </Link>
      ) : canManage && !period.completedAt ? (
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              run(
                () => createMissionForPeriod({ clanId, periodId: period.id }),
                "Missão criada na fila do clã.",
              )
            }
          >
            <Send className="size-3.5" aria-hidden /> Gerar missão
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() =>
              run(
                () =>
                  updateCommitmentPeriod({
                    clanId,
                    periodId: period.id,
                    completed: true,
                  }),
                "Período concluído.",
              )
            }
          >
            <Check className="size-3.5" aria-hidden /> Concluir
          </Button>
        </div>
      ) : null}
    </li>
  );
}

export function CommitmentBoard({
  clanId,
  canManage,
  commitments,
  clients,
  year,
}: {
  clanId: string;
  canManage: boolean;
  commitments: readonly CommitmentView[];
  clients: readonly ClientOption[];
  year: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [createOpen, setCreateOpen] = useState(false);
  const [clientId, setClientId] = useState("");
  const [title, setTitle] = useState("");
  const [cadence, setCadence] = useState<CommitmentCadence>("quarterly");
  const [notes, setNotes] = useState("");

  const refresh = () => router.refresh();

  function submit() {
    if (!clientId || title.trim().length < 3) return;
    startTransition(async () => {
      const result = await createCommitment({
        clanId,
        clientId,
        title: title.trim(),
        cadence,
        notes: notes.trim() || undefined,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `Compromisso criado — ${result.data?.periods ?? 0} período(s) planejado(s) para ${year}.`,
      );
      setCreateOpen(false);
      setClientId("");
      setTitle("");
      setNotes("");
      refresh();
    });
  }

  const active = commitments.filter((commitment) => commitment.active);
  const archived = commitments.filter((commitment) => !commitment.active);
  const openOverdue = active.reduce(
    (total, commitment) =>
      total + commitment.periods.filter((period) => period.overdue).length,
    0,
  );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="hud-label">Compromissos de {year}</p>
          <p className="text-sm text-muted-foreground">
            O que se repete para cada empresa — a recorrência fica aqui, não na
            memória de quem lembrou.
          </p>
        </div>
        {canManage ? (
          <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden /> Novo compromisso
          </Button>
        ) : null}
      </div>

      {openOverdue > 0 ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {openOverdue}{" "}
          {openOverdue === 1 ? "período vencido" : "períodos vencidos"} sem
          conclusão.
        </p>
      ) : null}

      {active.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nenhum compromisso ativo neste clã. Cadastre o que se repete —
          distribuição de lucros, conferências periódicas — para o ano inteiro
          ficar planejado.
        </p>
      ) : (
        active.map((commitment) => (
          <section
            key={commitment.id}
            className="panel-cut grid gap-2 rounded-lg border bg-card/50 p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="font-medium">
                  {commitment.title}
                  <span className="text-muted-foreground"> — {commitment.clientName}</span>
                </h3>
                {commitment.notes ? (
                  <p className="mt-0.5 text-xs whitespace-pre-wrap text-muted-foreground">
                    {commitment.notes}
                  </p>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="gap-1">
                  <Repeat2 className="size-3" aria-hidden />
                  {CADENCE_LABELS[commitment.cadence]}
                </Badge>
                {canManage ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await setCommitmentActive({
                          clanId,
                          commitmentId: commitment.id,
                          active: false,
                        });
                        if (!result.ok) {
                          toast.error(result.error);
                          return;
                        }
                        toast.info("Compromisso arquivado.");
                        refresh();
                      })
                    }
                  >
                    <Archive className="size-3.5" aria-hidden />
                  </Button>
                ) : null}
              </div>
            </div>

            <ul className="grid gap-1">
              {commitment.periods.map((period) => (
                <PeriodRow
                  key={period.id}
                  clanId={clanId}
                  period={period}
                  canManage={canManage}
                  onDone={refresh}
                />
              ))}
            </ul>
          </section>
        ))
      )}

      {archived.length > 0 ? (
        <section className="grid gap-2">
          <h3 className="hud-label">Arquivados</h3>
          <ul className="grid gap-1">
            {archived.map((commitment) => (
              <li
                key={commitment.id}
                className="flex flex-wrap items-center gap-2 rounded-md bg-muted/25 px-2.5 py-1.5 text-sm text-muted-foreground"
              >
                <span className="min-w-0 flex-1 truncate">
                  {commitment.title} — {commitment.clientName}
                </span>
                {canManage ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await setCommitmentActive({
                          clanId,
                          commitmentId: commitment.id,
                          active: true,
                        });
                        if (!result.ok) {
                          toast.error(result.error);
                          return;
                        }
                        toast.success("Compromisso reativado.");
                        refresh();
                      })
                    }
                  >
                    <ArchiveRestore className="size-3.5" aria-hidden /> Reativar
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Novo compromisso</DialogTitle>
            <DialogDescription>
              A regra que se repete. Ao salvar, os períodos de {year} já nascem
              planejados; a missão de cada um você gera quando o período chegar.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Label htmlFor="commitment-client">Empresa</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger id="commitment-client" className="w-full">
                <SelectValue placeholder="Escolha a empresa" />
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
            <Label htmlFor="commitment-title">O que se repete</Label>
            <Input
              id="commitment-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Ex.: Distribuição de lucros"
              maxLength={200}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="commitment-cadence">Periodicidade</Label>
            <Select
              value={cadence}
              onValueChange={(value) => setCadence(value as CommitmentCadence)}
            >
              <SelectTrigger id="commitment-cadence" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMMITMENT_CADENCES.map((option) => (
                  <SelectItem key={option} value={option}>
                    {CADENCE_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="commitment-notes">O combinado (opcional)</Label>
            <Textarea
              id="commitment-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Valores, condições, o que observar…"
            />
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={pending || !clientId || title.trim().length < 3}
              onClick={submit}
            >
              Criar e planejar {year}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
