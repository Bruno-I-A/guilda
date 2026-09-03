import type { Metadata } from "next";
import { and, asc, eq } from "drizzle-orm";

import { PageHeader } from "@/components/page-header";
import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import {
  listActiveClans,
  listOrgMembersWithResolvedClan,
} from "@/lib/org";
import { requireOrgSession } from "@/lib/session";

import { TaskForm } from "./task-form";

export const metadata: Metadata = { title: "Nova missão" };

export default async function NewTaskPage() {
  const session = await requireOrgSession();
  const [members, clans, clients] = await Promise.all([
    listOrgMembersWithResolvedClan(session.orgId),
    listActiveClans(session.orgId),
    // Só as ativas: missão nova não deve apontar para empresa que saiu de cena.
    // A lista inteira vai para o navegador porque a busca é local — são
    // centenas de linhas curtas, e ir ao servidor a cada tecla seria pior.
    withOrgTx(session.orgId, (tx) =>
      tx
        .select({
          id: schema.clients.id,
          name: schema.clients.name,
          cnpj: schema.clients.cnpj,
        })
        .from(schema.clients)
        .where(
          and(
            eq(schema.clients.orgId, session.orgId),
            eq(schema.clients.active, true),
          ),
        )
        .orderBy(asc(schema.clients.name)),
    ),
  ]);

  return (
    <div className="mx-auto grid w-full max-w-2xl gap-6">
      <PageHeader
        title="Nova missão"
        description="O XP é definido pela dificuldade e prioridade e fica congelado na criação."
      />
      <TaskForm
        members={members.map((member) => ({
          userId: member.userId,
          name: member.name,
          clanName: member.clanName,
          resolutionError: member.resolutionError,
        }))}
        clans={clans}
        clients={clients}
        currentUserId={session.user.id}
      />
    </div>
  );
}
