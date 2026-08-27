import { and, desc, eq, isNull } from "drizzle-orm";
import { TrendingDown, TrendingUp } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/page-header";
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
import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { levelProgress } from "@/domain/xp";
import { initials, ROLE_LABELS } from "@/lib/people";
import { getActiveMember, requireOrgSession } from "@/lib/session";
import { formatDateTime } from "@/lib/task-ui";
import { getTelegramConfig } from "@/lib/telegram/config";
import { getTelegramBotUsername } from "@/lib/telegram/client";
import {
  countCompletedTasks,
  getUserXpTotal,
  getXpHistory,
} from "@/lib/xp-queries";

import { TelegramSettings } from "./telegram-settings";
import type { TelegramPreferencesView } from "./telegram-types";

export const metadata: Metadata = { title: "Perfil" };

const REASON_LABELS: Record<string, string> = {
  task_completed: "Missão concluída",
  closing_year_closed: "Fechamento anual",
  reversal: "Conclusão revertida",
  bonus: "Bônus",
};

const DEFAULT_TELEGRAM_PREFERENCES: TelegramPreferencesView = {
  taskNotifications: true,
  approvalNotifications: true,
  deadlineReminders: true,
  xpNotifications: true,
  closingNotifications: true,
  campaignNotifications: true,
  muralNotifications: true,
  dailySummary: false,
  dailySummaryTime: "08:00",
  timezone: "America/Sao_Paulo",
  quietHoursStart: null,
  quietHoursEnd: null,
};

export default async function ProfilePage() {
  const session = await requireOrgSession();
  const member = await getActiveMember();
  if (!member) {
    redirect("/onboarding");
  }

  const [totalXp, completedCount, history, telegramData, botUsername] = await Promise.all([
    getUserXpTotal(session.orgId, session.user.id),
    countCompletedTasks(session.orgId, session.user.id),
    getXpHistory(session.orgId, session.user.id),
    withOrgTx(session.orgId, async (tx) => {
      const [connection, preferences] = await Promise.all([
        tx.query.telegramConnections.findFirst({
          where: and(
            eq(schema.telegramConnections.orgId, session.orgId),
            eq(schema.telegramConnections.userId, session.user.id),
            isNull(schema.telegramConnections.revokedAt),
          ),
          orderBy: [desc(schema.telegramConnections.connectedAt)],
        }),
        tx.query.telegramPreferences.findFirst({
          where: and(
            eq(schema.telegramPreferences.orgId, session.orgId),
            eq(schema.telegramPreferences.userId, session.user.id),
          ),
        }),
      ]);
      return { connection, preferences };
    }),
    getTelegramBotUsername(),
  ]);
  const progress = levelProgress(totalXp);
  const xpIntoLevel = progress.totalXp - progress.currentLevelXp;
  const xpLevelSpan = progress.nextLevelXp - progress.currentLevelXp;
  const telegramConfig = getTelegramConfig();

  return (
    <div className="grid gap-6">
      <PageHeader title="Perfil" />

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
          <h2>Constelação de progressão</h2>
          <span className="font-mono text-xs tabular-nums text-gold">
            {totalXp.toLocaleString("pt-BR")} XP no total
          </span>
        </div>
        <Constellation totalXp={totalXp} />
        <XpBar
          current={xpIntoLevel}
          target={xpLevelSpan}
          label={`Progresso para o nível ${progress.level + 1}`}
        />
        <p className="font-mono text-xs tabular-nums text-muted-foreground">
          nível {progress.level} · faltam{" "}
          {(progress.nextLevelXp - progress.totalXp).toLocaleString("pt-BR")} XP
          para o nível {progress.level + 1} · {completedCount}{" "}
          {completedCount === 1 ? "missão concluída" : "missões concluídas"}
        </p>
      </section>

      <TelegramSettings
        key={telegramData.connection?.id ?? "telegram-disconnected"}
        connection={
          telegramData.connection
            ? {
                id: telegramData.connection.id,
                username: telegramData.connection.username,
                displayName:
                  [
                    telegramData.connection.firstName,
                    telegramData.connection.lastName,
                  ]
                    .filter(Boolean)
                    .join(" ") || null,
                connectedAt: formatDateTime(telegramData.connection.connectedAt),
              }
            : null
        }
        preferences={
          telegramData.preferences
            ? {
                taskNotifications: telegramData.preferences.taskNotifications,
                approvalNotifications:
                  telegramData.preferences.approvalNotifications,
                deadlineReminders: telegramData.preferences.deadlineReminders,
                xpNotifications: telegramData.preferences.xpNotifications,
                closingNotifications: telegramData.preferences.closingNotifications,
                campaignNotifications:
                  telegramData.preferences.campaignNotifications,
                muralNotifications: telegramData.preferences.muralNotifications,
                dailySummary: telegramData.preferences.dailySummary,
                dailySummaryTime: telegramData.preferences.dailySummaryTime,
                timezone: telegramData.preferences.timezone,
                quietHoursStart: telegramData.preferences.quietHoursStart,
                quietHoursEnd: telegramData.preferences.quietHoursEnd,
              }
            : DEFAULT_TELEGRAM_PREFERENCES
        }
        botUsername={botUsername}
        configured={Boolean(telegramConfig.botToken && botUsername)}
      />

      <Card className="panel-cut rounded-none border-0 ring-0">
        <CardHeader>
          {/* asChild: o CardTitle rende <div>, e este é o título da seção. */}
          <CardTitle asChild>
            <h2>Histórico de XP</h2>
          </CardTitle>
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
