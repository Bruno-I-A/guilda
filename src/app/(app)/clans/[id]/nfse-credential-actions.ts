"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import * as schema from "@/db/schema";
import { CREDENTIAL_MODES } from "@/domain/nfse-credentials";
import { err, type ActionResult } from "@/lib/action-context";
import { requestProxyTestFor, setClientModeIn, setDefaultModeIn } from "@/lib/nfse/credentials-repository";
import { asFiscalOperator } from "@/lib/office-fees/fiscal-operator";

/**
 * Procuração (decisão de 2026-11-18): o padrão do escritório, a exceção de
 * cada empresa e o pedido de teste. O app só grava; quem fala com o Sistema
 * Nacional é o serviço fiscal.
 */

const clan = z.uuid("Clã inválido.");
const mode = z.enum(CREDENTIAL_MODES);

function revalidateClan() {
  revalidatePath("/clans/[id]", "page");
}

const defaultSchema = z.object({ clanId: clan, mode });

/** Padrão do escritório para ler e emitir. Só admin: muda a credencial de todas as empresas. */
export async function setDefaultCredentialMode(input: z.input<typeof defaultSchema>): Promise<ActionResult<null>> {
  const parsed = defaultSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Pedido inválido.");
  const result = await asFiscalOperator(
    parsed.data.clanId,
    async (tx, ctx) => {
      await setDefaultModeIn(tx, ctx.orgId, { mode: parsed.data.mode, actorId: ctx.userId, now: new Date() });
      return { ok: true, data: null };
    },
    { adminOnly: true, adminOnlyMessage: "Só admins mudam o padrão do escritório." },
  );
  if (result.ok) revalidateClan();
  return result;
}

const clientModeSchema = z.object({ clanId: clan, clientId: z.uuid("Empresa inválida."), mode: mode.nullable() });

/** Exceção da empresa: procuração, certificado ou null (segue o padrão). */
export async function setClientCredentialMode(input: z.input<typeof clientModeSchema>): Promise<ActionResult<null>> {
  const parsed = clientModeSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Pedido inválido.");
  const { clanId, clientId } = parsed.data;
  const result = await asFiscalOperator(clanId, async (tx, ctx) => {
    const [company] = await tx
      .select({ taxRegime: schema.clients.taxRegime })
      .from(schema.clients)
      .where(and(eq(schema.clients.orgId, ctx.orgId), eq(schema.clients.id, clientId)));
    if (!company) return err("Empresa não encontrada.");
    if (company.taxRegime === "mei") return err("Empresas MEI são controladas na aba MEI.");
    await setClientModeIn(tx, ctx.orgId, { clientId, mode: parsed.data.mode, actorId: ctx.userId, now: new Date() });
    return { ok: true, data: null };
  });
  if (result.ok) revalidateClan();
  return result;
}

const testSchema = z.object({ clanId: clan, clientId: z.uuid("Empresa inválida.").optional() });

/** Pede o teste de procuração: sem empresa, para todas as de serviço. */
export async function requestProxyTest(input: z.input<typeof testSchema>): Promise<ActionResult<null>> {
  const parsed = testSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Pedido inválido.");
  const { clanId, clientId } = parsed.data;
  const result = await asFiscalOperator(clanId, async (tx, ctx) => {
    if (clientId) {
      const [company] = await tx
        .select({ id: schema.clients.id })
        .from(schema.clients)
        .where(and(eq(schema.clients.orgId, ctx.orgId), eq(schema.clients.id, clientId)));
      if (!company) return err("Empresa não encontrada.");
    }
    await requestProxyTestFor(tx, ctx.orgId, { clientId: clientId ?? null, actorId: ctx.userId, now: new Date() });
    return { ok: true, data: null };
  });
  if (result.ok) revalidateClan();
  return result;
}
