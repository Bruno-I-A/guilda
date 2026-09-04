"use client";

import {
  ArrowRightLeft,
  Ban,
  Check,
  Hand,
  Pencil,
  Play,
  RotateCcw,
  Trash2,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action-context";
import { toastWithUndo } from "@/lib/undo-toast";

import {
  approveTask,
  submitTaskForApproval,
  cancelTask,
  claimTask,
  completeTask,
  deleteTask,
  rejectTask,
  revertCompletion,
  startTask,
  transferTask,
  updateTask,
} from "../actions";

interface TaskView {
  id: string;
  title: string;
  description: string;
  dueDate: string;
  xpValue: number;
  assigneeName: string | null;
  /** Quem pediu — é para essa pessoa que o retorno da entrega vai. */
  creatorName: string;
  clanId: string | null;
  clanName: string | null;
}

interface TransferCandidate {
  userId: string;
  name: string;
  clanName: string;
}

export function TaskActionBar({
  task,
  can,
  transferCandidates,
  restrictTransferToTaskClan,
  returnTo,
  startDestination,
}: {
  task: TaskView;
  can: {
    claim: boolean;
    start: boolean;
    resume: boolean;
    complete: boolean;
    submit: boolean;
    approve: boolean;
    reject: boolean;
    cancel: boolean;
    edit: boolean;
    delete: boolean;
    revert: boolean;
    transfer: boolean;
  };
  transferCandidates: TransferCandidate[];
  restrictTransferToTaskClan: boolean;
  /** Lista de origem, incluindo os filtros ativos. */
  returnTo: string;
  /** Para onde ir ao iniciar. `null` em missão comum, que fica na própria tela. */
  startDestination?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitNote, setSubmitNote] = useState("");
  const [approveOpen, setApproveOpen] = useState(false);
  const [approveNote, setApproveNote] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [revertOpen, setRevertOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState("");
  const [revertNote, setRevertNote] = useState("");
  const [transferNote, setTransferNote] = useState("");
  const [transferAssigneeId, setTransferAssigneeId] = useState(
    transferCandidates[0]?.userId ?? "",
  );

  const effectiveTransferAssigneeId = transferCandidates.some(
    (candidate) => candidate.userId === transferAssigneeId,
  )
    ? transferAssigneeId
    : transferCandidates[0]?.userId ?? "";

  /**
   * `destino` existe para as missões que só apontam para o trabalho de verdade
   * (Fluxo, Informativo): iniciar e ficar parado na tela da missão obrigaria a
   * pessoa a procurar sozinha onde executar. Sem destino, comporta-se como
   * sempre e apenas atualiza.
   */
  function run(
    action: () => Promise<ActionResult>,
    successMessage: string,
    destino?: string | null,
  ) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(successMessage);
      if (destino) {
        router.push(destino);
        return;
      }
      router.refresh();
    });
  }

  /**
   * Igual ao `run`, mas o aviso de sucesso vem com "Desfazer" ao lado. Para os
   * cliques que a pessoa se arrepende: conclusão e aprovação creditam XP, e
   * até aqui o único caminho de volta era um admin abrir o diálogo de reverter.
   */
  function runWithUndo(
    action: () => Promise<ActionResult>,
    successMessage: string,
    undo: () => Promise<ActionResult>,
    undoneMessage: string,
  ) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toastWithUndo({
        message: successMessage,
        undo,
        undoneMessage,
        onUndone: () => router.refresh(),
      });
      router.refresh();
    });
  }

  function runDelete() {
    startTransition(async () => {
      const result = await deleteTask({ taskId: task.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Missão excluída.");
      // A página desta missão deixa de existir — refresh() a manteria
      // montada; a lista é o único lugar para onde faz sentido voltar.
      router.push(returnTo);
    });
  }

  const hasPrimary =
    can.claim || can.start || can.resume || can.complete || can.approve || can.reject;
  if (
    !hasPrimary &&
    !can.edit &&
    !can.cancel &&
    !can.delete &&
    !can.revert &&
    !can.transfer
  ) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {can.claim ? (
        <Button
          disabled={pending}
          onClick={() =>
            run(() => claimTask({ taskId: task.id }), "Missão assumida por você!")
          }
        >
          <Hand aria-hidden /> Assumir
        </Button>
      ) : null}

      {can.start ? (
        <Button
          disabled={pending}
          onClick={() =>
            run(
              () => startTask({ taskId: task.id }),
              startDestination ? "Missão iniciada — abrindo o trabalho." : "Missão iniciada!",
              startDestination,
            )
          }
        >
          <Play aria-hidden /> Iniciar
        </Button>
      ) : null}

      {can.resume ? (
        <Button
          disabled={pending}
          onClick={() =>
            run(
              () => startTask({ taskId: task.id }),
              startDestination ? "Missão retomada — abrindo o trabalho." : "Missão retomada!",
              startDestination,
            )
          }
        >
          <RotateCcw aria-hidden /> Retomar ajustes
        </Button>
      ) : null}

      {can.complete ? (
        <Button
          disabled={pending}
          onClick={() =>
            runWithUndo(
              () => completeTask({ taskId: task.id }),
              `Concluída! Você ganhou ${task.xpValue} XP.`,
              () =>
                revertCompletion({
                  taskId: task.id,
                  note: "Conclusão desfeita por quem concluiu.",
                }),
              `Conclusão desfeita. Os ${task.xpValue} XP foram estornados.`,
            )
          }
        >
          <Check aria-hidden /> Concluir
        </Button>
      ) : null}

      {/* Quando Concluir também está disponível (missão de Informativo), o
          retorno é a opção, não o caminho — dois botões primários lado a lado
          não diriam qual é o normal. */}
      {can.submit ? (
        <Button
          variant={can.complete ? "outline" : "default"}
          disabled={pending}
          onClick={() => setSubmitOpen(true)}
        >
          <Send aria-hidden /> Entregar com retorno
        </Button>
      ) : null}

      {can.approve ? (
        <Button disabled={pending} onClick={() => setApproveOpen(true)}>
          <Check aria-hidden /> Aprovar e creditar XP
        </Button>
      ) : null}

      {can.reject ? (
        <Button variant="outline" disabled={pending} onClick={() => setRejectOpen(true)}>
          <Undo2 aria-hidden /> Devolver para ajuste
        </Button>
      ) : null}

      {can.transfer ? (
        <Button
          variant="outline"
          disabled={pending || transferCandidates.length === 0}
          onClick={() => setTransferOpen(true)}
        >
          <ArrowRightLeft aria-hidden /> Transferir
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

      {can.delete ? (
        <Button
          variant="ghost"
          className="text-destructive hover:text-destructive"
          disabled={pending}
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2 aria-hidden /> Excluir
        </Button>
      ) : null}

      {can.revert ? (
        <Button variant="outline" disabled={pending} onClick={() => setRevertOpen(true)}>
          <Undo2 aria-hidden /> Reverter conclusão
        </Button>
      ) : null}

      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Transferir missão</DialogTitle>
            <DialogDescription>
              Escolha a nova pessoa responsável. A nota é opcional e ficará no
              histórico da missão.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="transfer-assignee">Nova pessoa responsável</Label>
            <Select
              value={effectiveTransferAssigneeId}
              onValueChange={setTransferAssigneeId}
            >
              <SelectTrigger id="transfer-assignee" className="w-full">
                <SelectValue placeholder="Escolha uma pessoa" />
              </SelectTrigger>
              <SelectContent>
                {transferCandidates.map((candidate) => (
                  <SelectItem key={candidate.userId} value={candidate.userId}>
                    {candidate.name} · {candidate.clanName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="transfer-note">Nota (opcional)</Label>
            <Textarea
              id="transfer-note"
              value={transferNote}
              onChange={(event) => setTransferNote(event.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="Contexto útil para quem vai assumir…"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setTransferOpen(false)}>
              Voltar
            </Button>
            <Button
              disabled={pending || !effectiveTransferAssigneeId}
              onClick={() => {
                setTransferOpen(false);
                run(
                  () =>
                    transferTask({
                      taskId: task.id,
                      assigneeId: effectiveTransferAssigneeId,
                      clanId: restrictTransferToTaskClan
                        ? task.clanId ?? undefined
                        : undefined,
                      note: transferNote.trim() || undefined,
                    }),
                  "Missão transferida.",
                );
                setTransferNote("");
              }}
            >
              Transferir missão
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={submitOpen} onOpenChange={setSubmitOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Entregar com retorno</DialogTitle>
            <DialogDescription>
              Conte o que foi feito. {task.creatorName} recebe este retorno,
              confere e aprova — só então os {task.xpValue} XP são creditados.
              Se faltar algo, a missão volta para você com a explicação.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="submit-note">Retorno para {task.creatorName}</Label>
            <Textarea
              id="submit-note"
              value={submitNote}
              onChange={(event) => setSubmitNote(event.target.value)}
              placeholder="Ex.: Planilha atualizada, o total de agosto fechou em R$ 12.400. Falta só a nota da filial, que o cliente manda amanhã."
              rows={5}
              maxLength={2000}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Obrigatório: é a única forma de quem pediu saber o resultado sem
              ter que perguntar.
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setSubmitOpen(false)}>
              Voltar
            </Button>
            <Button
              disabled={pending || submitNote.trim().length < 3}
              onClick={() => {
                setSubmitOpen(false);
                run(
                  () =>
                    submitTaskForApproval({
                      taskId: task.id,
                      note: submitNote.trim(),
                    }),
                  `Entregue. ${task.creatorName} recebeu o seu retorno.`,
                );
                setSubmitNote("");
              }}
            >
              <Send aria-hidden /> Entregar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Aprovar entrega</DialogTitle>
            <DialogDescription>
              {task.assigneeName ?? "A pessoa responsável"} recebe {task.xpValue} XP.
              Se quiser, deixe um comentário: ele fica no histórico e chega para
              quem entregou.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="approve-note">Comentário (opcional)</Label>
            <Textarea
              id="approve-note"
              value={approveNote}
              onChange={(event) => setApproveNote(event.target.value)}
              placeholder="Ex.: Perfeito, já enviei para o cliente. Obrigado!"
              rows={3}
              maxLength={2000}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setApproveOpen(false)}>
              Voltar
            </Button>
            <Button
              disabled={pending}
              onClick={() => {
                setApproveOpen(false);
                run(
                  () =>
                    approveTask({
                      taskId: task.id,
                      note: approveNote.trim() || undefined,
                    }),
                  `Entrega aprovada. ${task.assigneeName ?? "A pessoa responsável"} recebeu ${task.xpValue} XP.`,
                );
                setApproveNote("");
              }}
            >
              <Check aria-hidden /> Aprovar e creditar XP
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Devolver para ajuste</DialogTitle>
            <DialogDescription>
              Explique o que falta. A missão volta para a pessoa responsável, que
              pode retomar, ajustar e enviar de novo.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="reject-note">Motivo</Label>
            <Textarea
              id="reject-note"
              value={rejectNote}
              onChange={(event) => setRejectNote(event.target.value)}
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

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Excluir esta missão?</DialogTitle>
            <DialogDescription>
              A missão some por completo, com todo o histórico — diferente de
              cancelar, que arquiva mas mantém o registro. Não é possível
              desfazer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Voltar
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => {
                setDeleteOpen(false);
                runDelete();
              }}
            >
              Excluir missão
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={revertOpen} onOpenChange={setRevertOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reverter conclusão?</DialogTitle>
            <DialogDescription>
              A missão volta para “Em andamento” e {task.assigneeName ?? "a pessoa responsável"}
              tem {task.xpValue} XP estornados por um novo lançamento no ledger.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="revert-note">Motivo (opcional)</Label>
            <Textarea
              id="revert-note"
              value={revertNote}
              onChange={(event) => setRevertNote(event.target.value)}
              placeholder="Ex.: Concluída por engano, entrega incompleta…"
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
                  "Conclusão revertida e XP estornado.",
                );
                setRevertNote("");
              }}
            >
              Reverter e estornar XP
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar missão</DialogTitle>
            <DialogDescription>
              Dificuldade e prioridade não mudam após a criação, pois o XP é
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
