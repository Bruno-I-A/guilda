import { and, asc, eq, inArray } from "drizzle-orm";
import { Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { SegmentedNav } from "@/components/segmented-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { canEmphasizeNotice, canSeeNoticeAcknowledgements } from "@/domain/guild-permissions";
import { noticeWorkState, type MuralSection, type MyNoticeTask } from "@/domain/mural-work";
import type { OrgRole } from "@/domain/task-state";
import { getActiveMember, requireOrgSession } from "@/lib/session";

import { NoticeBoard, type NoticeView } from "./notice-board";

export const metadata: Metadata = { title: "Mural" };

const PAGE_SIZE = 24;
const SECTIONS: MuralSection[] = ["mine", "team", "resolved", "archived"];

function href(section: MuralSection, query: string, page = 1): string {
  const params = new URLSearchParams();
  if (section !== "mine") params.set("aba", section);
  if (query) params.set("q", query);
  if (page > 1) params.set("pagina", String(page));
  const suffix = params.toString();
  return suffix ? `/mural?${suffix}` : "/mural";
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
}

export default async function MuralPage({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string; q?: string; pagina?: string; arquivados?: string }>;
}) {
  const params = await searchParams;
  const section: MuralSection = SECTIONS.includes(params.aba as MuralSection)
    ? params.aba as MuralSection
    : params.arquivados === "1" ? "archived" : "mine";
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const requestedPage = typeof params.pagina === "string" && /^\d+$/.test(params.pagina)
    ? Math.max(1, Math.min(Number(params.pagina), 1_000_000))
    : 1;
  const session = await requireOrgSession();
  const viewer = await getActiveMember();
  if (!viewer) redirect("/onboarding");
  const role = viewer.role as OrgRole;

  const data = await withOrgTx(session.orgId, async (tx) => {
    // Classifica o conjunto inteiro com metadados leves; carrega corpos,
    // leituras e detalhes das missões somente para a página selecionada.
    const indexRows = await tx.query.guildNotices.findMany({
      where: eq(schema.guildNotices.orgId, session.orgId),
      columns: { id: true, title: true, informativeId: true, archivedAt: true, pinned: true, publishedAt: true },
      with: { client: { columns: { name: true } } },
    });
    const informativeIds = [...new Set(indexRows
      .map((notice) => notice.informativeId)
      .filter((id): id is string => Boolean(id)))];
    const myTasks = informativeIds.length > 0
      ? await tx
          .select({ informativeId: schema.tasks.informativeId, status: schema.tasks.status, updatedAt: schema.tasks.updatedAt })
          .from(schema.tasks)
          .where(and(
            eq(schema.tasks.orgId, session.orgId),
            eq(schema.tasks.assigneeId, session.user.id),
            inArray(schema.tasks.informativeId, informativeIds),
          ))
      : [];
    const workRows = await tx
      .select({ noticeId: schema.guildNoticeWork.noticeId, resolvedAt: schema.guildNoticeWork.resolvedAt })
      .from(schema.guildNoticeWork)
      .where(and(
        eq(schema.guildNoticeWork.orgId, session.orgId),
        eq(schema.guildNoticeWork.userId, session.user.id),
      ));
    const tasksByInformative = new Map<string, MyNoticeTask[]>();
    for (const task of myTasks) {
      if (!task.informativeId) continue;
      const existing = tasksByInformative.get(task.informativeId) ?? [];
      existing.push(task);
      tasksByInformative.set(task.informativeId, existing);
    }
    const resolvedByNotice = new Map(workRows.map((row) => [row.noticeId, row.resolvedAt]));
    const stateByNotice = new Map(indexRows.map((notice) => [
      notice.id,
      noticeWorkState({
        archived: notice.archivedAt !== null,
        tasks: notice.informativeId ? tasksByInformative.get(notice.informativeId) ?? [] : [],
        resolvedAt: resolvedByNotice.get(notice.id) ?? null,
      }),
    ]));
    const term = normalize(query);
    const searched = term
      ? indexRows.filter((notice) => normalize(`${notice.title} ${notice.client?.name ?? ""}`).includes(term))
      : indexRows;
    const counts = Object.fromEntries(SECTIONS.map((key) => [
      key,
      searched.filter((notice) => stateByNotice.get(notice.id)?.section === key).length,
    ])) as Record<MuralSection, number>;
    const selected = searched
      .filter((notice) => stateByNotice.get(notice.id)?.section === section)
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) ||
        b.publishedAt.getTime() - a.publishedAt.getTime());
    const totalPages = Math.max(1, Math.ceil(selected.length / PAGE_SIZE));
    const page = Math.min(requestedPage, totalPages);
    const pageIds = selected.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((notice) => notice.id);
    const noticeRows = pageIds.length > 0
      ? await tx.query.guildNotices.findMany({
          where: and(eq(schema.guildNotices.orgId, session.orgId), inArray(schema.guildNotices.id, pageIds)),
          with: {
            author: { columns: { id: true, name: true } },
            client: { columns: { id: true, name: true } },
            reads: { columns: { userId: true } },
          },
        })
      : [];
    const pageInformativeIds = [...new Set(noticeRows
      .map((notice) => notice.informativeId)
      .filter((id): id is string => Boolean(id)))];
    const missionRows = pageInformativeIds.length > 0
      ? await tx.query.tasks.findMany({
          where: and(eq(schema.tasks.orgId, session.orgId), inArray(schema.tasks.informativeId, pageInformativeIds)),
          with: { clan: { columns: { name: true } }, assignee: { columns: { name: true } } },
          orderBy: [asc(schema.tasks.createdAt)],
        })
      : [];
    const memberRows = await tx
      .select({ userId: schema.member.userId, name: schema.user.name })
      .from(schema.member)
      .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
      .where(eq(schema.member.organizationId, session.orgId))
      .orderBy(asc(schema.user.name));
    const leadership = await tx
      .select({ id: schema.clanMemberships.id })
      .from(schema.clanMemberships)
      .innerJoin(schema.clans, and(
        eq(schema.clans.id, schema.clanMemberships.clanId),
        eq(schema.clans.orgId, schema.clanMemberships.orgId),
      ))
      .where(and(
        eq(schema.clanMemberships.orgId, session.orgId),
        eq(schema.clanMemberships.userId, session.user.id),
        eq(schema.clanMemberships.isLeader, true),
        eq(schema.clans.active, true),
      ))
      .limit(1);

    return { noticeRows, missionRows, memberRows, leadsAnyClan: leadership.length > 0,
      stateByNotice, counts, page, totalPages, pageIds };
  });

  const facts = { role, leadsAnyClan: data.leadsAnyClan };
  const nameByUserId = new Map(data.memberRows.map((member) => [member.userId, member.name]));
  const noticeById = new Map(data.noticeRows.map((notice) => [notice.id, notice]));
  const tasksByInformative = new Map<string, typeof data.missionRows>();
  for (const task of data.missionRows) {
    if (!task.informativeId) continue;
    const current = tasksByInformative.get(task.informativeId) ?? [];
    current.push(task);
    tasksByInformative.set(task.informativeId, current);
  }
  const views: NoticeView[] = data.pageIds.flatMap((id) => {
    const notice = noticeById.get(id);
    if (!notice) return [];
    const readerIds = new Set(notice.reads.map((read) => read.userId));
    const canSeeAcks = canSeeNoticeAcknowledgements({ ...facts, isAuthor: notice.authorId === session.user.id });
    const pendingNames = data.memberRows
      .filter((member) => !readerIds.has(member.userId))
      .map((member) => member.name);
    const missionTasks = notice.informativeId
      ? tasksByInformative.get(notice.informativeId) ?? [] : [];
    const work = data.stateByNotice.get(id)!;
    return [{
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
      ackCount: data.memberRows.length - pendingNames.length,
      totalMembers: data.memberRows.length,
      pendingNames: canSeeAcks ? pendingNames : [],
      work: { section: work.section, total: work.total, closed: work.closed },
      missionSummary: notice.informativeId ? {
        total: missionTasks.length,
        completed: missionTasks.filter((task) => task.status === "completed").length,
        cancelled: missionTasks.filter((task) => task.status === "cancelled").length,
        unassigned: missionTasks.filter((task) => !task.assigneeId &&
          task.status !== "completed" && task.status !== "cancelled").length,
        items: missionTasks.map((task) => ({
          id: task.id,
          title: task.title,
          status: task.status,
          clanName: task.clan?.name ?? null,
          assigneeName: task.assignee?.name ?? null,
          isMine: task.assigneeId === session.user.id,
        })),
      } : null,
    }];
  });
  const tabs = [
    { key: "mine", label: `Para mim · ${data.counts.mine}`, href: href("mine", query) },
    { key: "team", label: `Acompanhar equipe · ${data.counts.team}`, shortLabel: `Equipe · ${data.counts.team}`, href: href("team", query) },
    { key: "resolved", label: `Resolvidos · ${data.counts.resolved}`, href: href("resolved", query) },
    { key: "archived", label: `Arquivados · ${data.counts.archived}`, href: href("archived", query) },
  ];
  const returnTo = href(section, query, data.page);

  return (
    <div className="grid gap-5">
      <PageHeader title="Mural" description="Acompanhe os Informativos por responsável. Confirme sua parte depois de encerrar suas missões; a leitura é uma confirmação separada." />
      <SegmentedNav
        items={tabs}
        active={section}
        label="Filas do Mural"
        className="grid grid-cols-2 gap-0 overflow-x-visible sm:flex sm:gap-1 sm:overflow-x-auto"
      />
      <form action="/mural" method="get" className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="aba" value={section} />
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input key={query} name="q" defaultValue={query} maxLength={100} placeholder="Buscar por empresa ou título" aria-label="Buscar por empresa ou título" className="pl-9" />
        </div>
        <Button type="submit" variant="outline">Buscar</Button>
        {query ? <Button asChild variant="ghost"><Link href={href(section, "")}>Limpar</Link></Button> : null}
      </form>
      <NoticeBoard notices={views} canEmphasize={canEmphasizeNotice(facts)} section={section} returnTo={returnTo} teamCount={data.counts.team} hasSearch={Boolean(query)} />
      {data.totalPages > 1 ? (
        <nav aria-label="Páginas do Mural" className="flex items-center justify-between gap-3 text-sm">
          {data.page > 1 ? <Button asChild variant="outline"><Link href={href(section, query, data.page - 1)}>Anterior</Link></Button> : <span />}
          <span className="font-mono text-xs text-muted-foreground">{data.page} de {data.totalPages}</span>
          {data.page < data.totalPages ? <Button asChild variant="outline"><Link href={href(section, query, data.page + 1)}>Próxima</Link></Button> : <span />}
        </nav>
      ) : null}
    </div>
  );
}
