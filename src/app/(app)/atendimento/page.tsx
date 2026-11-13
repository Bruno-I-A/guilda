import type { Metadata } from "next";
import { and, asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { isAdminRole } from "@/domain/guild-permissions";
import { parseSupportFilter } from "@/domain/support-inbox";
import type { OrgRole } from "@/domain/task-state";
import { listActiveClans, listOrgMembers } from "@/lib/org";
import { getActiveMember, requireOrgSession } from "@/lib/session";
import { countActiveSupportChannels, loadSupportConversation, loadSupportQueue, loadSupportViewer } from "@/lib/support/inbox";

import { SupportInbox } from "./support-inbox";
import { AtendimentoSectionHeader } from "./section-header";

export const metadata: Metadata = { title: "Atendimento" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AtendimentoPage({ searchParams }: { searchParams: Promise<{ c?: string; f?: string }> }) {
  const session = await requireOrgSession();
  const member = await getActiveMember();
  if (!member) redirect("/onboarding");
  const role = member.role as OrgRole;
  const params = await searchParams;
  const filter = parseSupportFilter(params.f);
  const selectedId = params.c && UUID.test(params.c) ? params.c : null;
  const now = new Date();

  const [data, clans, members] = await Promise.all([
    withOrgTx(session.orgId, async (tx) => {
      const viewer = await loadSupportViewer(tx, { orgId: session.orgId, userId: session.user.id, role });
      const queue = await loadSupportQueue(tx, { orgId: session.orgId, viewer, filter });
      const conversation = selectedId ? await loadSupportConversation(tx, { orgId: session.orgId, viewer, conversationId: selectedId, now }) : null;
      const channels = await countActiveSupportChannels(tx, session.orgId);
      // A busca de empresa é local, como na criação de missão: só quando há conversa aberta.
      const clients = conversation && !conversation.client
        ? await tx
            .select({ id: schema.clients.id, name: schema.clients.name, cnpj: schema.clients.cnpj })
            .from(schema.clients)
            .where(and(eq(schema.clients.orgId, session.orgId), eq(schema.clients.active, true)))
            .orderBy(asc(schema.clients.name))
        : [];
      return { queue, conversation, channels, clients };
    }),
    listActiveClans(session.orgId),
    listOrgMembers(session.orgId),
  ]);

  return (
    <div className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)]">
      <AtendimentoSectionHeader active="inbox" canManage={isAdminRole(role)} compact />
      <SupportInbox
        now={now.toISOString()}
        filter={filter}
        queue={data.queue.rows}
        counts={data.queue.counts}
        conversation={data.conversation}
        notFound={Boolean(selectedId) && !data.conversation}
        clients={data.clients}
        clans={clans.map((clan) => ({ id: clan.id, name: clan.name }))}
        members={members.map((person) => ({ id: person.userId, name: person.name }))}
        channels={data.channels}
        isAdmin={isAdminRole(role)}
      />
    </div>
  );
}
