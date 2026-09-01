import { and, asc, eq } from "drizzle-orm";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { parseMeiDeclarationYear } from "@/domain/mei-declaration";

import { MeiAnnualBoard } from "./mei-annual-board";

function calendarYearInSaoPaulo(): number {
  return Number(
    new Intl.DateTimeFormat("en", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
    }).format(new Date()),
  );
}

export async function MeiTab({
  orgId,
  clanId,
  canManage,
  requestedYear,
}: {
  orgId: string;
  clanId: string;
  canManage: boolean;
  requestedYear?: string;
}) {
  // A DASN-SIMEI entregue neste ano se refere, normalmente, ao ano-calendário
  // anterior. A navegação permite consultar e corrigir qualquer outro ano.
  const year = parseMeiDeclarationYear(
    requestedYear,
    calendarYearInSaoPaulo() - 1,
  );

  const rows = await withOrgTx(orgId, (tx) =>
    tx
      .select({
        clientId: schema.clients.id,
        clientName: schema.clients.name,
        cnpj: schema.clients.cnpj,
        status: schema.meiAnnualDeclarations.status,
        submittedAt: schema.meiAnnualDeclarations.submittedAt,
        notes: schema.meiAnnualDeclarations.notes,
        updatedAt: schema.meiAnnualDeclarations.updatedAt,
        updatedByName: schema.user.name,
      })
      .from(schema.clients)
      .leftJoin(
        schema.meiAnnualDeclarations,
        and(
          eq(schema.meiAnnualDeclarations.orgId, schema.clients.orgId),
          eq(schema.meiAnnualDeclarations.clientId, schema.clients.id),
          eq(schema.meiAnnualDeclarations.year, year),
        ),
      )
      .leftJoin(schema.user, eq(schema.user.id, schema.meiAnnualDeclarations.updatedBy))
      .where(
        and(
          eq(schema.clients.orgId, orgId),
          eq(schema.clients.active, true),
          eq(schema.clients.taxRegime, "mei"),
        ),
      )
      .orderBy(asc(schema.clients.name)),
  );

  return (
    <MeiAnnualBoard
      clanId={clanId}
      year={year}
      canManage={canManage}
      rows={rows.map((row) => ({
        ...row,
        status: row.status ?? "pending",
        updatedAt: row.updatedAt?.toISOString() ?? null,
      }))}
    />
  );
}
