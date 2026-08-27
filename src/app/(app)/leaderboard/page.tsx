import { Crown, Medal, Trophy } from "lucide-react";
import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { SegmentedNav, type SegmentedNavItem } from "@/components/segmented-nav";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { levelFromXp } from "@/domain/xp";
import { initials } from "@/lib/people";
import { requireOrgSession } from "@/lib/session";
import { getLeaderboard, type LeaderboardPeriod } from "@/lib/xp-queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Ranking" };

// "week" é o padrão: mora em /leaderboard sem query, para não deixar a URL
// canônica do ranking com parâmetro redundante.
const PERIOD_TABS: readonly SegmentedNavItem[] = [
  { key: "week", label: "Semana", href: "/leaderboard" },
  { key: "month", label: "Mês", href: "/leaderboard?period=month" },
  { key: "all", label: "Geral", href: "/leaderboard?period=all" },
];

function parsePeriod(value: string | undefined): LeaderboardPeriod {
  return value === "month" || value === "all" ? value : "week";
}

const RANK_ICONS = [
  { icon: Crown, className: "text-gold" },
  { icon: Medal, className: "text-silver" },
  { icon: Medal, className: "text-bronze" },
];

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const session = await requireOrgSession();
  const { period: rawPeriod } = await searchParams;
  const period = parsePeriod(rawPeriod);

  const rows = await getLeaderboard(session.orgId, period);

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Ranking"
        description="Soma de XP da guilda por período — missões concluídas e fechamentos pontuam."
      />

      <SegmentedNav items={PERIOD_TABS} active={period} label="Período" />

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-12 text-center">
          <Trophy className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">Ninguém pontuou neste período</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Conclua missões para aparecer aqui.
          </p>
        </div>
      ) : (
        <Card className="panel-cut texture-iron rounded-none border-0 ring-0">
          <CardContent className="divide-y p-0">
            {rows.map((row, index) => {
              const isSelf = row.userId === session.user.id;
              const rankIcon = RANK_ICONS[index];
              return (
                <div
                  key={row.userId}
                  className={cn(
                    "flex items-center gap-3 border-l-2 border-l-transparent px-4 py-3",
                    index === 0 && "border-l-gold/70",
                    index === 1 && "border-l-silver/60",
                    index === 2 && "border-l-bronze/70",
                    isSelf && "bg-accent/40",
                  )}
                >
                  <span className="w-8 text-center">
                    {rankIcon ? (
                      <rankIcon.icon
                        className={cn("mx-auto size-5", rankIcon.className)}
                        aria-label={`${index + 1}º lugar`}
                      />
                    ) : (
                      <span className="font-mono text-sm font-medium tabular-nums text-muted-foreground">
                        {index + 1}º
                      </span>
                    )}
                  </span>
                  <Avatar className="size-9">
                    <AvatarFallback className="text-xs">
                      {initials(row.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {row.name}
                      {isSelf ? (
                        <span className="text-muted-foreground"> (você)</span>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Nível{" "}
                      <span className="font-mono tabular-nums">
                        {levelFromXp(row.totalXp)}
                      </span>{" "}
                      ·{" "}
                      <span className="font-mono tabular-nums">
                        {row.totalXp}
                      </span>{" "}
                      XP no total
                    </p>
                  </div>
                  <Badge
                    variant="secondary"
                    className="font-mono tabular-nums text-gold"
                  >
                    {row.periodXp >= 0 ? "+" : ""}
                    {row.periodXp} XP
                  </Badge>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
