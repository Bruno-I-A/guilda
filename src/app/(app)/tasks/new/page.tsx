import type { Metadata } from "next";

import {
  listActiveClans,
  listOrgMembersWithResolvedClan,
} from "@/lib/org";
import { requireOrgSession } from "@/lib/session";

import { TaskForm } from "./task-form";

export const metadata: Metadata = { title: "Nova missão" };

export default async function NewTaskPage() {
  const session = await requireOrgSession();
  const [members, clans] = await Promise.all([
    listOrgMembersWithResolvedClan(session.orgId),
    listActiveClans(session.orgId),
  ]);

  return (
    <div className="mx-auto grid w-full max-w-2xl gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-wide">Nova missão</h1>
        <p className="text-muted-foreground">
          O XP é definido pela dificuldade e prioridade e fica congelado na
          criação.
        </p>
      </div>
      <TaskForm
        members={members.map((member) => ({
          userId: member.userId,
          name: member.name,
          clanName: member.clanName,
          resolutionError: member.resolutionError,
        }))}
        clans={clans}
        currentUserId={session.user.id}
      />
    </div>
  );
}
