import { z } from "zod";

import { withOrgTx } from "@/db/org-tx";
import { canManageFiscalOperations } from "@/domain/guild-permissions";
import { emissionRangeLabel } from "@/domain/nfse-xml";
import { requireMemberContext } from "@/lib/action-context";
import { buildXmlArchive } from "@/lib/nfse/xml-archive";
import { loadXmlArchiveInput } from "@/lib/nfse/xml-requests";
import { requireFiscalClan } from "@/lib/office-fees/fiscal-clan";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  clanId: z.uuid(),
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  clientId: z.uuid().optional(),
});

function text(status: number, message: string): Response {
  return new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

/** XML das NFS-e prestadas do mês, da pasta guardada pela rotina. Sai do banco; não passa pelo serviço fiscal. */
export async function GET(request: Request): Promise<Response> {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return text(400, "Pedido inválido.");
  const query = parsed.data;
  const ctx = await requireMemberContext();
  if (!ctx.ok) return text(401, ctx.error);

  const loaded = await withOrgTx(ctx.orgId, async (tx) => {
    const fiscal = await requireFiscalClan(tx, { orgId: ctx.orgId, clanId: query.clanId, userId: ctx.userId, role: ctx.role });
    if (!fiscal || !canManageFiscalOperations(fiscal.facts)) return null;
    return loadXmlArchiveInput(tx, { orgId: ctx.orgId, year: query.year, month: query.month, clientId: query.clientId, now: new Date() });
  });
  if (!loaded) return text(403, "Sem permissão para os XML do Fiscal.");

  const month = String(query.month).padStart(2, "0");
  const archive = buildXmlArchive({
    baseName: `nfse-prestadas-${query.year}-${month}`,
    rangeLabel: emissionRangeLabel(query.year, query.month),
    singleCompany: Boolean(query.clientId),
    ...loaded,
  });
  return new Response(new Uint8Array(archive.body), {
    headers: {
      "Content-Type": archive.kind === "xml" ? "application/xml" : "application/zip",
      "Content-Disposition": `attachment; filename="${archive.fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
