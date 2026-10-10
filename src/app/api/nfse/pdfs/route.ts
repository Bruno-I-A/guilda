import { z } from "zod";

import { withOrgTx } from "@/db/org-tx";
import { canManageFiscalOperations } from "@/domain/guild-permissions";
import { requireMemberContext } from "@/lib/action-context";
import { loadDanfseItems } from "@/lib/nfse/requests";
import { requireFiscalClan } from "@/lib/office-fees/fiscal-clan";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  clanId: z.uuid(),
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  invoiceId: z.uuid().optional(),
});

function text(status: number, message: string): Response {
  return new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

/**
 * Pede ao serviço fiscal, pela rede interna, o .zip com os PDFs das notas
 * emitidas do mês (ou de uma nota) e repassa em streaming. Nada é gravado.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return text(400, "Pedido inválido.");
  const query = parsed.data;
  const ctx = await requireMemberContext();
  if (!ctx.ok) return text(401, ctx.error);

  const items = await withOrgTx(ctx.orgId, async (tx) => {
    const fiscal = await requireFiscalClan(tx, { orgId: ctx.orgId, clanId: query.clanId, userId: ctx.userId, role: ctx.role });
    if (!fiscal || !canManageFiscalOperations(fiscal.facts)) return null;
    return loadDanfseItems(tx, { orgId: ctx.orgId, year: query.year, month: query.month, invoiceId: query.invoiceId });
  });
  if (!items) return text(403, "Sem permissão para as notas do Fiscal.");
  if (items.length === 0) return text(404, "Nenhuma nota emitida neste mês.");

  const serviceUrl = process.env.FISCAL_SERVICE_URL;
  const token = process.env.FISCAL_SERVICE_TOKEN;
  if (!serviceUrl || !token) return text(503, "Serviço fiscal não configurado.");
  let upstream: Response;
  try {
    upstream = await fetch(`${serviceUrl.replace(/\/$/, "")}/danfse.zip`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    return text(502, "O serviço fiscal não respondeu.");
  }
  if (!upstream.ok || !upstream.body) return text(502, `O serviço fiscal recusou o pedido (${upstream.status}).`);
  const month = String(query.month).padStart(2, "0");
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="notas-honorario-${query.year}-${month}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
