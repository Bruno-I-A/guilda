import { and, asc, eq, gte, inArray, lte, type SQL } from "drizzle-orm";
import {
  Building2,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Search,
} from "lucide-react";
import Link from "next/link";

import { SegmentedNav } from "@/components/segmented-nav";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import {
  CLOSING_GROUPS,
  type ClosingGroup,
} from "@/lib/closings-ui";
import { cn } from "@/lib/utils";

import {
  CompanyClosingBoard,
  type CompanyClosingView,
} from "./closing-board";

type StatusFilter = "all" | "open" | "notes" | "completed";

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

function parseStatus(value: string | undefined): StatusFilter {
  return value === "open" || value === "notes" || value === "completed"
    ? value
    : "all";
}

export interface ClosingsTabParams {
  year?: string;
  group?: string;
  q?: string;
  status?: string;
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
}: {
  orgId: string;
  clanId: string;
  params: ClosingsTabParams;
}) {
  const year = parseYear(params.year);
  const group = parseGroup(params.group);
  const status = parseStatus(params.status);
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

  const { clients, closings, annualControls } = await withOrgTx(
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
      return { clients, closings, annualControls };
    },
  );

  const closingsByClient = new Map<string, CompanyClosingView["closings"]>();
  for (const closing of closings) {
    const list = closingsByClient.get(closing.clientId) ?? [];
    list.push({
      id: closing.id,
      clientId: closing.clientId,
      title: closing.title,
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
      return a.dueDate.localeCompare(b.dueDate);
    });
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
    };
  });

  function hasNotes(company: CompanyClosingView): boolean {
    return Boolean(
      company.yearNotes ||
        company.defisNotes ||
        company.closings.some((closing) => closing.notes),
    );
  }

  const normalizedQuery = q.toLocaleLowerCase("pt-BR");
  const companies = allCompanies.filter((company) => {
    const matchesQuery =
      !normalizedQuery ||
      company.name.toLocaleLowerCase("pt-BR").includes(normalizedQuery) ||
      company.yearNotes?.toLocaleLowerCase("pt-BR").includes(normalizedQuery) ||
      company.defisNotes?.toLocaleLowerCase("pt-BR").includes(normalizedQuery) ||
      company.closings.some(
        (closing) =>
          closing.title.toLocaleLowerCase("pt-BR").includes(normalizedQuery) ||
          closing.notes?.toLocaleLowerCase("pt-BR").includes(normalizedQuery),
      );
    if (!matchesQuery) return false;
    if (status === "open") return !company.yearClosedAt;
    if (status === "notes") return hasNotes(company);
    if (status === "completed") return Boolean(company.yearClosedAt);
    return true;
  });

  const closedCount = allCompanies.filter((company) => company.yearClosedAt).length;
  const openCount = allCompanies.length - closedCount;
  const notesCount = allCompanies.filter(hasNotes).length;
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
      status: StatusFilter;
    }>,
  ): string {
    const next = { year, group, q, status, ...overrides };
    const query = new URLSearchParams({
      tab: "closings",
      year: String(next.year),
      group: next.group,
    });
    if (next.q) query.set("q", next.q);
    if (next.status !== "all") query.set("status", next.status);
    return `/clans/${clanId}?${query}`;
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">
          Abra uma empresa para registrar períodos fechados, observações e o
          encerramento anual.
        </p>
        <div className="flex items-center rounded-lg border bg-muted/40 p-0.5">
          <Link
            href={href({ year: year - 1 })}
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
            aria-label={`Ver ${year - 1}`}
          >
            <ChevronLeft className="size-4" aria-hidden />
          </Link>
          <span className="flex h-8 min-w-20 items-center justify-center gap-2 px-2 font-mono text-sm font-semibold">
            <CalendarRange className="size-4 text-primary" aria-hidden />
            {year}
          </span>
          <Link
            href={href({ year: year + 1 })}
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
            aria-label={`Ver ${year + 1}`}
          >
            <ChevronRight className="size-4" aria-hidden />
          </Link>
        </div>
      </div>

      <SegmentedNav
        label="Regime das empresas"
        active={group}
        items={CLOSING_GROUPS.map((item) => ({
          key: item.key,
          label: item.label,
          shortLabel: item.shortLabel,
          href: href({ group: item.key, status: "all", q: "" }),
        }))}
      />

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
        <div className="grid grid-cols-3 gap-2 text-center font-mono text-xs">
          <div>
            <p className="text-lg font-semibold text-foreground">{openCount}</p>
            <p className="text-muted-foreground">anos em aberto</p>
          </div>
          <div>
            <p className={cn("text-lg font-semibold", notesCount && "text-warning")}>
              {notesCount}
            </p>
            <p className="text-muted-foreground">com observação</p>
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

      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedNav
          label="Filtrar por situação"
          active={status}
          items={(
            [
              ["all", "Todas"],
              ["open", "Ano em aberto"],
              ["notes", "Com observação"],
              ["completed", "Ano fechado"],
            ] as const
          ).map(([key, label]) => ({ key, label, href: href({ status: key }) }))}
        />
        <form className="relative" action={`/clans/${clanId}`}>
          <input type="hidden" name="tab" value="closings" />
          <input type="hidden" name="year" value={year} />
          <input type="hidden" name="group" value={group} />
          {status !== "all" ? (
            <input type="hidden" name="status" value={status} />
          ) : null}
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Buscar empresa ou período…"
            className="w-64 pl-8"
            aria-label="Buscar empresa ou período"
          />
        </form>
      </div>

      {companies.length > 0 ? (
        <CompanyClosingBoard companies={companies} year={year} />
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center">
          <Building2 className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">
            {allCompanies.length === 0
              ? "Nenhuma empresa neste grupo"
              : "Nenhuma empresa com estes filtros"}
          </p>
          <p className="max-w-md text-sm text-muted-foreground">
            {allCompanies.length === 0
              ? "Cadastre uma empresa para começar."
              : "Ajuste a busca ou selecione outra situação."}
          </p>
          {allCompanies.length === 0 ? (
            <Link
              href="/clients"
              className="font-mono text-xs text-primary hover:underline"
            >
              ir para clientes →
            </Link>
          ) : null}
        </div>
      )}
    </div>
  );
}
