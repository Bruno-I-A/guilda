import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNull,
  ne,
  notInArray,
  or,
} from "drizzle-orm";
import { ChevronRight, ShieldCheck, Star } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { LevelEmblem } from "@/components/level-emblem";
import { MissionRow } from "@/components/mission-row";
import { PageHeader } from "@/components/page-header";
import { XpBar } from "@/components/xp-bar";
import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { levelProgress } from "@/domain/xp";
import { getActiveMember, requireOrgSession } from "@/lib/session";
import { getUserXpTotal } from "@/lib/xp-queries";

export const metadata: Metadata = { title: "Início" };

/**
 * Etiqueta de missão sem dono no clã — "pode ser sua".
 *
 * Era o único `rounded-full` de um app cuja premissa é canto chanfrado, e
 * reimplementava `.hud-label` na unha com `text-[10px]`. Agora usa o degrau
 * HUD da escala e o mesmo corte em 45° do `chip-loot`, só que em azul-gelo:
 * é convite, não recompensa — ouro continua reservado ao XP.
 */
function AvailableTag() {
  return (
    <span
      className="shrink-0 border border-primary/35 bg-primary/10 px-2 py-0.5 font-mono text-hud font-semibold uppercase tracking-hud text-primary"
      style={{
        clipPath:
          "polygon(0.3rem 0, 100% 0, 100% calc(100% - 0.3rem), calc(100% - 0.3rem) 100%, 0 100%, 0 0.3rem)",
      }}
    >
      Disponível
    </span>
  );
}

export default async function DashboardPage() {
  const session = await requireOrgSession();
  const member = await getActiveMember();
  if (!member) {
    redirect("/onboarding");
  }
  const { memberCount, myTasks, clanTasks, hasClanLeadership } = await withOrgTx(
    session.orgId,
    async (tx) => {
      const memberships = await tx
        .select({
          clanId: schema.clanMemberships.clanId,
          isLeader: schema.clanMemberships.isLeader,
        })
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
        );
      const clanIds = memberships.map((membership) => membership.clanId);

      const [guildStats] = await tx
        .select({ memberCount: count() })
        .from(schema.member)
        .where(eq(schema.member.organizationId, session.orgId));
      const mine = await tx.query.tasks.findMany({
        where: and(
          eq(schema.tasks.orgId, session.orgId),
          eq(schema.tasks.assigneeId, session.user.id),
          notInArray(schema.tasks.status, ["completed", "cancelled"]),
        ),
        columns: {
          id: true,
          title: true,
          status: true,
          dueDate: true,
          xpValue: true,
        },
        orderBy: [desc(schema.tasks.createdAt)],
        limit: 50,
      });
      // Ternario com await precisa do await DENTRO do ramo: `await a ? b : c`
      // seria lido como `(await a) ? b : c` e devolveria a query sem executar.
      const clans = clanIds.length
        ? await tx.query.tasks.findMany({
            where: and(
              eq(schema.tasks.orgId, session.orgId),
              inArray(schema.tasks.clanId, clanIds),
              notInArray(schema.tasks.status, ["completed", "cancelled"]),
              or(
                isNull(schema.tasks.assigneeId),
                ne(schema.tasks.assigneeId, session.user.id),
              ),
            ),
            columns: {
              id: true,
              title: true,
              status: true,
              dueDate: true,
              xpValue: true,
              assigneeId: true,
            },
            with: {
              assignee: { columns: { name: true } },
              clan: { columns: { name: true } },
            },
            orderBy: [desc(schema.tasks.createdAt)],
            limit: 50,
          })
        : [];

      return {
        memberCount: guildStats?.memberCount ?? 0,
        myTasks: mine,
        clanTasks: clans,
        hasClanLeadership: memberships.some((membership) => membership.isLeader),
      };
    },
  );

  // Atrasadas primeiro, depois prazo mais próximo; sem prazo por último.
  const sortedMine = myTasks
    .sort((a, b) => {
      const aDue = a.dueDate?.getTime() ?? Infinity;
      const bDue = b.dueDate?.getTime() ?? Infinity;
      return aDue - bDue;
    })
    .slice(0, 6);
  const sortedClanTasks = clanTasks
    .sort((a, b) => {
      if (a.assigneeId === null && b.assigneeId !== null) return -1;
      if (a.assigneeId !== null && b.assigneeId === null) return 1;
      const aDue = a.dueDate?.getTime() ?? Infinity;
      const bDue = b.dueDate?.getTime() ?? Infinity;
      return aDue - bDue;
    })
    .slice(0, 6);

  const totalXp = await getUserXpTotal(session.orgId, session.user.id);
  const progress = levelProgress(totalXp);
  const firstName = session.user.name.split(" ")[0];

  return (
    <div className="grid gap-6">
      <PageHeader
        title={`Olá, ${firstName}`}
        description="Conclua missões, ganhe XP e suba no ranking da guilda."
      />

      {/* Banner de status: emblema + progressão + stats da guilda */}
      <section className="panel-cut texture-iron flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:gap-6 sm:p-6">
        <LevelEmblem level={progress.level} />
        <div className="min-w-0 flex-1 grid gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="hud-label">
              Nível {progress.level} · faltam{" "}
              {progress.nextLevelXp - progress.totalXp} XP para o nível{" "}
              {progress.level + 1}
            </span>
            <span className="font-mono text-xs text-gold">
              <Star className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />
              {totalXp} XP no total
            </span>
          </div>
          <XpBar
            current={progress.totalXp - progress.currentLevelXp}
            target={progress.nextLevelXp - progress.currentLevelXp}
            label={`Progresso para o nível ${progress.level + 1}`}
          />
          <div className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs text-muted-foreground">
            <Link href="/members" className="hover:text-foreground">
              {memberCount} na guilda
            </Link>
            <Link href="/tasks" className="hover:text-foreground">
              {sortedMine.length > 0 ? `${myTasks.length} abertas com você` : "nenhuma missão aberta"}
            </Link>
            <Link href="/leaderboard" className="hover:text-foreground">
              ver ranking →
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-3">
        <div className="flex items-center gap-3">
          <h2>Suas missões</h2>
          <div className="divider-rune flex-1" />
          <Link
            href="/tasks"
            className="font-mono text-xs text-muted-foreground hover:text-foreground"
          >
            ver todas →
          </Link>
        </div>
        {sortedMine.length === 0 ? (
          <div className="panel-cut flex flex-col items-center gap-2 p-8 text-center">
            <p className="font-medium">Nenhuma missão em aberto</p>
            <p className="text-sm text-muted-foreground">
              Crie uma missão ou aguarde uma atribuição da guilda.
            </p>
            <Link
              href="/tasks/new"
              className="mt-1 font-mono text-xs text-primary hover:underline"
            >
              + nova missão
            </Link>
          </div>
        ) : (
          <ul className="grid gap-1.5">
            {sortedMine.map((task) => (
              <li key={task.id}>
                {/* Aqui o status importa (é o que diz se já comecei); clã e
                    responsável são redundantes — a missão é minha. */}
                <MissionRow task={task} variant="compact" />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-3">
        <div className="flex items-center gap-3">
          <ShieldCheck className="size-4 text-primary" aria-hidden />
          <h2>Missões dos seus clãs</h2>
          <div className="divider-rune flex-1" />
          <Link
            href="/tasks?scope=my_clans"
            className="font-mono text-xs text-muted-foreground hover:text-foreground"
          >
            {hasClanLeadership ? "ver carga do clã →" : "ver todas →"}
          </Link>
        </div>
        {sortedClanTasks.length === 0 ? (
          <div className="panel-cut flex flex-col items-center gap-2 p-8 text-center">
            <p className="font-medium">Nenhuma missão aberta nos seus clãs</p>
            <p className="text-sm text-muted-foreground">
              As missões disponíveis para o clã aparecerão aqui.
            </p>
          </div>
        ) : (
          <ul className="grid gap-1.5">
            {sortedClanTasks.map((task) => (
              <li key={task.id}>
                {/* Sem status: aqui o que decide é DE QUEM é a missão, e o
                    trilho da esquerda já dá o estado sem gastar texto. */}
                <MissionRow
                  task={{
                    ...task,
                    clanName: task.clan?.name ?? "Clã",
                    assigneeName: task.assignee?.name ?? "Disponível no clã",
                  }}
                  variant="compact"
                  showStatus={false}
                  trailing={
                    task.assigneeId === null ? <AvailableTag /> : null
                  }
                  after={
                    <ChevronRight
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
