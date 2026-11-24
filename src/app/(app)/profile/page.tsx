import { and, eq } from "drizzle-orm";
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
import { listMcpAgentKeys } from "@/lib/mcp/access";
import { initials, ROLE_LABELS } from "@/lib/people";
import { getActiveMember, requireOrgSession } from "@/lib/session";
import { formatDateTime } from "@/lib/task-ui";
import { hasOpenMemberWhatsAppWindow, MEMBER_WINDOW_MS } from "@/lib/whatsapp/member-notifications";
import {
  countCompletedTasks,
  getUserXpTotal,
  getXpHistory,
} from "@/lib/xp-queries";

import { McpKeyManager } from "../settings/mcp-key-manager";
import { NotificationPreferences, type NotificationPreferencesView } from "./notification-preferences";
import { WhatsAppSettings } from "./whatsapp-settings";
import { WhatsAppTemplates } from "./whatsapp-templates";

export const metadata: Metadata = { title: "Perfil" };

const REASON_LABELS: Record<string, string> = {
  task_completed: "Missão concluída",
  closing_year_closed: "Fechamento anual",
  closing_year_reversal: "Fechamento anual revertido",
  closing_challenge: "Desafio do dado",
  closing_challenge_reversal: "Desafio do dado revertido",
  reversal: "Conclusão revertida",
  bonus: "Bônus",
};

/** Os padrões da tabela: fechamentos desligado (iria à Guilda inteira). */
const DEFAULT_PREFERENCES: NotificationPreferencesView = {
  taskNotifications: true,
  approvalNotifications: true,
  deadlineReminders: true,
  xpNotifications: true,
  closingNotifications: false,
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

  const isAdmin = member.role === "owner" || member.role === "admin";
  const [totalXp, completedCount, history, whatsAppData, mcpKeys] = await Promise.all([
    getUserXpTotal(session.orgId, session.user.id),
    countCompletedTasks(session.orgId, session.user.id),
    getXpHistory(session.orgId, session.user.id),
    withOrgTx(session.orgId, async (tx) => {
      const [connection, preferences, templates] = await Promise.all([
        tx.query.memberWhatsAppConnections.findFirst({ where: and(eq(schema.memberWhatsAppConnections.orgId, session.orgId), eq(schema.memberWhatsAppConnections.userId, session.user.id)) }),
        tx.query.memberNotificationPreferences.findFirst({ where: and(eq(schema.memberNotificationPreferences.orgId, session.orgId), eq(schema.memberNotificationPreferences.userId, session.user.id)) }),
        isAdmin ? tx.query.memberWhatsAppTemplates.findMany({ where: eq(schema.memberWhatsAppTemplates.orgId, session.orgId) }) : Promise.resolve([]),
      ]);
      return { connection, preferences, templates };
    }),
    listMcpAgentKeys(session.orgId, session.user.id),
  ]);
  const progress = levelProgress(totalXp);
  const xpIntoLevel = progress.totalXp - progress.currentLevelXp;
  const xpLevelSpan = progress.nextLevelXp - progress.currentLevelXp;
  const whatsApp = whatsAppData.connection;
  const prefs = whatsAppData.preferences;

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

      <WhatsAppSettings
        key={whatsApp?.id ?? "whatsapp-sem-numero"}
        connection={whatsApp ? {
          phone: whatsApp.phoneE164,
          enabled: whatsApp.enabled,
          verifiedAt: whatsApp.verifiedAt ? formatDateTime(whatsApp.verifiedAt) : null,
          windowOpenUntil: whatsApp.lastInboundAt && hasOpenMemberWhatsAppWindow(whatsApp.lastInboundAt)
            ? formatDateTime(new Date(whatsApp.lastInboundAt.getTime() + MEMBER_WINDOW_MS))
            : null,
        } : null}
      />

      <NotificationPreferences
        preferences={prefs ? {
          taskNotifications: prefs.taskNotifications,
          approvalNotifications: prefs.approvalNotifications,
          deadlineReminders: prefs.deadlineReminders,
          xpNotifications: prefs.xpNotifications,
          closingNotifications: prefs.closingNotifications,
          campaignNotifications: prefs.campaignNotifications,
          muralNotifications: prefs.muralNotifications,
          dailySummary: prefs.dailySummary,
          dailySummaryTime: prefs.dailySummaryTime,
          timezone: prefs.timezone,
          quietHoursStart: prefs.quietHoursStart,
          quietHoursEnd: prefs.quietHoursEnd,
        } : DEFAULT_PREFERENCES}
      />

      {isAdmin ? (
        <WhatsAppTemplates
          templates={whatsAppData.templates.map((template) => ({
            key: template.key,
            name: template.name,
            status: template.status,
            category: template.category,
            rejectedReason: template.rejectedReason,
          }))}
        />
      ) : null}

      <McpKeyManager
        selfService
        members={[{
          userId: session.user.id,
          name: session.user.name,
          role: member.role,
        }]}
        keys={mcpKeys}
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
