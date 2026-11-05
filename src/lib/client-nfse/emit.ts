import "server-only";

import { and, eq } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { clientNfseMonthDescription, type ClientNfseReference } from "@/domain/client-nfse";
import { amountToCents, buildDpsId, buildNfseTakerAddress, centsToNfseAmount, type NfseClientAddress } from "@/domain/nfse";
import { err, type ActionResult } from "@/lib/action-context";
import { ibgeCityCode } from "@/lib/nfse/municipios";
import { NFSE_OPERATION_TYPE_REQUIRED, nfseServiceRequiresOperationType } from "@/lib/nfse/template";

import { hasNfseRetentions, type NfseRetentions } from "@/domain/nfse-retentions";

import { issuerTemplateFor, loadIssuerReadiness, requeueClientNfseInvoice, withRetentions } from "./month";
import { cleanAddress, saveClientNfseTaker, type AddressInput, type ServiceOverride } from "./registry";

type Actor = { orgId: string; actorId: string };

/**
 * Nota avulsa, o jeito normal de emitir: tomador (achado pelo CPF/CNPJ dentro
 * da empresa, ou cadastrado aqui), valor e descrição, e a nota vai para a
 * fila na hora. Quantas forem precisas, para quem for, no mês que for.
 *
 * Trava o emissor (numeração da DPS e cliques simultâneos) e grava a nota do
 * mês com a chave do formulário: o mesmo envio repetido devolve a nota que já
 * foi pedida, nunca uma segunda.
 */
export async function emitClientNfseNote(
  tx: OrgTx,
  input: Actor & {
    issuerId: string;
    requestId: string;
    taker: { document: string; name: string; address: AddressInput | null };
    amount: string;
    description: string;
    reference: ClientNfseReference;
    service: ServiceOverride | null;
    /**
     * Retenções desta nota (nulo = nenhuma). Ausente: valem as gravadas no
     * tomador. `rememberRetentions` grava as desta nota como as do tomador.
     */
    retentions?: NfseRetentions | null;
    rememberRetentions?: boolean;
    /** O mês da nota (o da emissão, em Brasília). */
    period: { year: number; month: number };
    now: Date;
  },
): Promise<ActionResult<{ invoiceId: string; repeated: boolean }>> {
  const issuers = schema.clientNfseIssuers;
  const [locked] = await tx
    .select({ id: issuers.id, nextDpsNumber: issuers.nextDpsNumber })
    .from(issuers)
    .where(and(eq(issuers.orgId, input.orgId), eq(issuers.id, input.issuerId)))
    .for("update");
  if (!locked) return err("Empresa emissora não encontrada.");

  const it = schema.clientNfseItems;
  const n = schema.clientNfseInvoices;
  const [already] = await tx
    .select({ invoiceId: n.id })
    .from(it)
    .innerJoin(n, and(eq(n.orgId, it.orgId), eq(n.itemId, it.id)))
    .where(and(eq(it.orgId, input.orgId), eq(it.requestId, input.requestId)))
    .limit(1);
  if (already) return { ok: true, data: { invoiceId: already.invoiceId, repeated: true } };

  const issuer = (await loadIssuerReadiness(tx, { orgId: input.orgId, issuerIds: [input.issuerId], now: input.now })).get(input.issuerId);
  if (!issuer?.template || issuer.problem) return err(issuer?.problem ?? "A empresa não está pronta para emitir.");
  let cents: number;
  try {
    cents = amountToCents(input.amount);
  } catch {
    return err("Valor inválido.");
  }
  if (cents <= 0) return err("Informe o valor da nota.");
  const description = clientNfseMonthDescription(input.description.trim(), input.period, input.reference).trim();
  if (!description) return err("Escreva a descrição da nota.");

  const taker = await saveClientNfseTaker(tx, {
    orgId: input.orgId,
    actorId: input.actorId,
    issuerId: input.issuerId,
    takerId: await existingTakerId(tx, input.orgId, input.issuerId, input.taker.document),
    name: input.taker.name,
    document: input.taker.document,
    address: input.taker.address,
    active: true,
  });
  if (!taker.ok) return taker;
  const takerId = taker.data!.takerId;
  const [stored] = await tx
    .select({ name: schema.clientNfseTakers.name, address: schema.clientNfseTakers.address, retentions: schema.clientNfseTakers.retentions })
    .from(schema.clientNfseTakers)
    .where(and(eq(schema.clientNfseTakers.orgId, input.orgId), eq(schema.clientNfseTakers.id, takerId)));
  const retentions = input.retentions === undefined ? (stored?.retentions ?? null) : input.retentions;
  if (input.rememberRetentions && input.retentions !== undefined) {
    await tx
      .update(schema.clientNfseTakers)
      .set({ retentions: hasNfseRetentions(retentions) ? retentions : null, updatedBy: input.actorId, updatedAt: input.now })
      .where(and(eq(schema.clientNfseTakers.orgId, input.orgId), eq(schema.clientNfseTakers.id, takerId)));
  }
  const template = withRetentions(issuerTemplateFor(issuer.template, input.service), hasNfseRetentions(retentions) ? retentions : null, cents);
  // Serviço próprio da nota escapa da regra dos dados fiscais: confere aqui.
  if (template.ibsCbs && !template.ibsCbs.operationType && nfseServiceRequiresOperationType(template.service.nationalTaxCode)) {
    return err(NFSE_OPERATION_TYPE_REQUIRED);
  }
  if (template.issqn.withholding === "2" && !template.issqn.rate) {
    return err("Com ISS retido, informe a alíquota do ISS.");
  }
  const takerAddress = buildNfseTakerAddress((stored?.address ?? null) as NfseClientAddress | null, ibgeCityCode);
  if (template.ibsCbs && !takerAddress) {
    return err("O endereço do tomador está incompleto (rua, bairro, CEP e cidade). Complete e emita de novo.");
  }

  const amount = centsToNfseAmount(cents);
  const [item] = await tx
    .insert(it)
    .values({
      orgId: input.orgId,
      modelId: null,
      requestId: input.requestId,
      issuerId: input.issuerId,
      takerId,
      periodYear: input.period.year,
      periodMonth: input.period.month,
      amount,
      description,
      createdBy: input.actorId,
      updatedBy: input.actorId,
    })
    .returning({ id: it.id });
  const number = locked.nextDpsNumber;
  await tx.update(issuers).set({ nextDpsNumber: number + 1 }).where(and(eq(issuers.orgId, input.orgId), eq(issuers.id, input.issuerId)));
  const [invoice] = await tx
    .insert(n)
    .values({
      orgId: input.orgId,
      issuerId: input.issuerId,
      clientId: issuer.clientId,
      takerId,
      itemId: item.id,
      periodYear: input.period.year,
      periodMonth: input.period.month,
      amount,
      providerCnpj: issuer.cnpj!,
      template,
      takerDocument: input.taker.document,
      takerName: stored?.name ?? input.taker.name,
      takerAddress,
      description,
      dpsSeries: issuer.dpsSeries,
      dpsNumber: number,
      dpsId: buildDpsId({ cityCode: template.cityCode, cnpj: issuer.cnpj!, series: issuer.dpsSeries, number }),
      requestedBy: input.actorId,
    })
    .returning({ id: n.id });
  await tx.insert(schema.clientNfseInvoiceEvents).values({ orgId: input.orgId, invoiceId: invoice.id, eventType: "requested", actorId: input.actorId });
  return { ok: true, data: { invoiceId: invoice.id, repeated: false } };
}

/**
 * Corrige o endereço de uma nota com erro: grava no cadastro do tomador (as
 * próximas notas dele já saem certas) e devolve a nota à fila, que relê o
 * endereço e mantém o número da DPS. Valor e descrição seguem congelados.
 */
export async function retryClientNfseWithAddress(
  tx: OrgTx,
  input: Actor & { invoiceId: string; address: AddressInput },
): Promise<ActionResult> {
  const n = schema.clientNfseInvoices;
  const [invoice] = await tx
    .select({ status: n.status, takerId: n.takerId })
    .from(n)
    .where(and(eq(n.orgId, input.orgId), eq(n.id, input.invoiceId)))
    .for("update");
  if (!invoice) return err("Nota não encontrada.");
  if (invoice.status !== "failed") return err("Só uma nota com erro volta para a fila.");
  const address = cleanAddress(input.address);
  if (address?.zipCode?.length !== 8) return err("O CEP precisa ter 8 dígitos.");
  if (!buildNfseTakerAddress(address as NfseClientAddress, ibgeCityCode)) {
    return err("Confira rua, bairro, cidade e UF: a cidade precisa existir nessa UF.");
  }
  const t = schema.clientNfseTakers;
  await tx
    .update(t)
    .set({ address, updatedBy: input.actorId, updatedAt: new Date() })
    .where(and(eq(t.orgId, input.orgId), eq(t.id, invoice.takerId)));
  return requeueClientNfseInvoice(tx, { orgId: input.orgId, actorId: input.actorId, invoiceId: input.invoiceId });
}

/**
 * Corrige o serviço de uma nota com erro (código que o município não tem, por
 * exemplo) e a devolve à fila. "Tentar de novo" sozinho mantém o serviço do
 * pedido; `applyToIssuer` grava também nos dados fiscais da empresa, para as
 * próximas notas não repetirem o erro.
 */
export async function retryClientNfseWithService(
  tx: OrgTx,
  input: Actor & { invoiceId: string; service: ServiceOverride; applyToIssuer: boolean },
): Promise<ActionResult> {
  const n = schema.clientNfseInvoices;
  const [invoice] = await tx
    .select({ status: n.status, template: n.template, issuerId: n.issuerId })
    .from(n)
    .where(and(eq(n.orgId, input.orgId), eq(n.id, input.invoiceId)))
    .for("update");
  if (!invoice) return err("Nota não encontrada.");
  if (invoice.status !== "failed") return err("Só uma nota com erro volta para a fila.");
  await tx
    .update(n)
    .set({ template: { ...(invoice.template as object), service: input.service }, updatedAt: new Date() })
    .where(and(eq(n.orgId, input.orgId), eq(n.id, input.invoiceId)));
  if (input.applyToIssuer) {
    const issuers = schema.clientNfseIssuers;
    const [issuer] = await tx
      .select({ template: issuers.template })
      .from(issuers)
      .where(and(eq(issuers.orgId, input.orgId), eq(issuers.id, invoice.issuerId)))
      .for("update");
    if (issuer) {
      await tx
        .update(issuers)
        .set({ template: { ...(issuer.template as object), service: input.service }, updatedBy: input.actorId, updatedAt: new Date() })
        .where(and(eq(issuers.orgId, input.orgId), eq(issuers.id, invoice.issuerId)));
    }
  }
  return requeueClientNfseInvoice(tx, { orgId: input.orgId, actorId: input.actorId, invoiceId: input.invoiceId });
}

async function existingTakerId(tx: OrgTx, orgId: string, issuerId: string, document: string): Promise<string | null> {
  const t = schema.clientNfseTakers;
  const [row] = await tx
    .select({ id: t.id })
    .from(t)
    .where(and(eq(t.orgId, orgId), eq(t.issuerId, issuerId), eq(t.document, document)))
    .limit(1);
  return row?.id ?? null;
}
