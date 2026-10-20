import type { TaskStatus } from "@/domain/task-state";

import type { TaskCallbackAction } from "./endpoint";

export const TASK_ACTION_TRANSITIONS: Record<
  TaskCallbackAction,
  { to: TaskStatus; allowedFrom: readonly TaskStatus[] }
> = {
  start: { to: "in_progress", allowedFrom: ["pending", "rejected"] },
  // Compatibilidade com botões já enviados: "submit" conclui diretamente.
  submit: { to: "completed", allowedFrom: ["in_progress"] },
  // Inclui approval para reparar verificações do RH que ficaram presas nesse
  // estado antes da conclusão direta; a máquina de estados limita a exceção.
  complete: { to: "completed", allowedFrom: ["in_progress", "awaiting_approval"] },
  // Aprovação e rejeição continuam disponíveis apenas para missões legadas.
  approve: { to: "completed", allowedFrom: ["awaiting_approval"] },
  reject: { to: "rejected", allowedFrom: ["awaiting_approval"] },
  cancel: {
    to: "cancelled",
    allowedFrom: ["pending", "in_progress", "awaiting_approval", "rejected"],
  },
};
