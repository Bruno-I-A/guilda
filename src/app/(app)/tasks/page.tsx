import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { Inbox, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";

import { PageHeader } from "@/components/page-header";
import { SegmentedNav } from "@/components/segmented-nav";
import { Button } from "@/components/ui/button";
import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import {
  defaultMissionScope,
  groupInformativePackages,
  OPEN_STATUSES,
  parseInformativeKind,
  parseMissionScope,
  parseMissionView,
  type InformativePackage,
  type InformativeSummary,
  type MissionView,
} from "@/domain/mission-triage";
import type { TaskStatus } from "@/domain/task-state";
import { requireOrgSession } from "@/lib/session";

import { InformativeView } from "./informative-view";
import type { MissionDelivery, MissionListRow } from "./mission-list-types";
import { MissionScopeSelect } from "./mission-scope-select";
import { StandaloneView } from "./standalone-view";

export const metadata: Metadata = { title: "Missões" };

/** Só o que o cabeçalho do pacote precisa da prévia persistida (JSONB). */
const packageSummarySchema = z.object({
  kind: z.string().optional(),
  company: z
    .object({ legalName: z.string().nullable().optional() })
    .optional(),
});

const VIEW_COPY: Record<MissionView, { description: string }> = {
  standalone: {
    description:
      "Pedidos entre pessoas: o que é seu para fazer, o que espera a sua aprovação e o que você pediu.",
  },
  informative: {
    description:
      "Pacotes por empresa, nascidos dos Informativos confirmados. Cada pacote mostra quanto falta.",
  },
};

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Sem o `with`, o Drizzle devolve só as colunas; com ele, as relações. O
 * tipo é inferido do uso, então esta função só existe para converter o
 * resultado numa linha que as visões entendem.
 */
function toRow(task: {
  id: string;
  title: string;
  status: TaskStatus;
  creatorId: string;
  assigneeId: string | null;
  dueDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  xpValue: number;
  priority: number;
  difficulty: number;
  informativeId: string | null;
  clan: { name: string } | null;
  client: { name: string } | null;
  assignee: { name: string } | null;
  creator: { name: string } | null;
}): MissionListRow {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    creatorId: task.creatorId,
    assigneeId: task.assigneeId,
    dueDate: task.dueDate,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
    xpValue: task.xpValue,
    priority: task.priority,
    difficulty: task.difficulty,
    informativeId: task.informativeId,
    clanName: task.clan?.name ?? null,
    clientName: task.client?.name ?? null,
    assigneeName: task.assignee?.name ?? null,
    creatorName: task.creator?.name ?? null,
  };
}

const ROW_RELATIONS = {
  assignee: { columns: { name: true } },
  creator: { columns: { name: true } },
  clan: { columns: { name: true } },
  client: { columns: { name: true } },
} as const;

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string | string[];
    scope?: string | string[];
    clan?: string | string[];
    person?: string | string[];
    /** Filtro de origem de uma versão anterior — aceito como sinônimo de `view`. */
    origin?: string | string[];
  }>;
}) {
  const session = await requireOrgSession();
  const params = await searchParams;
  const view = parseMissionView(single(params.view), single(params.origin));
  const now = new Date();

  const { clans, members, myClanIds } = await withOrgTx(
    session.orgId,
    async (tx) => {
      const [clanRows, memberRows, myMemberships] = await Promise.all([
        tx
          .select({ id: schema.clans.id, name: schema.clans.name })
          .from(schema.clans)
          .where(and(eq(schema.clans.orgId, session.orgId), eq(schema.clans.active, true)))
          .orderBy(asc(schema.clans.name)),
        tx
          .select({ userId: schema.member.userId, name: schema.user.name })
          .from(schema.member)
          .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
          .where(eq(schema.member.organizationId, session.orgId))
          .orderBy(asc(schema.user.name)),
        tx
          .select({ clanId: schema.clanMemberships.clanId })
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
              eq(schema.clans.orgId, session.orgId),
              eq(schema.clans.active, true),
            ),
          ),
      ]);
      return {
        clans: clanRows,
        members: memberRows,
        myClanIds: myMemberships.map((membership) => membership.clanId),
      };
    },
  );

  const scope = parseMissionScope(
    single(params.scope),
    defaultMissionScope(view, myClanIds.length > 0),
  );
  const requestedClanId = single(params.clan);
  const clanId = clans.some((clan) => clan.id === requestedClanId)
    ? requestedClanId
    : undefined;
  const requestedPersonId = single(params.person);
  const personId = members.some((member) => member.userId === requestedPersonId)
    ? requestedPersonId
    : undefined;

  // O recorte atual vai no `returnTo` da missão: quem abre uma linha volta
  // exatamente para onde estava, e não para a lista padrão.
  const filters = new URLSearchParams();
  if (view !== "standalone") filters.set("view", view);
  if (single(params.scope)) filters.set("scope", scope);
  if (scope === "clan" && clanId) filters.set("clan", clanId);
  if (scope === "person" && personId) filters.set("person", personId);
  const currentHref = filters.size > 0 ? `/tasks?${filters}` : "/tasks";
  const taskHref = (taskId: string) =>
    `/tasks/${taskId}?returnTo=${encodeURIComponent(currentHref)}`;

  const conditions: SQL[] = [eq(schema.tasks.orgId, session.orgId)];
  if (scope === "mine") {
    // Na visão pessoal das avulsas, "minhas" inclui as que eu PEDI: sem
    // isso a seção "Você pediu" e a de aprovação não teriam o que mostrar.
    // No Informativo o pedido é do pacote, não meu — vale só o que é meu.
    conditions.push(
      view === "standalone"
        ? or(
            eq(schema.tasks.assigneeId, session.user.id),
            eq(schema.tasks.creatorId, session.user.id),
          )!
        : eq(schema.tasks.assigneeId, session.user.id),
    );
  } else if (scope === "my_clans") {
    conditions.push(
      myClanIds.length > 0
        ? inArray(schema.tasks.clanId, myClanIds)
        : sql<boolean>`false`,
    );
  } else if (scope === "clan") {
    conditions.push(clanId ? eq(schema.tasks.clanId, clanId) : sql<boolean>`false`);
  } else if (scope === "person") {
    conditions.push(
      personId ? eq(schema.tasks.assigneeId, personId) : sql<boolean>`false`,
    );
  }

  let standalone: {
    open: MissionListRow[];
    closed: MissionListRow[];
    deliveries: Map<string, MissionDelivery>;
  } | null = null;
  let packages: InformativePackage<MissionListRow>[] = [];

  if (view === "standalone") {
    standalone = await withOrgTx(session.orgId, async (tx) => {
      const [open, closed] = await Promise.all([
        tx.query.tasks.findMany({
          where: and(
            ...conditions,
            isNull(schema.tasks.informativeId),
            inArray(schema.tasks.status, [...OPEN_STATUSES]),
          ),
          with: ROW_RELATIONS,
          orderBy: [desc(schema.tasks.createdAt)],
          limit: 300,
        }),
        // Encerradas são histórico: só as últimas, para a página não crescer
        // com o passado inteiro da Guilda.
        tx.query.tasks.findMany({
          where: and(
            ...conditions,
            isNull(schema.tasks.informativeId),
            inArray(schema.tasks.status, ["completed", "cancelled"]),
          ),
          with: ROW_RELATIONS,
          orderBy: [desc(schema.tasks.updatedAt)],
          limit: 30,
        }),
      ]);

      // O retorno escrito de cada entrega que espera a aprovação de quem lê:
      // é o dado que decide "aprovo daqui mesmo ou preciso abrir".
      const awaitingMine = open
        .filter(
          (task) =>
            task.status === "awaiting_approval" &&
            task.creatorId === session.user.id &&
            task.assigneeId !== session.user.id,
        )
        .map((task) => task.id);
      const deliveries = new Map<string, MissionDelivery>();
      if (awaitingMine.length > 0) {
        const events = await tx
          .select({
            taskId: schema.taskEvents.taskId,
            note: schema.taskEvents.note,
            createdAt: schema.taskEvents.createdAt,
            actorName: schema.user.name,
          })
          .from(schema.taskEvents)
          .innerJoin(schema.user, eq(schema.user.id, schema.taskEvents.actorId))
          .where(
            and(
              eq(schema.taskEvents.orgId, session.orgId),
              inArray(schema.taskEvents.taskId, awaitingMine),
              eq(schema.taskEvents.toStatus, "awaiting_approval"),
            ),
          )
          .orderBy(desc(schema.taskEvents.createdAt));
        for (const event of events) {
          if (!deliveries.has(event.taskId)) {
            deliveries.set(event.taskId, {
              note: event.note,
              actorName: event.actorName,
              at: event.createdAt,
            });
          }
        }
      }

      return { open: open.map(toRow), closed: closed.map(toRow), deliveries };
    });
  } else {
    packages = await withOrgTx(session.orgId, async (tx) => {
      const rows = await tx.query.tasks.findMany({
        where: and(...conditions, isNotNull(schema.tasks.informativeId)),
        with: ROW_RELATIONS,
        orderBy: [desc(schema.tasks.createdAt)],
        limit: 500,
      });
      const informativeIds = [
        ...new Set(
          rows
            .map((row) => row.informativeId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      if (informativeIds.length === 0) return [];

      const [informativeRows, statusRows] = await Promise.all([
        tx
          .select({
            id: schema.informatives.id,
            payload: schema.informatives.payload,
            createdAt: schema.informatives.createdAt,
          })
          .from(schema.informatives)
          .where(
            and(
              eq(schema.informatives.orgId, session.orgId),
              inArray(schema.informatives.id, informativeIds),
            ),
          ),
        // O progresso é do pacote INTEIRO, inclusive das missões que o
        // recorte atual não mostra: "3 de 7" precisa ser o 7 de verdade.
        tx
          .select({
            informativeId: schema.tasks.informativeId,
            status: schema.tasks.status,
          })
          .from(schema.tasks)
          .where(
            and(
              eq(schema.tasks.orgId, session.orgId),
              inArray(schema.tasks.informativeId, informativeIds),
            ),
          ),
      ]);

      const summaries = new Map<string, Omit<InformativeSummary, "id">>();
      for (const informative of informativeRows) {
        const parsed = packageSummarySchema.safeParse(informative.payload);
        summaries.set(informative.id, {
          kind: parseInformativeKind(parsed.success ? parsed.data.kind : undefined),
          companyName: parsed.success ? (parsed.data.company?.legalName ?? null) : null,
          createdAt: informative.createdAt,
        });
      }
      const statuses = new Map<string, TaskStatus[]>();
      for (const row of statusRows) {
        if (!row.informativeId) continue;
        const list = statuses.get(row.informativeId) ?? [];
        list.push(row.status);
        statuses.set(row.informativeId, list);
      }

      return groupInformativePackages(rows.map(toRow), summaries, statuses, now);
    });
  }

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Missões"
        description={VIEW_COPY[view].description}
        action={
          view === "standalone" ? (
            <Button asChild>
              <Link href="/tasks/new">
                <Plus aria-hidden /> Nova missão
              </Link>
            </Button>
          ) : (
            <Button asChild variant="outline">
              <Link href="/informativos">
                <Inbox aria-hidden /> Novo informativo
              </Link>
            </Button>
          )
        }
      />

      <div className="grid gap-3">
        <SegmentedNav
          label="Origem das missões"
          active={view}
          items={[
            { key: "standalone", label: "Avulsas", href: "/tasks" },
            { key: "informative", label: "Informativos", href: "/tasks?view=informative" },
          ]}
        />
        <MissionScopeSelect
          scope={scope}
          clans={clans}
          members={members}
          clanId={clanId}
          personId={personId}
        />
      </div>

      {standalone ? (
        <StandaloneView
          scope={scope}
          viewerId={session.user.id}
          open={standalone.open}
          closed={standalone.closed}
          deliveries={standalone.deliveries}
          now={now}
          taskHref={taskHref}
        />
      ) : (
        <InformativeView packages={packages} now={now} taskHref={taskHref} />
      )}
    </div>
  );
}
