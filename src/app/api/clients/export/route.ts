import { and, asc, desc, eq, inArray, type SQL } from "drizzle-orm";
import { z } from "zod";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { isAdminRole } from "@/domain/guild-permissions";
import { requireMemberContext } from "@/lib/action-context";
import { buildClientsWorkbook } from "@/lib/clients/export-workbook";
import { TAX_REGIMES } from "@/lib/clients-ui";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  // `?regime=simples&regime=mei`: um ou mais regimes; nenhum = todos.
  regimes: z.array(z.enum(TAX_REGIMES)).max(TAX_REGIMES.length),
  inativas: z.enum(["1"]).optional(),
});

function text(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function today(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Planilha .xlsx com o cadastro das empresas-cliente, para cadastrá-las em
 * outro sistema. Leva os regimes escolhidos na janela de exportação e, por
 * padrão, só as ativas; `inativas=1` inclui as inativas.
 *
 * Só admin e owner: é a base de clientes inteira, com contatos e sócios, de
 * uma vez — o mesmo degrau da importação por planilha.
 */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse({
    regimes: params.getAll("regime"),
    inativas: params.get("inativas") ?? undefined,
  });
  if (!parsed.success) return text(400, "Pedido inválido.");
  const query = parsed.data;

  const ctx = await requireMemberContext();
  if (!ctx.ok) return text(401, ctx.error);
  if (!isAdminRole(ctx.role)) {
    return text(403, "Apenas admin ou owner pode exportar as empresas.");
  }

  const conditions: SQL[] = [eq(schema.clients.orgId, ctx.orgId)];
  if (!query.inativas) conditions.push(eq(schema.clients.active, true));
  if (query.regimes.length > 0) {
    conditions.push(inArray(schema.clients.taxRegime, query.regimes));
  }

  const rows = await withOrgTx(ctx.orgId, (tx) =>
    tx
      .select({
        client: schema.clients,
        fiscalOwnerName: schema.user.name,
      })
      .from(schema.clients)
      .leftJoin(
        schema.fiscalPortfolios,
        and(
          eq(schema.fiscalPortfolios.orgId, schema.clients.orgId),
          eq(schema.fiscalPortfolios.clientId, schema.clients.id),
        ),
      )
      .leftJoin(schema.user, eq(schema.user.id, schema.fiscalPortfolios.userId))
      .where(and(...conditions))
      .orderBy(desc(schema.clients.active), asc(schema.clients.name)),
  );

  const buffer = await buildClientsWorkbook(
    rows.map(({ client, fiscalOwnerName }) => ({ ...client, fiscalOwnerName })),
  );

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="empresas-guilda-${today()}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
