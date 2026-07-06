import type { Metadata } from "next";

import { listOrgMembers } from "@/lib/org";
import { requireOrgSession } from "@/lib/session";

import { TaskForm } from "./task-form";

export const metadata: Metadata = { title: "Nova tarefa" };

export default async function NewTaskPage() {
  const session = await requireOrgSession();
  const members = await listOrgMembers(session.orgId);

  return (
    <div className="mx-auto grid w-full max-w-lg gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-wide">Nova tarefa</h1>
        <p className="text-muted-foreground">
          O XP é definido pela dificuldade e prioridade e fica congelado na
          criação.
        </p>
      </div>
      <TaskForm
        members={members.map((m) => ({ userId: m.userId, name: m.name }))}
        currentUserId={session.user.id}
      />
    </div>
  );
}
