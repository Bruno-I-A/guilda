"use client";

import {
  Ban,
  Check,
  Pencil,
  Play,
  RotateCcw,
  Send,
  Undo2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

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

import {
  approveTask,
  cancelTask,
  completeOwnTask,
  rejectTask,
  revertCompletion,
  startTask,
  submitTask,
  updateTask,
  type ActionResult,
} from "../actions";

interface TaskView {
  id: string;
  title: string;
  description: string;
  dueDate: string; // YYYY-MM-DD ou ""
  xpValue: number;
  assigneeName: string;
}

export function TaskActionBar({
  task,
  can,
}: {
  task: TaskView;
  can: {
    start: boolean;
    resume: boolean;
    submit: boolean;
    completeSelf: boolean;
    approve: boolean;
    reject: boolean;
    cancel: boolean;
    edit: boolean;
    revert: boolean;
  };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [revertOpen, setRevertOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState("");
  const [revertNote, setRevertNote] = useState("");

  function run(action: () => Promise<ActionResult>, successMessage: string) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(successMessage);
      router.refresh();
    });
  }

  const hasPrimary =
    can.start ||
    can.resume ||
    can.submit ||
    can.completeSelf ||
    can.approve ||
    can.reject;
  if (!hasPrimary && !can.edit && !can.cancel && !can.revert) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {can.start ? (
        <Button
          disabled={pending}
          onClick={() => run(() => startTask({ taskId: task.id }), "Missão iniciada!")}
        >
          <Play aria-hidden /> Iniciar
        </Button>
      ) : null}

      {can.resume ? (
        <Button
          disabled={pending}
          onClick={() => run(() => startTask({ taskId: task.id }), "Missão retomada!")}
        >
          <RotateCcw aria-hidden /> Retomar ajustes
        </Button>
      ) : null}

      {can.submit ? (
        <Button
          disabled={pending}
          onClick={() =>
            run(() => submitTask({ taskId: task.id }), "Enviada para aprovação!")
          }
        >
          <Send aria-hidden /> Marcar como feita
        </Button>
      ) : null}

      {can.completeSelf ? (
        <Button
          disabled={pending}
          onClick={() =>
            run(
              () => completeOwnTask({ taskId: task.id }),
              `Concluída! Você ganhou ${task.xpValue} XP.`,
            )
          }
        >
          <Check aria-hidden /> Concluir
        </Button>
      ) : null}

      {can.approve ? (
        <Button
          disabled={pending}
          onClick={() =>
            run(
              () => approveTask({ taskId: task.id }),
              `Aprovada! ${task.assigneeName} ganhou ${task.xpValue} XP.`,
            )
          }
        >
          <Check aria-hidden /> Aprovar
        </Button>
      ) : null}

      {can.reject ? (
        <Button variant="outline" disabled={pending} onClick={() => setRejectOpen(true)}>
          <Undo2 aria-hidden /> Rejeitar
        </Button>
      ) : null}

      {can.edit ? (
        <Button variant="outline" disabled={pending} onClick={() => setEditOpen(true)}>
          <Pencil aria-hidden /> Editar
        </Button>
      ) : null}

      {can.cancel ? (
        <Button
          variant="ghost"
          className="text-destructive hover:text-destructive"
          disabled={pending}
          onClick={() => setCancelOpen(true)}
        >
          <Ban aria-hidden /> Cancelar
        </Button>
      ) : null}

      {can.revert ? (
        <Button variant="outline" disabled={pending} onClick={() => setRevertOpen(true)}>
          <Undo2 aria-hidden /> Reverter conclusão
        </Button>
      ) : null}

      {/* Rejeitar — nota obrigatória */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rejeitar entrega</DialogTitle>
            <DialogDescription>
              Explique o que precisa de ajuste — a nota é obrigatória e fica
              registrada na linha do tempo.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="reject-note">Motivo</Label>
            <Textarea
              id="reject-note"
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              placeholder="Ex.: Falta atualizar a planilha de custos…"
              rows={4}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              Voltar
            </Button>
            <Button
              variant="destructive"
              disabled={pending || rejectNote.trim().length < 3}
              onClick={() => {
                setRejectOpen(false);
                run(
                  () => rejectTask({ taskId: task.id, note: rejectNote.trim() }),
                  "Missão devolvida para ajustes.",
                );
                setRejectNote("");
              }}
            >
              Rejeitar com nota
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancelar — confirmação */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Cancelar esta missão?</DialogTitle>
            <DialogDescription>
              O cancelamento é definitivo e nenhum XP é creditado.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              Voltar
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => {
                setCancelOpen(false);
                run(() => cancelTask({ taskId: task.id }), "Missão cancelada.");
              }}
            >
              Cancelar missão
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reverter conclusão — estorna o XP com lançamento negativo */}
      <Dialog open={revertOpen} onOpenChange={setRevertOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reverter conclusão?</DialogTitle>
            <DialogDescription>
              A missão volta para “Em andamento” e {task.assigneeName} tem{" "}
              {task.xpValue} XP estornados (lançamento negativo no ledger — o
              crédito original não é apagado).
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="revert-note">Motivo (opcional)</Label>
            <Textarea
              id="revert-note"
              value={revertNote}
              onChange={(e) => setRevertNote(e.target.value)}
              placeholder="Ex.: Aprovada por engano, entrega incompleta…"
              rows={3}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRevertOpen(false)}>
              Voltar
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => {
                setRevertOpen(false);
                run(
                  () =>
                    revertCompletion({
                      taskId: task.id,
                      note: revertNote.trim() || undefined,
                    }),
                  "Conclusão revertida — XP estornado.",
                );
                setRevertNote("");
              }}
            >
              Reverter e estornar XP
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Editar — título/descrição/prazo (dificuldade e prioridade são imutáveis) */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar missão</DialogTitle>
            <DialogDescription>
              Dificuldade e prioridade não mudam após a criação — o XP é
              congelado.
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              setEditOpen(false);
              run(
                () =>
                  updateTask({
                    taskId: task.id,
                    title: String(form.get("title") ?? ""),
                    description: String(form.get("description") ?? ""),
                    dueDate: String(form.get("dueDate") ?? ""),
                  }),
                "Missão atualizada!",
              );
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="edit-title">Título</Label>
              <Input
                id="edit-title"
                name="title"
                defaultValue={task.title}
                maxLength={200}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-description">Descrição</Label>
              <Textarea
                id="edit-description"
                name="description"
                defaultValue={task.description}
                rows={4}
                maxLength={5000}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-dueDate">Prazo</Label>
              <Input
                id="edit-dueDate"
                name="dueDate"
                type="date"
                defaultValue={task.dueDate}
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                Salvar alterações
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
