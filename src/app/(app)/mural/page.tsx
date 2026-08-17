import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { canEmphasizeNotice, canSeeNoticeAcknowledgements } from "@/domain/guild-permissions";
import type { OrgRole } from "@/domain/task-state";
import { getActiveMember, requireOrgSession } from "@/lib/session";

import { NoticeBoard, type NoticeView } from "./notice-board";

export const metadata: Metadata = { title: "Mural" };

export default async function MuralPage() {
  const session = await requireOrgSession();
  const viewer = await getActiveMember();
  if (!viewer) redirect("/onboarding");
  const role = viewer.role as OrgRole;

  const { notices, orgMembers, leadsAnyClan } = await withOrgTx(
    session.orgId,
    async (tx) => {
      const [noticeRows, memberRows, leadership] = await Promise.all([
        tx.query.guildNotices.findMany({
          where: and(
            eq(schema.guildNotices.orgId, session.orgId),
            isNull(schema.guildNotices.archivedAt),
          ),
          with: {
            author: { columns: { id: true, name: true } },
            client: { columns: { id: true, name: true } },
            reads: { columns: { userId: true } },
          },
          orderBy: [desc(schema.guildNotices.pinned), desc(schema.guildNotices.publishedAt)],
          limit: 60,
        }),
        tx
          .select({ userId: schema.member.userId, name: schema.user.name })
          .from(schema.member)
          .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
          .where(eq(schema.member.organizationId, session.orgId))
          .orderBy(asc(schema.user.name)),
        tx
          .select({ id: schema.clanMemberships.id })
          .from(schema.clanMemberships)
          .innerJoin(
            schema.clans,
            and(
              eq(schema.clans.id, schema.clanMemberships.clanId),
              eq(schema.clans.orgId, schema.clanMemberships.orgId),
            ),
          )
          .where(
            and(
              eq(schema.clanMemberships.orgId, session.orgId),
              eq(schema.clanMemberships.userId, session.user.id),
              eq(schema.clanMemberships.isLeader, true),
              eq(schema.clans.active, true),
            ),
          )
          .limit(1),
      ]);

      return {
        notices: noticeRows,
        orgMembers: memberRows,
        leadsAnyClan: leadership.length > 0,
      };
    },
  );

  const facts = { role, leadsAnyClan };
  const canEmphasize = canEmphasizeNotice(facts);
  const nameByUserId = new Map(orgMembers.map((m) => [m.userId, m.name]));

  const views: NoticeView[] = notices.map((notice) => {
    const readerIds = new Set(notice.reads.map((read) => read.userId));
    const canSeeAcks = canSeeNoticeAcknowledgements({
      ...facts,
      isAuthor: notice.authorId === session.user.id,
    });

    // Só conta gente que ainda é membro da organização — quem saiu não
    // deve manter um aviso eternamente "pendente".
    const pendingNames = orgMembers
      .filter((member) => !readerIds.has(member.userId))
      .map((member) => member.name);

    return {
      id: notice.id,
      kind: notice.kind,
      title: notice.title,
      body: notice.body,
      authorName: nameByUserId.get(notice.authorId) ?? notice.author?.name ?? "—",
      clientName: notice.client?.name ?? null,
      publishedAt: notice.publishedAt.toISOString(),
      requiresAck: notice.requiresAck,
      pinned: notice.pinned,
      acknowledged: readerIds.has(session.user.id),
      canManage: canSeeAcks,
      ackCount: orgMembers.length - pendingNames.length,
      totalMembers: orgMembers.length,
      pendingNames: canSeeAcks ? pendingNames : [],
    };
  });

  return (
    <div className="grid gap-5">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-wide">Mural</h1>
        <p className="text-muted-foreground">
          Avisos da Guilda inteira. Empresa nova entra aqui sozinha, junto com os
          combinados que não viram missão.
        </p>
      </div>

      <NoticeBoard
        notices={views}
        canEmphasize={canEmphasize}
        currentUserName={session.user.name}
      />
    </div>
  );
}
