import { and, count, eq, inArray } from "drizzle-orm";
import { ListTodo, Trophy, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { db } from "@/db";
import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { requireOrgSession } from "@/lib/session";

export const metadata: Metadata = { title: "Início" };

export default async function DashboardPage() {
  const session = await requireOrgSession();

  const [{ memberCount }] = await db
    .select({ memberCount: count() })
    .from(schema.member)
    .where(eq(schema.member.organizationId, session.orgId));

  const { myOpenCount, awaitingCount } = await withOrgTx(
    session.orgId,
    async (tx) => {
      const [mine] = await tx
        .select({ value: count() })
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.orgId, session.orgId),
            eq(schema.tasks.assigneeId, session.user.id),
            inArray(schema.tasks.status, ["pending", "in_progress", "rejected"]),
          ),
        );
      const [awaiting] = await tx
        .select({ value: count() })
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.orgId, session.orgId),
            eq(schema.tasks.status, "awaiting_approval"),
          ),
        );
      return { myOpenCount: mine.value, awaitingCount: awaiting.value };
    },
  );

  const firstName = session.user.name.split(" ")[0];

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Olá, {firstName} 👋
        </h1>
        <p className="text-muted-foreground">
          Bem-vindo(a) à sua guilda. Conclua tarefas, ganhe XP e suba no ranking.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="size-4 text-muted-foreground" aria-hidden />
              Membros
            </CardTitle>
            <CardDescription>Pessoas na organização</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{memberCount}</p>
            <Link
              href="/members"
              className="text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              Gerenciar membros →
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ListTodo className="size-4 text-muted-foreground" aria-hidden />
              Tarefas
            </CardTitle>
            <CardDescription>
              {awaitingCount > 0
                ? `${awaitingCount} aguardando aprovação na org`
                : "Organize o trabalho da equipe"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{myOpenCount}</p>
            <p className="text-sm text-muted-foreground">abertas com você</p>
            <Link
              href="/tasks"
              className="text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              Ver tarefas →
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Trophy className="size-4 text-muted-foreground" aria-hidden />
              Ranking
            </CardTitle>
            <CardDescription>Quem está pontuando mais</CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/leaderboard"
              className="text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              Ver ranking →
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
