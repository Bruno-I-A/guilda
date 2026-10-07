import { and, asc, eq, gte, lte } from "drizzle-orm";
import { CalendarRange, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import type { OverviewClosing, OverviewCompany } from "@/domain/closing-overview";
import { currentAppYear } from "@/lib/date-time";

import { ClosingHealthReading } from "./closing-health";

function parseYear(value: string | undefined): number {
  const year = Number(value);
  return Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : currentAppYear();
}

/**
 * Saúde das empresas, no espaço do Fiscal: a mesma leitura dos números da
 * aba Fechamentos (prejuízo, caixa no vermelho, empréstimo de sócio), para
 * quem controla a emissão de notas enxergar quem está no vermelho.
 *
 * Todas as empresas ativas do escritório (decisão do Bruno), e só leitura:
 * quem lança e corrige os números é a Contabilidade. Por isso o nome da
 * empresa não leva à aba Fechamentos.
 */
export async function FiscalHealthTab({
  orgId,
  clanId,
  requestedYear,
}: {
  orgId: string;
  clanId: string;
  requestedYear?: string;
}) {
  const year = parseYear(requestedYear);

  const { clients, closings } = await withOrgTx(orgId, async (tx) => {
    const clients = await tx
      .select({ id: schema.clients.id, name: schema.clients.name })
      .from(schema.clients)
      .where(and(eq(schema.clients.orgId, orgId), eq(schema.clients.active, true)))
      .orderBy(asc(schema.clients.name));
    const closings = await tx
      .select({
        clientId: schema.accountingClosings.clientId,
        status: schema.accountingClosings.status,
        periodMonth: schema.accountingClosings.periodMonth,
        dueDate: schema.accountingClosings.dueDate,
        cashBalance: schema.accountingClosings.cashBalance,
        periodResult: schema.accountingClosings.periodResult,
        shareholderLoan: schema.accountingClosings.shareholderLoan,
      })
      .from(schema.accountingClosings)
      .where(
        and(
          eq(schema.accountingClosings.orgId, orgId),
          gte(schema.accountingClosings.dueDate, `${year}-01-01`),
          lte(schema.accountingClosings.dueDate, `${year}-12-31`),
        ),
      );
    return { clients, closings };
  });

  const byClient = new Map<string, OverviewClosing[]>();
  for (const { clientId, ...closing } of closings) {
    const list = byClient.get(clientId) ?? [];
    list.push(closing);
    byClient.set(clientId, list);
  }
  const companies: OverviewCompany[] = clients.map((client) => ({
    id: client.id,
    name: client.name,
    // A leitura dos números não olha o encerramento anual.
    yearClosedAt: null,
    closings: byClient.get(client.id) ?? [],
  }));

  const yearHref = (target: number) =>
    `/clans/${clanId}?tab=portfolio&fiscalView=health&fiscalYear=${target}`;

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-sm text-muted-foreground">
          Os números que a Contabilidade lança em cada fechamento, para o Fiscal
          enxergar quem está no vermelho antes de emitir notas. Só leitura.
        </p>
        <div className="flex items-center border-y border-border/80 bg-card/25">
          <Link
            href={yearHref(year - 1)}
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
            href={yearHref(year + 1)}
            className="flex size-10 items-center justify-center text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
            aria-label={`Ver ${year + 1}`}
          >
            <ChevronRight className="size-4" aria-hidden />
          </Link>
        </div>
      </div>
      <ClosingHealthReading year={year} companies={companies} />
    </div>
  );
}
