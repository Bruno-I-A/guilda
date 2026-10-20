"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import * as schema from "@/db/schema";
import { XML_ROUTINE_FREQUENCIES, XML_ROUTINE_TIME_PATTERN } from "@/domain/nfse-xml";
import { err, type ActionResult } from "@/lib/action-context";
import { setNfseIssuer } from "@/lib/fiscal/nfse-issuer";
import { vaultEnvelopeSchema } from "@/lib/nfse/vault";
import { loadClientXmlMonths, loadVaultPublicKey } from "@/lib/nfse/xml-requests";
import { asFiscalOperator } from "@/lib/office-fees/fiscal-operator";
import { and, eq } from "drizzle-orm";

const clientSchema = z.object({ clanId: z.uuid("Clã inválido."), clientId: z.uuid("Empresa inválida.") });

function revalidateClan() {
  revalidatePath("/clans/[id]", "page");
}

/** Recebe só o envelope cifrado no navegador: certificado e senha nunca chegam aqui. */
export async function uploadClientCertificate(input: z.input<typeof clientSchema> & { envelope: unknown }): Promise<ActionResult<null>> {
  const parsed = clientSchema.extend({ envelope: vaultEnvelopeSchema }).safeParse(input);
  if (!parsed.success) return err("Envio do certificado inválido. Recarregue a página e tente de novo.");
  const { clanId, clientId, envelope } = parsed.data;
  const result = await asFiscalOperator(clanId, async (tx, ctx) => {
    const [company] = await tx
      .select({ id: schema.clients.id })
      .from(schema.clients)
      .where(and(eq(schema.clients.orgId, ctx.orgId), eq(schema.clients.id, clientId)));
    if (!company) return err("Empresa não encontrada.");
    const vault = await loadVaultPublicKey(tx, ctx.orgId);
    if (!vault) return err("O serviço fiscal ainda não está pronto para receber certificados.");
    if (vault.keyId !== envelope.keyId) return err("A chave do serviço fiscal mudou. Recarregue a página e envie de novo.");
    const c = schema.nfseClientCertificates;
    const fresh = { envelope, status: "pending" as const, statusMessage: null, certificateCnpj: null, validUntil: null, checkedAt: null, uploadedBy: ctx.userId, uploadedAt: new Date() };
    await tx
      .insert(c)
      .values({ orgId: ctx.orgId, clientId, ...fresh })
      .onConflictDoUpdate({ target: [c.orgId, c.clientId], set: fresh });
    return { ok: true, data: null };
  });
  if (result.ok) revalidateClan();
  return result;
}

export async function removeClientCertificate(input: z.input<typeof clientSchema>): Promise<ActionResult<null>> {
  const parsed = clientSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Pedido inválido.");
  const { clanId, clientId } = parsed.data;
  const result = await asFiscalOperator(clanId, async (tx, ctx) => {
    const c = schema.nfseClientCertificates;
    await tx.delete(c).where(and(eq(c.orgId, ctx.orgId), eq(c.clientId, clientId)));
    return { ok: true, data: null };
  });
  if (result.ok) revalidateClan();
  return result;
}

export async function listClientXmlMonths(
  input: z.input<typeof clientSchema>,
): Promise<ActionResult<{ year: number; month: number; total: number; cancelled: number }[]>> {
  const parsed = clientSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Pedido inválido.");
  return asFiscalOperator(parsed.data.clanId, async (tx, ctx) => ({
    ok: true,
    data: await loadClientXmlMonths(tx, { orgId: ctx.orgId, clientId: parsed.data.clientId }),
  }));
}

const routineSchema = z
  .object({
    clanId: z.uuid("Clã inválido."),
    enabled: z.boolean(),
    frequency: z.enum(XML_ROUTINE_FREQUENCIES),
    dayOfMonth: z.number().int().min(1).max(28).nullable(),
    time: z.string().regex(XML_ROUTINE_TIME_PATTERN, "Horário no formato 06:00."),
    keepSince: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mês no formato AAAA-MM.").nullable(),
  })
  .refine((value) => (value.frequency === "monthly") === (value.dayOfMonth !== null), {
    message: "Escolha o dia do mês (1 a 28) para a rotina mensal.",
    path: ["dayOfMonth"],
  });

export async function saveXmlRoutineSettings(input: z.input<typeof routineSchema>): Promise<ActionResult<null>> {
  const parsed = routineSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Configuração inválida.");
  const { clanId, enabled, frequency, dayOfMonth, time, keepSince } = parsed.data;
  const result = await asFiscalOperator(clanId, async (tx, ctx) => {
    const r = schema.nfseXmlRoutines;
    const values = { enabled, frequency, dayOfMonth, runTime: time, keepSince: keepSince ? `${keepSince}-01` : null, updatedBy: ctx.userId, updatedAt: new Date() };
    await tx.insert(r).values({ orgId: ctx.orgId, ...values }).onConflictDoUpdate({ target: r.orgId, set: values });
    return { ok: true, data: null };
  });
  if (result.ok) revalidateClan();
  return result;
}

export async function requestXmlRoutineRun(input: { clanId: string }): Promise<ActionResult<null>> {
  const parsed = z.object({ clanId: z.uuid("Clã inválido.") }).safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Pedido inválido.");
  const result = await asFiscalOperator(parsed.data.clanId, async (tx, ctx) => {
    if (!await loadVaultPublicKey(tx, ctx.orgId)) return err("O serviço fiscal ainda não está pronto para a rotina.");
    const r = schema.nfseXmlRoutines;
    const now = new Date();
    await tx.insert(r).values({ orgId: ctx.orgId, runRequestedAt: now }).onConflictDoUpdate({ target: r.orgId, set: { runRequestedAt: now } });
    return { ok: true, data: null };
  });
  if (result.ok) revalidateClan();
  return result;
}

/** "É de serviço? Sim · Não" da aba XML das notas: grava na Ficha Fiscal, com histórico. */
export async function setClientNfseIssuer(input: z.input<typeof clientSchema> & { issues: boolean }): Promise<ActionResult<null>> {
  const parsed = clientSchema.extend({ issues: z.boolean() }).safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Pedido inválido.");
  const { clanId, clientId, issues } = parsed.data;
  const result = await asFiscalOperator(clanId, async (tx, ctx) => {
    const change = await setNfseIssuer(tx, { orgId: ctx.orgId, clientId, actorId: ctx.userId, issues });
    if (change === "missing") return err("Empresa não encontrada.");
    if (change === "mei") return err("Empresas MEI são controladas na aba MEI.");
    return { ok: true, data: null };
  });
  if (result.ok) revalidateClan();
  return result;
}
