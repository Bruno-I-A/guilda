import { dueDateLabel, taskPath } from "./links";
import { taskButton, type Notice } from "./notice";

export type InformativeNoticeTask = Readonly<{
  id: string;
  assigneeId: string | null;
  title: string;
  dueDate: Date | null;
  xpValue: number;
}>;

/**
 * Um aviso por pessoa que recebeu missão do Informativo: a missão, se for uma;
 * "N missões" com a lista, se forem várias. Missão só do clã (sem pessoa) não
 * entra: o líder distribui pela Mesa e o Mural já avisou.
 */
export function groupInformativeNotices(input: {
  requesterId: string;
  companyName: string | null;
  tasks: readonly InformativeNoticeTask[];
}): { userId: string; notice: Notice }[] {
  const byPerson = new Map<string, InformativeNoticeTask[]>();
  for (const task of input.tasks) {
    if (!task.assigneeId || task.assigneeId === input.requesterId) continue;
    byPerson.set(task.assigneeId, [...(byPerson.get(task.assigneeId) ?? []), task]);
  }
  return [...byPerson].map(([userId, tasks]) => {
    if (tasks.length === 1) {
      const [task] = tasks;
      return {
        userId,
        notice: {
          family: "new_mission",
          heading: "Nova missão para você",
          title: task.title,
          due: dueDateLabel(task.dueDate),
          xp: task.xpValue,
          path: taskPath(task.id),
          button: taskButton("start", task.id),
        },
      };
    }
    const dated = tasks.filter((task) => task.dueDate).sort((a, b) => a.dueDate!.getTime() - b.dueDate!.getTime());
    return {
      userId,
      notice: {
        family: "new_mission",
        heading: `${tasks.length} missões novas para você`,
        title: input.companyName ? `${tasks.length} missões de ${input.companyName}` : `${tasks.length} missões novas`,
        items: [...tasks.slice(0, 8).map((task) => task.title), ...(tasks.length > 8 ? [`e mais ${tasks.length - 8}`] : [])],
        due: dated.length ? `${dueDateLabel(dated[0].dueDate)} (a mais próxima)` : "Sem prazo",
        xp: tasks.reduce((sum, task) => sum + task.xpValue, 0),
        path: "tasks?view=informative",
      },
    };
  });
}
