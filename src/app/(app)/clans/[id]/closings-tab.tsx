import { and, asc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import {
  Building2,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Search,
} from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  observationState,
  parseObservationScope,
} from "@/domain/closing-observations";
import {
  ACCOUNTING_PERIOD_MONTHS,
  matchesAccountingClosingFilters,
  type AccountingMonthFilter,
  type AccountingObservationFilter,
  type AccountingPeriodStatusFilter,
  type AccountingYearFilter,
} from "@/domain/accounting-period";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import {
  CLOSING_GROUPS,
  type ClosingGroup,
} from "@/lib/closings-ui";
import { cn } from "@/lib/utils";

import {
  CompanyClosingBoard,
  type ClosingObservationView,
  type CompanyClosingView,
} from "./closing-board";
import { ClanEmptyState, ClanSectionHeading } from "./clan-ui";

function todayInSaoPaulo(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function parseYear(value: string | undefined): number {
  const year = Number(value);
  return Number.isInteger(year) && year >= 2000 && year <= 2100
    ? year
    : Number(todayInSaoPaulo().slice(0, 4));
}

function parseGroup(value: string | undefined): ClosingGroup {
  return CLOSING_GROUPS.some((group) => group.key === value)
    ? (value as ClosingGroup)
    : "simples";
}

export interface ClosingsTabParams {
  year?: string;
  group?: string;
  q?: string;
  /** `status` remains accepted for bookmarks created by the previous filter UI. */
  status?: string;
  yearStatus?: string;
  observationStatus?: string;
  periodClosings?: string;
  periodStatus?: string;
  periodMonth?: string;
}

/**
 * O fechamento anual das empresas — o trabalho recorrente da Contabilidade.
 *
 * Vive dentro do clã (e não em rota própria) porque é trabalho DE UM CLÃ:
 * quem abre a Contabilidade encontra aqui o ano de cada empresa, do mesmo
 * jeito que o Fiscal encontra a carteira.
 */
export async function ClosingsTab({
  orgId,
  clanId,
  params,
  canManage,
}: {
  orgId: string;
  clanId: string;
  params: ClosingsTabParams;
  /** Só decide quais botões aparecem; as actions checam de novo no servidor. */
  canManage: boolean;
}) {
  const year = parseYear(params.year);
  const group = parseGroup(params.group);
  const legacyStatus = params.status;
  const yearStatus: AccountingYearFilter =
    params.yearStatus === "open" || params.yearStatus === "completed"
      ? params.yearStatus
      : legacyStatus === "open" || legacyStatus === "completed"
        ? legacyStatus
        : "all";
  const requestedObservationStatus =
    params.observationStatus === "none"
      ? "without"
      : params.observationStatus;
  const observationStatus: AccountingObservationFilter =
    requestedObservationStatus === "with" ||
    requestedObservationStatus === "without" ||
    requestedObservationStatus === "pending"
      ? requestedObservationStatus
      : legacyStatus === "notes"
        ? "pending"
        : "all";
  const periodStatus: AccountingPeriodStatusFilter =
    params.periodStatus === "some" || params.periodStatus === "none"
      ? params.periodStatus
      : params.periodClosings === "1" ||
          (params.periodStatus === undefined && legacyStatus === "periods")
        ? "some"
        : "all";
  const parsedPeriodMonth = Number(params.periodMonth);
  const periodMonth: AccountingMonthFilter =
    params.periodMonth === "unknown"
      ? "unknown"
      : Number.isInteger(parsedPeriodMonth) &&
          parsedPeriodMonth >= 1 &&
          parsedPeriodMonth <= 12
        ? parsedPeriodMonth
        : "all";
  const q = (params.q ?? "").trim();

  const clientConditions: SQL[] = [
    eq(schema.clients.orgId, orgId),
    eq(schema.clients.active, true),
  ];
  if (group === "presumido_association") {
    clientConditions.push(
      inArray(schema.clients.taxRegime, ["presumido", "association"]),
    );
  } else {
    clientConditions.push(eq(schema.clients.taxRegime, group));
  }

  const { clients, closings, annualControls, observations, memberRows } = await withOrgTx(
    orgId,
    async (tx) => {
      const clients = await tx.query.clients.findMany({
        where: and(...clientConditions),
        orderBy: [asc(schema.clients.name)],
      });
      const closings = await tx.query.accountingClosings.findMany({
        where: and(
          eq(schema.accountingClosings.orgId, orgId),
          gte(schema.accountingClosings.dueDate, `${year}-01-01`),
          lte(schema.accountingClosings.dueDate, `${year}-12-31`),
        ),
        with: {
          completedByUser: {
            columns: { name: true },
          },
        },
      });
      const annualControls = await tx.query.accountingClosingYears.findMany({
        where: and(
          eq(schema.accountingClosingYears.orgId, orgId),
          eq(schema.accountingClosingYears.year, year),
        ),
      });
      // A missão vinculada entra junto: o card diz "virou missão" e em que pé
      // ela está, sem obrigar a abrir a missão para descobrir.
      const observations = await tx
        .select({
          id: schema.closingObservations.id,
          clientId: schema.closingObservations.clientId,
          scope: schema.closingObservations.scope,
          closingId: schema.closingObservations.closingId,
          body: schema.closingObservations.body,
          authorName: schema.user.name,
          taskId: schema.closingObservations.taskId,
          taskTitle: schema.tasks.title,
          taskStatus: schema.tasks.status,
          taskAssignee: sql<string | null>`assignee.name`,
          resolvedAt: schema.closingObservations.resolvedAt,
          createdAt: schema.closingObservations.createdAt,
        })
        .from(schema.closingObservations)
        .leftJoin(schema.user, eq(schema.user.id, schema.closingObservations.authorId))
        .leftJoin(
          schema.tasks,
          and(
            eq(schema.tasks.orgId, schema.closingObservations.orgId),
            eq(schema.tasks.id, schema.closingObservations.taskId),
          ),
        )
        .leftJoin(
          sql`"user" as assignee`,
          sql`assignee.id = ${schema.tasks.assigneeId}`,
        )
        .where(
          and(
            eq(schema.closingObservations.orgId, orgId),
            eq(schema.closingObservations.year, year),
          ),
        )
        .orderBy(asc(schema.closingObservations.createdAt));
      const memberRows = await tx
        .select({ userId: schema.member.userId, name: schema.user.name })
        .from(schema.member)
        .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
        .where(eq(schema.member.organizationId, orgId))
        .orderBy(asc(schema.user.name));
      return { clients, closings, annualControls, observations, memberRows };
    },
  );

  const closingsByClient = new Map<string, CompanyClosingView["closings"]>();
  for (const closing of closings) {
    const list = closingsByClient.get(closing.clientId) ?? [];
    list.push({
      id: closing.id,
      clientId: closing.clientId,
      title: closing.title,
      periodMonth: closing.periodMonth,
      dueDate: closing.dueDate,
      status: closing.status,
      notes: closing.notes,
      cashBalance: closing.cashBalance,
      periodResult: closing.periodResult,
      shareholderLoan: closing.shareholderLoan,
      completedAt: closing.completedAt?.toISOString() ?? null,
      completedBy: closing.completedByUser?.name ?? null,
    });
    closingsByClient.set(closing.clientId, list);
  }
  for (const list of closingsByClient.values()) {
    list.sort((a, b) => {
      if (a.status === "completed" && b.status !== "completed") return 1;
      if (a.status !== "completed" && b.status === "completed") return -1;
      const monthOrderA = a.periodMonth ?? 13;
      const monthOrderB = b.periodMonth ?? 13;
      if (monthOrderA !== monthOrderB) return monthOrderA - monthOrderB;
      return a.dueDate.localeCompare(b.dueDate);
    });
  }

  const observationsByClient = new Map<string, ClosingObservationView[]>();
  for (const observation of observations) {
    const list = observationsByClient.get(observation.clientId) ?? [];
    list.push({
      id: observation.id,
      scope: parseObservationScope(observation.scope),
      closingId: observation.closingId,
      body: observation.body,
      authorName: observation.authorName,
      taskId: observation.taskId,
      taskTitle: observation.taskTitle,
      taskStatus: observation.taskStatus,
      taskAssignee: observation.taskAssignee,
      // Estado derivado aqui, onde as datas ainda são Date — a interface
      // recebe a conclusão, não os ingredientes.
      state: observationState({
        taskId: observation.taskId,
        resolvedAt: observation.resolvedAt,
      }),
      resolvedAt: observation.resolvedAt?.toISOString() ?? null,
      createdAt: observation.createdAt.toISOString(),
    });
    observationsByClient.set(observation.clientId, list);
  }

  const annualByClient = new Map(
    annualControls.map((control) => [control.clientId, control]),
  );
  const allCompanies: CompanyClosingView[] = clients.map((client) => {
    const annual = annualByClient.get(client.id);
    return {
      id: client.id,
      name: client.name,
      taxRegime: client.taxRegime,
      yearClosedAt: annual?.closedAt?.toISOString() ?? null,
      yearNotes: annual?.notes ?? null,
      defisCompletedAt: annual?.defisCompletedAt?.toISOString() ?? null,
      defisNotes: annual?.defisNotes ?? null,
      closings: closingsByClient.get(client.id) ?? [],
      observations: observationsByClient.get(client.id) ?? [],
    };
  });

  // O filtro de observação passou a significar "tem recado esperando alguém",
  // não "tem texto escrito": recado já resolvido não é pendência.
  function hasNotes(company: CompanyClosingView): boolean {
    return company.observations.some(
      (observation) => observation.state === "open",
    );
  }

  const normalizedQuery = q.toLocaleLowerCase("pt-BR");
  const companies = allCompanies.filter((company) => {
    const matchesQuery =
      !normalizedQuery ||
      company.name.toLocaleLowerCase("pt-BR").includes(normalizedQuery) ||
      company.observations.some((observation) =>
        observation.body.toLocaleLowerCase("pt-BR").includes(normalizedQuery),
      ) ||
      company.closings.some(
        (closing) =>
          closing.title.toLocaleLowerCase("pt-BR").includes(normalizedQuery) ||
          closing.notes?.toLocaleLowerCase("pt-BR").includes(normalizedQuery),
      );
    if (!matchesQuery) return false;
    return matchesAccountingClosingFilters(
      {
        yearClosed: Boolean(company.yearClosedAt),
        observationCount: company.observations.length,
        hasPendingObservation: hasNotes(company),
        closingMonths: company.closings.map((closing) => closing.periodMonth),
      },
      {
        year: yearStatus,
        observations: observationStatus,
        periods: periodStatus,
        month: periodMonth,
      },
    );
  });

  const closedCount = allCompanies.filter((company) => company.yearClosedAt).length;
  const openCount = allCompanies.length - closedCount;
  const notesCount = allCompanies.filter(hasNotes).length;
  const noPeriodCount = allCompanies.filter(
    (company) => company.closings.length === 0,
  ).length;
  const defisPendingCount =
    group === "simples"
      ? allCompanies.filter(
          (company) => company.yearClosedAt && !company.defisCompletedAt,
        ).length
      : 0;
  const progress =
    allCompanies.length === 0
      ? 0
      : Math.round((closedCount / allCompanies.length) * 100);

  function href(
    overrides: Partial<{
      year: number;
      group: ClosingGroup;
      q: string;
      yearStatus: AccountingYearFilter;
      observationStatus: AccountingObservationFilter;
      periodStatus: AccountingPeriodStatusFilter;
      periodMonth: AccountingMonthFilter;
    }>,
  ): string {
    const next = {
      year,
      group,
      q,
      yearStatus,
      observationStatus,
      periodStatus,
      periodMonth,
      ...overrides,
    };
    const query = new URLSearchParams({
      tab: "closings",
      year: String(next.year),
      group: next.group,
    });
    if (next.q) query.set("q", next.q);
    if (next.yearStatus !== "all") query.set("yearStatus", next.yearStatus);
    if (next.observationStatus !== "all") {
      query.set("observationStatus", next.observationStatus);
    }
    if (next.periodStatus !== "all") query.set("periodStatus", next.periodStatus);
    if (next.periodMonth !== "all") {
      query.set("periodMonth", String(next.periodMonth));
    }
    return `/clans/${clanId}?${query}`;
  }

  return (
    <div className="grid gap-5">
      <div className="grid gap-2">
        <ClanSectionHeading
          aside={
            <div className="flex items-center border-y border-border/80 bg-card/25">
              <Link
                href={href({ year: year - 1 })}
                className="flex size-10 items-center justify-center text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                aria-label={`Ver ${year - 1}`}
              >
                <ChevronLeft className="size-4" aria-hidden />
              </Link>
              <span className="flex h-10 min-w-20 items-center justify-center gap-2 px-2 font-mono text-sm font-semibold">
                <CalendarRange className="size-4 text-primary" aria-hidden />
                {year}
              </span>
              <Link
                href={href({ year: year + 1 })}
                className="flex size-10 items-center justify-center text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                aria-label={`Ver ${year + 1}`}
              >
                <ChevronRight className="size-4" aria-hidden />
              </Link>
            </div>
          }
        >
          Fechamentos
        </ClanSectionHeading>
        <p className="max-w-xl text-sm text-muted-foreground">
          Abra uma empresa para registrar períodos fechados, observações e o
          encerramento anual.
        </p>
      </div>

      <nav
        aria-label="Regime das empresas"
        className="grid grid-cols-3 border-y border-border/80 bg-card/20"
      >
        {CLOSING_GROUPS.map((item) => (
          <Link
            key={item.key}
            href={href({
              group: item.key,
              yearStatus: "all",
              observationStatus: "all",
              periodStatus: "all",
              periodMonth: "all",
              q: "",
            })}
            aria-current={group === item.key ? "page" : undefined}
            className={cn(
              "relative min-h-11 px-2 py-2 text-center text-xs font-medium transition-colors sm:text-sm",
              group === item.key
                ? "bg-primary/8 text-foreground after:absolute after:inset-x-4 after:bottom-0 after:h-0.5 after:bg-primary"
                : "text-muted-foreground hover:bg-muted/30 hover:text-foreground",
            )}
          >
            <span className="sm:hidden">{item.shortLabel}</span>
            <span className="hidden sm:inline">{item.label}</span>
          </Link>
        ))}
      </nav>

      <section className="panel-cut texture-iron grid gap-4 p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="hud-label">Encerramento anual de {year}</p>
            <p className="mt-1 text-xl font-semibold">
              {closedCount} de {allCompanies.length} empresas fechadas
            </p>
          </div>
          <Badge className="border-primary/25 bg-primary/10 font-mono text-primary">
            {progress}%
          </Badge>
        </div>
        <Progress value={progress} className="h-2" />
        <div className="grid grid-cols-2 gap-2 text-center font-mono text-xs sm:grid-cols-4">
          <div>
            <p className="text-lg font-semibold text-foreground">{openCount}</p>
            <p className="text-muted-foreground">anos em aberto</p>
          </div>
          <div>
            <p className={cn("text-lg font-semibold", noPeriodCount && "text-warning")}>
              {noPeriodCount}
            </p>
            <p className="text-muted-foreground">sem períodos no ano</p>
          </div>
          <div>
            <p className={cn("text-lg font-semibold", notesCount && "text-warning")}>
              {notesCount}
            </p>
            <p className="text-muted-foreground">com pendência</p>
          </div>
          <div>
            <p
              className={cn(
                "text-lg font-semibold",
                defisPendingCount && "text-warning",
              )}
            >
              {group === "simples" ? defisPendingCount : closedCount}
            </p>
            <p className="text-muted-foreground">
              {group === "simples" ? "DEFIS pendentes" : "anos fechados"}
            </p>
          </div>
        </div>
      </section>

      <form
        action={`/clans/${clanId}`}
        method="get"
        className="panel-cut grid gap-4 border bg-card/20 p-4"
      >
        <input type="hidden" name="tab" value="closings" />
        <input type="hidden" name="year" value={year} />
        <input type="hidden" name="group" value={group} />
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3>Encontrar empresas</h3>
            <p className="text-sm text-muted-foreground">
              Escolha os critérios e aplique todos de uma vez.
            </p>
          </div>
          <p className="font-mono text-sm text-muted-foreground">
            {companies.length} {companies.length === 1 ? "empresa" : "empresas"}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <div className="grid gap-1.5">
            <Label htmlFor="closing-year-filter">Encerramento anual</Label>
            <Select name="yearStatus" defaultValue={yearStatus}>
              <SelectTrigger id="closing-year-filter" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="open">Ano em aberto</SelectItem>
                <SelectItem value="completed">Ano fechado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="closing-period-status-filter">Períodos no ano</Label>
            <Select name="periodStatus" defaultValue={periodStatus}>
              <SelectTrigger id="closing-period-status-filter" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Com ou sem períodos</SelectItem>
                <SelectItem value="some">Com períodos lançados</SelectItem>
                <SelectItem value="none">Sem períodos lançados</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="closing-month-filter">Mês de fechamento</Label>
            <Select
              name="periodMonth"
              defaultValue={String(periodMonth)}
            >
              <SelectTrigger id="closing-month-filter" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os meses</SelectItem>
                <SelectItem value="unknown">
                  Mês não informado (registro antigo)
                </SelectItem>
                {ACCOUNTING_PERIOD_MONTHS.map((month, index) => (
                  <SelectItem key={month} value={String(index + 1)}>
                    {month}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="closing-observation-filter">Observações</Label>
            <Select name="observationStatus" defaultValue={observationStatus}>
              <SelectTrigger id="closing-observation-filter" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="with">Com observação</SelectItem>
                <SelectItem value="without">Sem observação</SelectItem>
                <SelectItem value="pending">Com pendência aberta</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="closing-search">Buscar</Label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                id="closing-search"
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Empresa ou período"
                className="w-full pl-8"
              />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border/70 pt-3">
          <Button type="submit">Aplicar filtros</Button>
          <Button asChild variant="outline">
            <Link
              href={href({
                yearStatus: "all",
                periodStatus: "all",
                periodMonth: "all",
                observationStatus: "all",
                q: "",
              })}
            >
              Limpar filtros
            </Link>
          </Button>
          <span className="text-xs text-muted-foreground">
            As opções selecionadas são combinadas.
          </span>
        </div>
      </form>

      {companies.length > 0 ? (
        <CompanyClosingBoard
          clanId={clanId}
          companies={companies}
          year={year}
          members={memberRows}
          viewerCanManage={canManage}
        />
      ) : (
        <ClanEmptyState
          icon={<Building2 className="size-7" aria-hidden />}
          title={allCompanies.length === 0
            ? "Nenhuma empresa neste grupo"
            : "Nenhuma empresa com estes filtros"}
          description={allCompanies.length === 0
            ? "Cadastre uma empresa para começar."
            : "A combinação atual não encontrou empresas. Ajuste os filtros ou use Limpar filtros."}
          className="relative"
        />
      )}
      {companies.length === 0 && allCompanies.length === 0 ? (
        <div className="-mt-12 flex justify-center pb-5">
            <Link
              href="/clients"
              className="font-mono text-xs text-primary hover:underline"
            >
              ir para clientes →
            </Link>
        </div>
      ) : null}
    </div>
  );
}
