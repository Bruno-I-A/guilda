import { Inbox } from "lucide-react";
import Link from "next/link";

import { ClanStatusStrip } from "@/app/(app)/clans/[id]/clan-ui";
import { MissionRow } from "@/components/mission-row";
import {
  INFORMATIVE_KIND_LABELS,
  isTaskOverdue,
  type InformativePackage,
} from "@/domain/mission-triage";
import type { TaskStatus } from "@/domain/task-state";
import { STATUS_METER_CLASSES } from "@/lib/task-ui";
import { cn } from "@/lib/utils";

import { ClosedMissions, MissionEmpty, MissionSection } from "./mission-sections";
import type { MissionListRow } from "./mission-list-types";

/** Pacotes encerrados mostrados de uma vez — histórico, não fila. */
const CLOSED_PACKAGES_LIMIT = 20;
/** Acima disto o medidor por segmento vira listra fina demais para ler. */
const METER_SEGMENT_LIMIT = 24;

function formatReceivedAt(date: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/**
 * Um segmento por missão do pacote, na cor do status — o pacote inteiro
 * lido de relance, sem abrir. Acima do limite, vira barra proporcional.
 */
function PackageMeter({
  statuses,
  done,
  total,
}: {
  statuses: readonly TaskStatus[];
  done: number;
  total: number;
}) {
  const label = `${done} de ${total} concluídas`;
  if (statuses.length > METER_SEGMENT_LIMIT) {
    const ratio = total > 0 ? done / total : 0;
    return (
      <span
        role="img"
        aria-label={label}
        className="relative block h-2 w-24 overflow-hidden bg-secondary"
      >
        <span
          className="absolute inset-y-0 left-0 bg-gold/70"
          style={{ width: `${ratio * 100}%` }}
        />
      </span>
    );
  }
  return (
    <span role="img" aria-label={label} className="flex h-2 w-24 gap-px">
      {statuses.map((status, index) => (
        <span
          key={index}
          className={cn("min-w-0 flex-1 skew-x-[-12deg]", STATUS_METER_CLASSES[status])}
        />
      ))}
    </span>
  );
}

function AvailableChip() {
  return (
    <span className="hud-label shrink-0 border border-primary/35 bg-primary/10 px-1.5 py-0.5 !text-primary">
      disponível
    </span>
  );
}

function PackageCard({
  pkg,
  taskHref,
}: {
  pkg: InformativePackage<MissionListRow>;
  taskHref: (taskId: string) => string;
}) {
  const clanNames = [
    ...new Set(pkg.tasks.map((task) => task.clanName).filter(Boolean)),
  ] as string[];
  const hiddenCount = pkg.statuses.length - pkg.tasks.length;

  return (
    <article className="panel-cut grid bg-card/60">
      <header className="grid gap-2 border-b border-border/70 px-4 py-3 sm:flex sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="hud-label shrink-0 border border-primary/35 bg-primary/10 px-1.5 py-0.5 !text-primary">
              {INFORMATIVE_KIND_LABELS[pkg.kind]}
            </span>
            <h3 className="min-w-0 truncate">{pkg.label}</h3>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            recebido em {formatReceivedAt(pkg.createdAt)}
            {clanNames.length > 0 ? ` · ${clanNames.slice(0, 3).join(", ")}` : ""}
            {clanNames.length > 3 ? ` +${clanNames.length - 3}` : ""}
            {` · ${pkg.statuses.length} ${plural(pkg.statuses.length, "missão", "missões")}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="font-mono text-sm tabular-nums">
            <span className={cn(pkg.progress.done === pkg.progress.total && pkg.progress.total > 0 ? "text-gold" : "text-foreground")}>
              {pkg.progress.done}
            </span>
            <span className="text-muted-foreground">/{pkg.progress.total}</span>
          </span>
          <PackageMeter
            statuses={pkg.statuses}
            done={pkg.progress.done}
            total={pkg.progress.total}
          />
        </div>
      </header>

      <ul className="divide-y divide-border/50">
        {pkg.tasks.map((task) => (
          <li key={task.id}>
            <MissionRow
              variant="compact"
              frame="flat"
              href={taskHref(task.id)}
              task={{
                id: task.id,
                title: task.title,
                status: task.status,
                xpValue: task.xpValue,
                dueDate: task.dueDate,
                clanName: task.clanName,
                assigneeName: task.assigneeName,
              }}
              trailing={
                !task.assigneeId && task.status === "pending" ? <AvailableChip /> : null
              }
            />
          </li>
        ))}
      </ul>

      {hiddenCount > 0 ? (
        <p className="border-t border-border/50 px-4 py-2 text-xs text-muted-foreground">
          +{hiddenCount} {plural(hiddenCount, "missão", "missões")} deste pacote fora do
          recorte atual.
        </p>
      ) : null}
    </article>
  );
}

/**
 * Missões de Informativo, lidas como PACOTE: as missões de uma empresa
 * nascem juntas, e "quanto falta para essa empresa" é a pergunta — não o
 * status de cada linha solta no meio das outras.
 */
export function InformativeView({
  packages,
  now,
  taskHref,
}: {
  packages: readonly InformativePackage<MissionListRow>[];
  now: Date;
  taskHref: (taskId: string) => string;
}) {
  const openPackages = packages.filter((pkg) => pkg.open);
  const closedPackages = packages.filter((pkg) => !pkg.open);
  const visibleOpenTasks = openPackages.flatMap((pkg) => pkg.tasks);
  const unassigned = visibleOpenTasks.filter(
    (task) => !task.assigneeId && task.status === "pending",
  ).length;
  const overdue = visibleOpenTasks.filter((task) => isTaskOverdue(task, now)).length;

  return (
    <div className="grid gap-6">
      <ClanStatusStrip
        items={[
          {
            label: plural(openPackages.length, "pacote em aberto", "pacotes em aberto"),
            value: openPackages.length,
            detail:
              openPackages.length === 0
                ? "nenhuma empresa com missão pendente"
                : "empresas com trabalho pendente",
          },
          {
            label: unassigned === 0 ? "tudo atribuído" : "sem responsável",
            value: unassigned === 0 ? "✓" : unassigned,
            detail: unassigned === 0 ? "ninguém sem dono" : "aguardando alguém assumir",
            tone: unassigned === 0 ? "positive" : "warning",
          },
          {
            label: overdue === 0 ? "tudo em dia" : "atrasadas",
            value: overdue === 0 ? "✓" : overdue,
            detail: overdue === 0 ? "nenhum prazo vencido" : "exigem atenção",
            tone: overdue === 0 ? "positive" : "danger",
          },
        ]}
      />

      <MissionSection
        title="Em andamento"
        count={openPackages.length}
        hint="mais recentes primeiro"
      >
        {openPackages.length === 0 ? (
          <MissionEmpty title="Nenhum pacote de Informativo em aberto neste recorte">
            Troque o recorte acima ou{" "}
            <Link href="/informativos" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
              <Inbox className="size-3.5" aria-hidden /> prepare um informativo
            </Link>
            .
          </MissionEmpty>
        ) : (
          <div className="grid gap-3">
            {openPackages.map((pkg) => (
              <PackageCard key={pkg.informativeId} pkg={pkg} taskHref={taskHref} />
            ))}
          </div>
        )}
      </MissionSection>

      {closedPackages.length > 0 ? (
        <ClosedMissions title="Pacotes encerrados" count={closedPackages.length}>
          <div className="grid gap-3">
            {closedPackages.slice(0, CLOSED_PACKAGES_LIMIT).map((pkg) => (
              <PackageCard key={pkg.informativeId} pkg={pkg} taskHref={taskHref} />
            ))}
          </div>
          {closedPackages.length > CLOSED_PACKAGES_LIMIT ? (
            <p className="text-xs text-muted-foreground">
              Mostrando os {CLOSED_PACKAGES_LIMIT} pacotes encerrados mais recentes.
            </p>
          ) : null}
        </ClosedMissions>
      ) : null}
    </div>
  );
}
