import { Crown, Medal, Trophy } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { levelFromXp } from "@/domain/xp";
import { initials } from "@/lib/people";
import { requireOrgSession } from "@/lib/session";
import { getLeaderboard, type LeaderboardPeriod } from "@/lib/xp-queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Ranking" };

const PERIOD_TABS = [
  { key: "week", label: "Semana" },
  { key: "month", label: "Mês" },
  { key: "all", label: "Geral" },
] as const;

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
      <div>
        <h1 className="text-2xl font-semibold tracking-wide">Ranking</h1>
        <p className="text-muted-foreground">
          Soma de XP da guilda por período — só entregas aprovadas pontuam.
        </p>
      </div>

      <nav aria-label="Período" className="flex w-fit rounded-lg border bg-muted/40 p-0.5">
        {PERIOD_TABS.map(({ key, label }) => (
          <Link
            key={key}
            href={key === "week" ? "/leaderboard" : `/leaderboard?period=${key}`}
            aria-current={period === key ? "page" : undefined}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
              period === key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-12 text-center">
          <Trophy className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">Ninguém pontuou neste período</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Conclua missões e tenha as entregas aprovadas para aparecer aqui.
          </p>
        </div>
      ) : (
        <Card className="panel-cut texture-iron">
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
                      <span className="text-sm font-medium text-muted-foreground">
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
                      Nível {levelFromXp(row.totalXp)} · {row.totalXp} XP no total
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
