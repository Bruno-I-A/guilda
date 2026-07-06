import { and, count, desc, eq, inArray } from "drizzle-orm";
import { CalendarClock, ChevronRight, ShieldCheck, Star } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { LevelEmblem } from "@/components/level-emblem";
import { XpBar } from "@/components/xp-bar";
import { db } from "@/db";
import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { levelProgress } from "@/domain/xp";
import { getActiveMember, requireOrgSession } from "@/lib/session";
import {
  formatDueDate,
  isOverdue,
  STATUS_LABELS,
  STATUS_RAIL_CLASSES,
} from "@/lib/task-ui";
import { getUserXpTotal } from "@/lib/xp-queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Início" };

export default async function DashboardPage() {
  const session = await requireOrgSession();
  const member = await getActiveMember();
  if (!member) {
    redirect("/onboarding");
  }
  const isAdmin = member.role === "owner" || member.role === "admin";

  const [{ memberCount }] = await db
    .select({ memberCount: count() })
    .from(schema.member)
    .where(eq(schema.member.organizationId, session.orgId));

  const { myTasks, awaitingMine } = await withOrgTx(session.orgId, async (tx) => {
    const mine = await tx.query.tasks.findMany({
      where: and(
        eq(schema.tasks.orgId, session.orgId),
        eq(schema.tasks.assigneeId, session.user.id),
        inArray(schema.tasks.status, ["pending", "in_progress", "rejected"]),
      ),
      columns: { id: true, title: true, status: true, dueDate: true, xpValue: true },
      orderBy: [desc(schema.tasks.createdAt)],
      limit: 50,
    });
    const awaiting = await tx.query.tasks.findMany({
      where: and(
        eq(schema.tasks.orgId, session.orgId),
        eq(schema.tasks.status, "awaiting_approval"),
        ...(isAdmin ? [] : [eq(schema.tasks.creatorId, session.user.id)]),
      ),
      columns: { id: true, title: true, xpValue: true },
      with: { assignee: { columns: { name: true } } },
      orderBy: [desc(schema.tasks.updatedAt)],
      limit: 5,
    });
    return { myTasks: mine, awaitingMine: awaiting };
  });

  // Atrasadas primeiro, depois prazo mais próximo; sem prazo por último.
  const sortedMine = myTasks
    .sort((a, b) => {
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
      <div>
        <h1 className="text-2xl font-semibold tracking-wide">Olá, {firstName}</h1>
        <p className="text-muted-foreground">
          Conclua missões, ganhe XP e suba no ranking da guilda.
        </p>
      </div>

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

      {awaitingMine.length > 0 ? (
        <section className="grid gap-3">
          <div className="flex items-center gap-3">
            <ShieldCheck className="size-4 text-amber-300" aria-hidden />
            <h2 className="hud-label !text-amber-300">Aguardando sua aprovação</h2>
            <div className="divider-rune flex-1" />
          </div>
          <ul className="grid gap-1.5">
            {awaitingMine.map((task) => (
              <li key={task.id}>
                <Link
                  href={`/tasks/${task.id}`}
                  className="panel-cut panel-cut-sm flex items-center gap-3 border-l-2 border-l-amber-400/70 px-4 py-2.5 transition-colors hover:bg-accent/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{task.title}</p>
                    <p className="text-xs text-muted-foreground">
                      entregue por {task.assignee.name}
                    </p>
                  </div>
                  <span className="chip-loot">
                    <Star className="size-3" aria-hidden /> {task.xpValue} XP
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="grid gap-3">
        <div className="flex items-center gap-3">
          <h2 className="hud-label">Suas missões</h2>
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
            {sortedMine.map((task) => {
              const overdue = isOverdue(task.dueDate, task.status);
              return (
                <li key={task.id}>
                  <Link
                    href={`/tasks/${task.id}`}
                    className={cn(
                      "panel-cut panel-cut-sm flex items-center gap-3 border-l-2 px-4 py-2.5 transition-colors hover:bg-accent/40",
                      overdue
                        ? "border-l-destructive"
                        : STATUS_RAIL_CLASSES[task.status],
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{task.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {STATUS_LABELS[task.status]}
                        {task.dueDate ? (
                          <span className={cn(overdue && "font-medium text-destructive")}>
                            {" · "}
                            <CalendarClock
                              className="inline size-3 align-[-1.5px]"
                              aria-hidden
                            />{" "}
                            {overdue ? "atrasada · " : ""}
                            {formatDueDate(task.dueDate)}
                          </span>
                        ) : null}
                      </p>
                    </div>
                    <span className="chip-loot">
                      <Star className="size-3" aria-hidden /> {task.xpValue} XP
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
