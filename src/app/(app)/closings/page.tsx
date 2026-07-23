import {
  and,
  asc,
  eq,
  ilike,
  inArray,
  type SQL,
} from "drizzle-orm";
import {
  Building2,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
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
  periodsForCadence,
  type ClosingGroup,
} from "@/lib/closings-ui";
import { requireOrgSession } from "@/lib/session";
import { cn } from "@/lib/utils";

import { ClosingBoard, type ClosingClientView } from "./closing-board";

export const metadata: Metadata = { title: "Fechamentos" };

type StatusFilter = "all" | "pending" | "completed";

function parseYear(value: string | undefined): number {
  const year = Number(value);
  return Number.isInteger(year) && year >= 2000 && year <= 2100
    ? year
    : new Date().getFullYear();
}

function parseGroup(value: string | undefined): ClosingGroup {
  return CLOSING_GROUPS.some((group) => group.key === value)
    ? (value as ClosingGroup)
    : "simples";
}

function parseStatus(value: string | undefined): StatusFilter {
  return value === "pending" || value === "completed" ? value : "all";
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
  if (q) clientConditions.push(ilike(schema.clients.name, `%${q}%`));

  const { clients, closings } = await withOrgTx(session.orgId, async (tx) => {
    const clients = await tx.query.clients.findMany({
      where: and(...clientConditions),
      orderBy: [asc(schema.clients.name)],
    });
    const closings = await tx.query.accountingClosings.findMany({
      where: and(
        eq(schema.accountingClosings.orgId, session.orgId),
        eq(schema.accountingClosings.year, year),
      ),
      with: {
        completedByUser: {
          columns: { name: true },
        },
      },
    });
    return { clients, closings };
  });

  const clientIds = new Set(clients.map((client) => client.id));
  const completionsByClient = new Map<
    string,
    ClosingClientView["completions"]
  >();
  for (const closing of closings) {
    if (!clientIds.has(closing.clientId)) continue;
    const current = completionsByClient.get(closing.clientId) ?? {};
    current[closing.period] = {
      completedAt: closing.completedAt.toISOString(),
      completedBy: closing.completedByUser.name,
    };
    completionsByClient.set(closing.clientId, current);
  }

  const allRows: ClosingClientView[] = clients.map((client) => ({
    id: client.id,
    name: client.name,
    taxRegime: client.taxRegime,
    closingCadence: client.closingCadence,
    completions: completionsByClient.get(client.id) ?? {},
  }));

  function completedPeriods(row: ClosingClientView): number {
    return periodsForCadence(row.closingCadence).filter(
      (period) => row.completions[period],
    ).length;
  }

  function isClientCompleted(row: ClosingClientView): boolean {
    return completedPeriods(row) === periodsForCadence(row.closingCadence).length;
  }

  const rows = allRows.filter((row) => {
    if (status === "completed") return isClientCompleted(row);
    if (status === "pending") return !isClientCompleted(row);
    return true;
  });
  const expectedPeriodCount = allRows.reduce(
    (sum, row) => sum + periodsForCadence(row.closingCadence).length,
    0,
  );
  const completedPeriodCount = allRows.reduce(
    (sum, row) => sum + completedPeriods(row),
    0,
  );
  const completedClientCount = allRows.filter(isClientCompleted).length;
  const progress =
    expectedPeriodCount === 0
      ? 0
      : Math.round((completedPeriodCount / expectedPeriodCount) * 100);

  function href(
    overrides: Partial<{
      year: number;
      group: ClosingGroup;
      q: string;
      status: StatusFilter;
    }>,
  ): string {
    const next = {
      year,
      group,
      q,
      status,
      ...overrides,
    };
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
            Controle anual da carteira, empresa por empresa.
          </p>
        </div>
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

      <nav
        aria-label="Regime das empresas"
        className="grid grid-cols-3 rounded-lg border bg-muted/40 p-0.5"
      >
        {CLOSING_GROUPS.map((item) => (
          <Link
            key={item.key}
            href={href({ group: item.key, status: "all" })}
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
            <p className="hud-label">Progresso de {year}</p>
            <p className="mt-1 text-xl font-semibold">
              {completedClientCount} de {allRows.length} empresas finalizadas
            </p>
          </div>
          <Badge className="border-primary/25 bg-primary/10 font-mono text-primary">
            {completedPeriodCount}/{expectedPeriodCount} períodos
          </Badge>
        </div>
        <Progress value={progress} className="h-2" />
        <div className="flex items-center justify-between font-mono text-xs text-muted-foreground">
          <span>{progress}% concluído</span>
          <span>
            {allRows.length - completedClientCount}{" "}
            {allRows.length - completedClientCount === 1
              ? "empresa pendente"
              : "empresas pendentes"}
          </span>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav
          aria-label="Filtrar por situação"
          className="flex rounded-lg border bg-muted/40 p-0.5"
        >
          {(
            [
              ["all", "Todas"],
              ["pending", "Pendentes"],
              ["completed", "Concluídas"],
            ] as const
          ).map(([key, label]) => (
            <Link
              key={key}
              href={href({ status: key })}
              aria-current={status === key ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
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
            placeholder="Buscar empresa…"
            className="w-56 pl-8"
            aria-label="Buscar empresa por nome"
          />
        </form>
      </div>

      {rows.length > 0 ? (
        <ClosingBoard clients={rows} year={year} />
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center">
          <Building2 className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">
            {allRows.length === 0
              ? "Nenhuma empresa neste grupo"
              : "Nenhuma empresa com estes filtros"}
          </p>
          <p className="max-w-md text-sm text-muted-foreground">
            {allRows.length === 0
              ? "Cadastre as empresas e informe o regime e a periodicidade de cada uma."
              : "Ajuste a busca ou selecione outra situação."}
          </p>
          {allRows.length === 0 ? (
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
