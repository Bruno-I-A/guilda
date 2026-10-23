import { strToU8, zipSync } from "fflate";
import { z } from "zod";

import { withOrgTx } from "@/db/org-tx";
import { canManageFiscalOperations } from "@/domain/guild-permissions";
import { requireMemberContext } from "@/lib/action-context";
import { loadClientDanfseXml } from "@/lib/client-nfse/loaders";
import { readDanfse } from "@/lib/nfse/danfse-data";
import { renderDanfsePdf } from "@/lib/nfse/danfse-pdf";
import { requireFiscalClan } from "@/lib/office-fees/fiscal-clan";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  clanId: z.uuid(),
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  issuerId: z.uuid().optional(),
  invoiceId: z.uuid().optional(),
});

function text(status: number, message: string): Response {
  return new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

/**
 * PDFs das notas dos clientes, montados aqui do XML guardado (o certificado é
 * da empresa, então o serviço fiscal do escritório não busca essas notas).
 * Uma nota baixa o PDF direto; mais de uma, um .zip com uma pasta por empresa.
 */
export async function GET(request: Request): Promise<Response> {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return text(400, "Pedido inválido.");
  const query = parsed.data;
  const ctx = await requireMemberContext();
  if (!ctx.ok) return text(401, ctx.error);

  const items = await withOrgTx(ctx.orgId, async (tx) => {
    const fiscal = await requireFiscalClan(tx, { orgId: ctx.orgId, clanId: query.clanId, userId: ctx.userId, role: ctx.role });
    if (!fiscal || !canManageFiscalOperations(fiscal.facts)) return null;
    return loadClientDanfseXml(tx, { orgId: ctx.orgId, ...query });
  });
  if (!items) return text(403, "Sem permissão para as notas do Fiscal.");
  if (items.length === 0) return text(404, "Nenhuma nota emitida neste mês.");

  const files: Record<string, Uint8Array> = {};
  const failures: string[] = [];
  for (const item of items) {
    try {
      if (!item.xml) throw new Error("o XML da nota ainda não chegou; tente depois da próxima leitura dos XML");
      files[item.fileName] = await renderDanfsePdf(readDanfse(item.xml));
    } catch (error) {
      failures.push(`${item.fileName}: ${error instanceof Error ? error.message : "falha ao montar o PDF"}`);
    }
  }
  if (items.length === 1) {
    const pdf = files[items[0].fileName];
    if (!pdf) return text(502, `Não foi possível montar o PDF (${failures[0] ?? "erro"}).`);
    return new Response(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${items[0].fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  }
  if (failures.length > 0) {
    files["LEIA-ME.txt"] = strToU8(`Não foi possível montar estes PDFs. Consulte as notas no Portal Nacional:\n\n${failures.join("\n")}\n`);
  }
  const month = String(query.month).padStart(2, "0");
  return new Response(Buffer.from(zipSync(files, { level: 0 })), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="notas-clientes-${query.year}-${month}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
