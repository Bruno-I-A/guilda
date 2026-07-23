import {
  and,
  asc,
  eq,
  gte,
  inArray,
  lte,
  type SQL,
} from "drizzle-orm";
import {
  Building2,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Search,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import {
  CLOSING_GROUPS,
  isClosingOverdue,
  type ClosingGroup,
} from "@/lib/closings-ui";
import { requireOrgSession } from "@/lib/session";
import { cn } from "@/lib/utils";

import {
  ClosingBoard,
  type ClosingClientOption,
  type ClosingView,
  NewClosingButton,
} from "./closing-board";

export const metadata: Metadata = { title: "Fechamentos" };

type StatusFilter = "all" | "open" | "blocked" | "completed";

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
  return value === "open" || value === "blocked" || value === "completed"
    ? value
    : "all";
}

export default async function ClosingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    year?: string;
    group?: string;
    q?: string;
    status?: string;
  }>;
}) {
  const session = await requireOrgSession();
  const params = await searchParams;
  const year = parseYear(params.year);
  const group = parseGroup(params.group);
  const status = parseStatus(params.status);
  const q = (params.q ?? "").trim();
  const today = todayInSaoPaulo();

  const clientConditions: SQL[] = [
    eq(schema.clients.orgId, session.orgId),
    eq(schema.clients.active, true),
  ];
  if (group === "presumido_association") {
    clientConditions.push(
      inArray(schema.clients.taxRegime, ["presumido", "association"]),
    );
  } else {
    clientConditions.push(eq(schema.clients.taxRegime, group));
  }

  const { clients, closings } = await withOrgTx(session.orgId, async (tx) => {
    const clients = await tx.query.clients.findMany({
      where: and(...clientConditions),
      orderBy: [asc(schema.clients.name)],
    });
    const closings = await tx.query.accountingClosings.findMany({
      where: and(
        eq(schema.accountingClosings.orgId, session.orgId),
        gte(schema.accountingClosings.dueDate, `${year}-01-01`),
        lte(schema.accountingClosings.dueDate, `${year}-12-31`),
      ),
      with: {
        client: {
          columns: { name: true, taxRegime: true },
        },
        completedByUser: {
          columns: { name: true },
        },
      },
    });
    return { clients, closings };
  });

  const clientOptions: ClosingClientOption[] = clients.map((client) => ({
    id: client.id,
    name: client.name,
    taxRegime: client.taxRegime,
  }));
  const visibleClientIds = new Set(clientOptions.map((client) => client.id));

  const allRows: ClosingView[] = closings
    .filter((closing) => visibleClientIds.has(closing.clientId))
    .map((closing) => ({
      id: closing.id,
      clientId: closing.clientId,
      clientName: closing.client.name,
      taxRegime: closing.client.taxRegime,
      title: closing.title,
      dueDate: closing.dueDate,
      status: closing.status,
      notes: closing.notes,
      completedAt: closing.completedAt?.toISOString() ?? null,
      completedBy: closing.completedByUser?.name ?? null,
    }))
    .sort((a, b) => {
      if (a.status === "completed" && b.status !== "completed") return 1;
      if (a.status !== "completed" && b.status === "completed") return -1;
      return a.dueDate.localeCompare(b.dueDate) || a.clientName.localeCompare(b.clientName);
    });

  const normalizedQuery = q.toLocaleLowerCase("pt-BR");
  const rows = allRows.filter((row) => {
    const matchesQuery =
      !normalizedQuery ||
      row.clientName.toLocaleLowerCase("pt-BR").includes(normalizedQuery) ||
      row.title.toLocaleLowerCase("pt-BR").includes(normalizedQuery) ||
      row.notes?.toLocaleLowerCase("pt-BR").includes(normalizedQuery);
    if (!matchesQuery) return false;
    if (status === "open") return row.status !== "completed";
    if (status === "blocked") return row.status === "blocked";
    if (status === "completed") return row.status === "completed";
    return true;
  });

  const completedCount = allRows.filter((row) => row.status === "completed").length;
  const blockedCount = allRows.filter((row) => row.status === "blocked").length;
  const overdueCount = allRows.filter((row) =>
    isClosingOverdue(row.dueDate, row.status, today),
  ).length;
  const openCount = allRows.length - completedCount;
  const progress =
    allRows.length === 0 ? 0 : Math.round((completedCount / allRows.length) * 100);

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
      year: String(next.year),
      group: next.group,
    });
    if (next.q) query.set("q", next.q);
    if (next.status !== "all") query.set("status", next.status);
    return `/closings?${query}`;
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-wide">Fechamentos</h1>
          <p className="text-muted-foreground">
            Planeje cada fechamento conforme a necessidade e o prazo do cliente.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
          <NewClosingButton clients={clientOptions} year={year} />
        </div>
      </div>

      <nav
        aria-label="Regime das empresas"
        className="grid grid-cols-3 rounded-lg border bg-muted/40 p-0.5"
      >
        {CLOSING_GROUPS.map((item) => (
          <Link
            key={item.key}
            href={href({ group: item.key, status: "all", q: "" })}
            aria-current={group === item.key ? "page" : undefined}
            className={cn(
              "rounded-md px-2 py-2 text-center text-xs font-medium transition-colors sm:text-sm",
              group === item.key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
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
            <p className="hud-label">Andamento de {year}</p>
            <p className="mt-1 text-xl font-semibold">
              {completedCount} de {allRows.length} fechamentos concluídos
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
            <p className="text-muted-foreground">abertos</p>
          </div>
          <div>
            <p className={cn("text-lg font-semibold", overdueCount && "text-destructive")}>
              {overdueCount}
            </p>
            <p className="text-muted-foreground">atrasados</p>
          </div>
          <div>
            <p className={cn("text-lg font-semibold", blockedCount && "text-destructive")}>
              {blockedCount}
            </p>
            <p className="text-muted-foreground">com pendência</p>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav
          aria-label="Filtrar por situação"
          className="flex max-w-full overflow-x-auto rounded-lg border bg-muted/40 p-0.5"
        >
          {(
            [
              ["all", "Todos"],
              ["open", "Abertos"],
              ["blocked", "Com pendência"],
              ["completed", "Concluídos"],
            ] as const
          ).map(([key, label]) => (
            <Link
              key={key}
              href={href({ status: key })}
              aria-current={status === key ? "page" : undefined}
              className={cn(
                "whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                status === key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
        <form className="relative" action="/closings">
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
            placeholder="Buscar empresa ou fechamento…"
            className="w-64 pl-8"
            aria-label="Buscar empresa ou fechamento"
          />
        </form>
      </div>

      {rows.length > 0 ? (
        <ClosingBoard
          closings={rows}
          clients={clientOptions}
          year={year}
          today={today}
        />
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center">
          {clientOptions.length === 0 ? (
            <Building2 className="size-8 text-muted-foreground" aria-hidden />
          ) : (
            <ClipboardList className="size-8 text-muted-foreground" aria-hidden />
          )}
          <p className="font-medium">
            {clientOptions.length === 0
              ? "Nenhuma empresa neste grupo"
              : allRows.length === 0
                ? `Nenhum fechamento planejado para ${year}`
                : "Nenhum fechamento com estes filtros"}
          </p>
          <p className="max-w-md text-sm text-muted-foreground">
            {clientOptions.length === 0
              ? "Cadastre uma empresa para começar."
              : allRows.length === 0
                ? "Use “Novo fechamento” sempre que surgir uma demanda ou prazo do cliente."
                : "Ajuste a busca ou selecione outra situação."}
          </p>
          {clientOptions.length === 0 ? (
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
