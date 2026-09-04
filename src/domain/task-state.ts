/**
 * Máquina de estados do ciclo de vida da tarefa (funções puras).
 * Toda validação de transição acontece no servidor — a UI apenas
 * reflete estas regras, nunca as substitui.
 */

export const TASK_STATUSES = [
  "pending",
  "in_progress",
  "awaiting_approval",
  "completed",
  "rejected",
  "cancelled",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type OrgRole = "owner" | "admin" | "member";

/**
 * Os fatos que a decisão precisa. Todos os campos são OBRIGATÓRIOS de
 * propósito, mesmo os que quase sempre são `null`: quando eram opcionais, um
 * chamador que esquecia de preenchê-los compilava e recebia a decisão errada
 * em silêncio — foi assim que o bot do Telegram passou a recusar uma conclusão
 * que a web já permitia. Campo novo aqui quebra o build de quem não decidiu o
 * que fazer com ele, que é o comportamento desejado.
 */
export interface TransitionContext {
  actor: { id: string; role: OrgRole };
  task: {
    creatorId: string;
    assigneeId: string | null;
    status: TaskStatus;
    /**
     * Quando a conclusão foi registrada — abre a janela de desfazer. `null`
     * quando a missão não está concluída, ou quando o chamador não oferece
     * desfazer (o bot do Telegram, por exemplo).
     */
    completedAt: Date | null;
    /** Quem registrou a conclusão; só essa pessoa desfaz sem ser admin. */
    completedBy: string | null;
    /**
     * Missão nascida de um Informativo. Não é pedido de uma pessoa para outra:
     * é rotina do clã, e por isso termina em conclusão, não em aprovação.
     */
    fromInformative: boolean;
  };
  /** Injetável para o teste não depender do relógio da máquina. */
  now?: Date;
}

/**
 * Por quanto tempo quem concluiu pode desfazer a própria conclusão sem
 * depender de um admin. Curta de propósito: é para o clique errado, não para
 * reabrir o trabalho de ontem. Passada a janela, volta a ser reversão
 * administrativa como sempre foi.
 */
export const UNDO_COMPLETION_WINDOW_MS = 5 * 60 * 1000;

/**
 * A pessoa que acabou de concluir ainda está dentro da janela de
 * arrependimento? O estorno de XP acontece igual — o que a janela dispensa é
 * o admin, não o registro.
 */
export function isWithinUndoWindow(
  ctx: Pick<TransitionContext, "actor" | "task" | "now">,
): boolean {
  const { completedAt, completedBy } = ctx.task;
  if (!completedAt || completedBy !== ctx.actor.id) return false;
  const decorrido = (ctx.now ?? new Date()).getTime() - completedAt.getTime();
  return decorrido >= 0 && decorrido <= UNDO_COMPLETION_WINDOW_MS;
}

export type TransitionDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Grafo de transições válidas. `completed → in_progress` é a reversão
 * administrativa; `in_progress → completed` é a conclusão direta pela
 * pessoa responsável, sem aprovação de terceiros.
 */
const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  pending: ["in_progress", "cancelled"],
  in_progress: ["awaiting_approval", "completed", "cancelled"],
  awaiting_approval: ["completed", "rejected", "cancelled"],
  rejected: ["in_progress", "cancelled"],
  completed: ["in_progress"],
  cancelled: [],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

function isApproverRole(role: OrgRole): boolean {
  return role === "admin" || role === "owner";
}

function deny(reason: string): TransitionDecision {
  return { allowed: false, reason };
}

const ALLOW: TransitionDecision = { allowed: true };

/**
 * Decide se o ator pode executar a transição, combinando o grafo de
 * estados com as regras de papel/propriedade:
 *
 * - iniciar / enviar para aprovação / retomar: só o responsável;
 * - conclusão direta pela pessoa responsável: auto-missão e missão de
 *   Informativo; missão avulsa de terceiro passa por aprovação;
 * - aprovar / rejeitar tarefa de terceiros: criador ou admin/owner;
 * - cancelar: criador ou admin/owner;
 * - reverter conclusão: admin/owner a qualquer tempo, e quem concluiu dentro
 *   da janela de arrependimento (ver UNDO_COMPLETION_WINDOW_MS).
 */
export function authorizeTransition(
  to: TaskStatus,
  ctx: TransitionContext,
): TransitionDecision {
  const { actor, task } = ctx;
  const from = task.status;

  if (!canTransition(from, to)) {
    return deny("Transição de status inválida.");
  }

  const isAssignee = actor.id === task.assigneeId;
  const isCreator = actor.id === task.creatorId;
  const isAdmin = isApproverRole(actor.role);

  // pending → in_progress (iniciar) e rejected → in_progress (retomar)
  if (to === "in_progress" && (from === "pending" || from === "rejected")) {
    return isAssignee
      ? ALLOW
      : deny("Apenas a pessoa responsável pode trabalhar na missão.");
  }

  // completed → in_progress: reversão administrativa OU o desfazer de quem
  // acabou de concluir, dentro da janela de arrependimento.
  if (to === "in_progress" && from === "completed") {
    if (isAdmin || isWithinUndoWindow(ctx)) return ALLOW;
    return task.completedBy === actor.id
      ? deny(
          "O tempo para desfazer esta conclusão passou. Peça a um admin para reverter.",
        )
      : deny("Apenas admin ou owner pode reverter uma conclusão.");
  }

  // in_progress → awaiting_approval (enviar para aprovação)
  if (to === "awaiting_approval") {
    return isAssignee
      ? ALLOW
      : deny("Apenas a pessoa responsável pode enviar para aprovação.");
  }

  // in_progress → completed (conclusão direta).
  //
  // Missão AVULSA que alguém criou para outra pessoa termina em aprovação: quem
  // pediu o trabalho precisa ver o retorno antes de dar por feito. Sem esta
  // régua, a pessoa responsável concluía sozinha e creditava o próprio XP, e
  // quem pediu nunca via o resultado.
  //
  // Missão de INFORMATIVO não: ali não existe "quem pediu". O pedido veio do
  // Informativo, e quem consta como criador só preparou o pacote — cobrar dele
  // uma aprovação transformava rotina do clã em vai-e-volta sem leitor. Quem
  // executa conclui; entregar com retorno segue disponível, como opção.
  if (to === "completed" && from === "in_progress") {
    if (!isAssignee) {
      return deny("Apenas a pessoa responsável pode concluir a missão.");
    }
    if (task.fromInformative || task.creatorId === task.assigneeId) {
      return ALLOW;
    }
    return deny(
      "Missão criada por outra pessoa precisa ser enviada para aprovação — quem pediu é quem conclui.",
    );
  }

  // awaiting_approval → completed | rejected (decisão de aprovação)
  if (to === "completed" || to === "rejected") {
    const selfAssigned = task.creatorId === task.assigneeId;

    if (selfAssigned && isAssignee) {
      // Auto-tarefa não precisa de aprovação de terceiros (cobre também
      // tarefas antigas que já estavam paradas em awaiting_approval).
      return ALLOW;
    }

    if (isAdmin) {
      return ALLOW;
    }
    if (isCreator && !selfAssigned) {
      return ALLOW;
    }
    return deny("Apenas quem criou a missão ou um admin pode aprovar/rejeitar.");
  }

  // → cancelled
  if (to === "cancelled") {
    return isCreator || isAdmin
      ? ALLOW
      : deny("Apenas quem criou a missão ou um admin pode cancelar.");
  }

  return deny("Transição de status inválida.");
}

export interface TaskDeletionContext {
  actor: { id: string; role: OrgRole };
  task: {
    creatorId: string;
    /**
     * A missão já passou por `→ completed` alguma vez — mesmo que tenha
     * sido revertida depois. `creditTaskXp` e `syncClosingFromTask` só
     * disparam nessa transição, e o crédito de XP nunca é apagado (regra
     * inegociável do ledger imutável), então este é o único fato que
     * importa: não é sobre o status atual da missão.
     */
    everCompleted: boolean;
    /**
     * A missão já tem linha em `task_transfers` — de um "assumir", uma
     * transferência ou uma distribuição da Mesa do Líder. Essa tabela é
     * INSERT-only para o role da aplicação (UPDATE/DELETE revogados na
     * migration 0022, mesmo tratamento do xp_ledger): não há como apagar a
     * missão sem apagar a linha do histórico primeiro, e isso o banco não
     * deixa. Por isso o bloqueio é sobre o fato, não uma escolha de design.
     */
    everTransferred: boolean;
  };
}

/**
 * Excluir é diferente de cancelar: cancelar arquiva (estado terminal, mantém
 * o histórico); excluir apaga o registro por completo. Por isso só é
 * permitido para uma missão que nunca gerou XP, nunca tocou um fechamento e
 * nunca mudou de mãos — uma missão que precisa sumir de vez porque nunca
 * deveria ter existido (duplicata, empresa errada, teste). Qualquer missão
 * com histórico de verdade usa cancelar.
 */
export function authorizeTaskDeletion(
  ctx: TaskDeletionContext,
): TransitionDecision {
  const { actor, task } = ctx;

  if (task.everCompleted) {
    return deny(
      "Esta missão já foi concluída e gerou XP — não pode ser excluída. Use cancelar para tirá-la de circulação sem apagar o histórico.",
    );
  }
  if (task.everTransferred) {
    return deny(
      "Esta missão já mudou de responsável alguma vez — o histórico de transferência é permanente e impede a exclusão. Use cancelar.",
    );
  }

  return actor.id === task.creatorId || isApproverRole(actor.role)
    ? ALLOW
    : deny("Apenas quem criou a missão ou um admin pode excluí-la.");
}
