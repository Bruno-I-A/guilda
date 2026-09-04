import { Crown, Medal, Trophy } from "lucide-react";
import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { SegmentedNav, type SegmentedNavItem } from "@/components/segmented-nav";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { XpBar } from "@/components/xp-bar";
import { levelFromXp, levelProgress } from "@/domain/xp";
import { leaderboardWindowLabel } from "@/lib/leaderboard-ui";
import { initials } from "@/lib/people";
import { requireOrgSession } from "@/lib/session";
import { getLeaderboard, type LeaderboardPeriod } from "@/lib/xp-queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Ranking" };

/**
 * DUAS leituras, não três períodos do mesmo pódio (decisão de 2026-09-04).
 *
 * "Geral" somava tudo desde sempre e sem decaimento: o pódio era decidido por
 * TEMPO DE CASA, e quem chegou depois não alcançava por mérito nenhum — o
 * primeiro lugar era um dado de antiguidade fantasiado de competição.
 *
 * A informação de carreira não se apaga (é ela que o perfil celebra), mas
 * deixa de ser disputa: "Semana" e "Mês" são a competição, com largada e
 * chegada de calendário; "Carreira" é vitrine — mesma gente, ordenada pelo
 * acumulado, sem coroa, sem medalha, sem colocação. É a diferença entre
 * "quem está ganhando agora" e "onde cada um chegou".
 *
 * "week" é o padrão: mora em /leaderboard sem query, para não deixar a URL
 * canônica do ranking com parâmetro redundante. `period=all` continua sendo o
 * endereço da carreira para não quebrar link antigo.
 */
const PERIOD_TABS: readonly SegmentedNavItem[] = [
  { key: "week", label: "Semana", href: "/leaderboard" },
  { key: "month", label: "Mês", href: "/leaderboard?period=month" },
  { key: "all", label: "Carreira", href: "/leaderboard?period=all" },
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
  const isCareer = period === "all";

  const rows = await getLeaderboard(session.orgId, period);
  const windowLabel = leaderboardWindowLabel(period, new Date());

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Ranking"
        description={
          isCareer
            ? "Acumulado desde sempre — não é disputa: quem entrou antes teve mais tempo de somar. A competição é por período."
            : `Quem mais somou XP ${period === "week" ? "nesta semana" : "neste mês"} — ${windowLabel}. Zera para todo mundo junto.`
        }
      />

      <SegmentedNav items={PERIOD_TABS} active={period} label="Período" />

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-12 text-center">
          <Trophy className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">
            {isCareer
              ? "Ninguém pontuou ainda"
              : "Ninguém pontuou neste período"}
          </p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {isCareer
              ? "Conclua missões para começar a construir a sua carreira aqui."
              : "Conclua missões para aparecer aqui — o placar recomeça a cada período."}
          </p>
        </div>
      ) : isCareer ? (
        <CareerRoster rows={rows} selfId={session.user.id} />
      ) : (
        <Podium rows={rows} selfId={session.user.id} />
      )}
    </div>
  );
}

interface Row {
  userId: string;
  name: string;
  periodXp: number;
  totalXp: number;
}

/** A competição: colocação, pódio e o XP somado dentro da janela. */
function Podium({ rows, selfId }: { rows: Row[]; selfId: string }) {
  return (
    <Card className="panel-cut texture-iron rounded-none border-0 ring-0">
      <CardContent className="divide-y p-0">
        {rows.map((row, index) => {
          const isSelf = row.userId === selfId;
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
                  <span className="font-mono tabular-nums">{row.totalXp}</span>{" "}
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
  );
}

/**
 * A vitrine: onde cada pessoa chegou.
 *
 * Sem coroa, sem medalha e sem "1º" de propósito — a ordem é o acumulado, e
 * acumulado premia quem começou antes. Trocar os sinais de pódio pela barra de
 * progresso é o que faz a tela dizer "progressão", e não "disputa": o que
 * salta aos olhos passa a ser o quanto falta para o próximo nível de CADA um,
 * que é uma corrida que cada pessoa corre contra si mesma.
 */
function CareerRoster({ rows, selfId }: { rows: Row[]; selfId: string }) {
  return (
    <section className="panel-cut texture-iron">
      <h2 className="sr-only">Progresso acumulado da guilda</h2>
      <ul className="divide-y divide-border">
        {rows.map((row) => {
          const isSelf = row.userId === selfId;
          const progress = levelProgress(row.totalXp);
          return (
            <li
              key={row.userId}
              className={cn(
                "grid gap-2.5 px-4 py-3.5",
                isSelf && "bg-accent/40",
              )}
            >
              <div className="flex items-center gap-3">
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
                    <span className="font-mono tabular-nums">
                      {row.totalXp.toLocaleString("pt-BR")}
                    </span>{" "}
                    XP acumulados
                  </p>
                </div>
                <Badge
                  variant="secondary"
                  className="font-mono tabular-nums text-gold"
                >
                  Nível {progress.level}
                </Badge>
              </div>
              <XpBar
                current={progress.totalXp - progress.currentLevelXp}
                target={progress.nextLevelXp - progress.currentLevelXp}
                label={`${row.name}: progresso para o nível ${progress.level + 1}`}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
