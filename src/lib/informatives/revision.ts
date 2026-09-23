import { createHash } from "node:crypto";

import {
  informativeDraftPayloadSchema,
  type InformativeDraftPayload,
  type InformativeDraftTask,
} from "@/lib/ai/informative-schema";

interface ClanDestination {
  id: string;
  name: string;
}

export type InformativeTaskRevision =
  | {
      type: "edit";
      index: number;
      title: string;
      description: string;
      destination: ClanDestination | null;
    }
  | {
      type: "add";
      title: string;
      description: string;
      destination: ClanDestination;
    }
  | { type: "remove"; index: number };

export function informativeTasksRevision(
  tasks: readonly InformativeDraftTask[],
): string {
  return createHash("sha256").update(JSON.stringify(tasks)).digest("hex");
}

export function reviseInformativeTasks(
  payload: InformativeDraftPayload,
  revision: InformativeTaskRevision,
): InformativeDraftPayload {
  const tasks = [...payload.tasks];

  if (revision.type === "add") {
    tasks.push({
      category: "general",
      title: revision.title,
      description: revision.description,
      priority: 2,
      difficulty: 1,
      dueDate: null,
      closingYear: null,
      sourceSection: revision.description.slice(0, 1000),
      sector: revision.destination.name,
      suggestions: [],
      assignmentType: "clan",
      assigneeId: null,
      assigneeName: null,
      clanId: revision.destination.id,
      clanName: revision.destination.name,
    });
  } else {
    const task = tasks[revision.index];
    if (!task) throw new RangeError("Missão não encontrada nesta prévia.");

    if (revision.type === "remove") {
      tasks.splice(revision.index, 1);
    } else {
      tasks[revision.index] = revision.destination
        ? {
            ...task,
            title: revision.title,
            description: revision.description,
            sector: revision.destination.name,
            suggestions: [],
            assignmentType: "clan",
            assigneeId: null,
            assigneeName: null,
            clanId: revision.destination.id,
            clanName: revision.destination.name,
          }
        : {
            ...task,
            title: revision.title,
            description: revision.description,
          };
    }
  }

  return informativeDraftPayloadSchema.parse({ ...payload, tasks });
}
