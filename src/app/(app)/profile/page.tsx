import { TrendingDown, TrendingUp } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Constellation } from "@/components/constellation";
import { XpBar } from "@/components/xp-bar";
import { levelProgress } from "@/domain/xp";
import { initials, ROLE_LABELS } from "@/lib/people";
import { getActiveMember, requireOrgSession } from "@/lib/session";
import { formatDateTime } from "@/lib/task-ui";
import {
  countCompletedTasks,
  getUserXpTotal,
  getXpHistory,
} from "@/lib/xp-queries";

export const metadata: Metadata = { title: "Perfil" };

const REASON_LABELS: Record<string, string> = {
  task_completed: "Missão aprovada",
  closing_year_closed: "Fechamento anual",
  reversal: "Conclusão revertida",
  bonus: "Bônus",
};

export default async function ProfilePage() {
  const session = await requireOrgSession();
  const member = await getActiveMember();
  if (!member) {
    redirect("/onboarding");
  }

  const [totalXp, completedCount, history] = await Promise.all([
    getUserXpTotal(session.orgId, session.user.id),
    countCompletedTasks(session.orgId, session.user.id),
    getXpHistory(session.orgId, session.user.id),
  ]);
  const progress = levelProgress(totalXp);
  const xpIntoLevel = progress.totalXp - progress.currentLevelXp;
  const xpLevelSpan = progress.nextLevelXp - progress.currentLevelXp;

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold tracking-wide">Perfil</h1>

      <div className="flex items-center gap-3">
        <Avatar className="size-10">
          <AvatarFallback>{initials(session.user.name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{session.user.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {session.user.email}
          </p>
        </div>
        <Badge variant="secondary">{ROLE_LABELS[member.role] ?? member.role}</Badge>
      </div>

      {/* Vitrine: a constelação de progressão é a peça central do perfil */}
      <section className="panel-cut texture-iron grid gap-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="hud-label">Constelação de progressão</h2>
          <span className="font-mono text-xs text-gold">
            {totalXp.toLocaleString("pt-BR")} XP no total
          </span>
        </div>
        <Constellation totalXp={totalXp} />
        <XpBar
          current={xpIntoLevel}
          target={xpLevelSpan}
          label={`Progresso para o nível ${progress.level + 1}`}
        />
        <p className="font-mono text-xs text-muted-foreground">
          nível {progress.level} · faltam{" "}
          {(progress.nextLevelXp - progress.totalXp).toLocaleString("pt-BR")} XP
          para o nível {progress.level + 1} · {completedCount}{" "}
          {completedCount === 1 ? "entrega aprovada" : "entregas aprovadas"}
        </p>
      </section>

      <Card className="panel-cut">
        <CardHeader>
          <CardTitle className="hud-label">Histórico de XP</CardTitle>
          <CardDescription>Últimos lançamentos do seu ledger</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-1 p-0 pb-3">
          {history.length === 0 ? (
            <p className="px-6 pb-3 text-sm text-muted-foreground">
              Nenhum XP ainda — conclua missões para começar a pontuar!
            </p>
          ) : (
            history.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center gap-3 border-b px-6 py-2.5 text-sm last:border-b-0"
              >
                {entry.amount >= 0 ? (
                  <TrendingUp className="size-4 shrink-0 text-gold" aria-hidden />
                ) : (
                  <TrendingDown className="size-4 shrink-0 text-destructive" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {entry.taskTitle ??
                      entry.closingTitle ??
                      REASON_LABELS[entry.reason] ??
                      entry.reason}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {REASON_LABELS[entry.reason] ?? entry.reason} ·{" "}
                    {formatDateTime(entry.createdAt)}
                  </p>
                </div>
                <span
                  className={
                    entry.amount >= 0
                      ? "font-mono font-semibold tabular-nums text-gold"
                      : "font-mono font-semibold tabular-nums text-destructive"
                  }
                >
                  {entry.amount >= 0 ? "+" : ""}
                  {entry.amount} XP
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
