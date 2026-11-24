import type { NfseCancelReasonCode, NfseTakerAddress } from "@/domain/nfse";

import { buildCancelRequestXml } from "./cancel-xml";
import { buildDpsXml, nfseLayoutFor, type NfseLayout } from "./dps-xml";
import { NfseTransientError, type NfseApiError, type SefinClient } from "./sefin-client";
import { signNfseXml, type NfseSigningKey } from "./sign";
import type { NfseIssuerTemplate } from "./template";
import { nfseIssueDate, nfseIssueTimestamp } from "./time";

/** Uma nota reivindicada da fila, no formato que a orquestração precisa. */
export interface NfseJob {
  id: string;
  status: "queued" | "cancel_requested";
  /** Já contando esta tentativa. */
  attemptCount: number;
  dpsId: string;
  dpsSeries: string;
  dpsNumber: number;
  periodYear: number;
  periodMonth: number;
  amountCents: number;
  takerCnpj: string;
  takerName: string;
  takerAddress: NfseTakerAddress | null;
  description: string;
  accessKey: string | null;
  issuedEnvironment: 1 | 2 | null;
  cancelReasonCode: NfseCancelReasonCode | null;
  cancelReasonText: string | null;
}

export type NfseJobOutcome =
  /** `foundByDps`: a nota já existia e foi achada pela consulta da DPS, não emitida agora. */
  | { kind: "issued"; accessKey: string; nfseNumber: string | null; environment: 1 | 2; foundByDps?: true; xml?: string | null }
  | { kind: "failed"; message: string; errors: NfseApiError[] }
  | { kind: "retry"; message: string; delayMinutes: number }
  | { kind: "cancelled" }
  | { kind: "cancel_rejected"; message: string; errors: NfseApiError[] };

export interface NfseJobDeps {
  client: SefinClient;
  environment: 1 | 2;
  providerCnpj: string;
  template: NfseIssuerTemplate;
  signingKey: NfseSigningKey;
  now: Date;
}

/** Esperas depois da 1ª, 2ª e 3ª tentativa; a 4ª falha de rede desiste. */
export const NFSE_RETRY_DELAYS_MINUTES = [1, 5, 15] as const;

export function formatNfseErrors(errors: readonly NfseApiError[]): string {
  if (errors.length === 0) return "Recusa sem detalhe.";
  return errors
    .map((error) => (error.code ? `${error.code}: ${error.message}` : error.message))
    .join(" · ")
    .slice(0, 2000);
}

/** NFSE_LEIAUTE fixa o leiaute: o serviço fiscal não troca sozinho. */
function layoutForced(): boolean {
  return process.env.NFSE_LEIAUTE === "nt004" || process.env.NFSE_LEIAUTE === "nt009";
}

/**
 * Recusa do esquema XML (E1235 na produção restrita, "invalid child element"):
 * a DPS não chegou a ser registrada, então outro leiaute pode ser tentado.
 */
export function isSchemaRejection(errors: readonly NfseApiError[]): boolean {
  return errors.some((error) => error.code === "E1235" || /invalid child element|schema|esquema|xsd/i.test(error.message));
}

async function issue(job: NfseJob, deps: NfseJobDeps): Promise<NfseJobOutcome> {
  // Consulta antes de emitir: se uma tentativa anterior caiu depois do envio,
  // a nota já existe e só precisa ser recuperada.
  const existing = await deps.client.findAccessKeyByDps(job.dpsId);
  if (existing) {
    return { kind: "issued", accessKey: existing, nfseNumber: await deps.client.getNfseNumber(existing), environment: deps.environment, foundByDps: true };
  }
  const issuedAt = nfseIssueTimestamp(deps.now);
  const layout = nfseLayoutFor(deps.environment, new Date(issuedAt));
  const build = (chosen: NfseLayout) =>
    buildDpsXml({
      environment: deps.environment,
      layout: chosen,
      issuedAt,
      competenceDate: nfseIssueDate(deps.now),
      series: job.dpsSeries,
      number: job.dpsNumber,
      providerCnpj: deps.providerCnpj,
      template: deps.template,
      taker: { cnpj: job.takerCnpj, name: job.takerName, address: job.takerAddress },
      amountCents: job.amountCents,
      description: job.description,
    });
  const { id, xml } = build(layout);
  if (id !== job.dpsId) {
    return {
      kind: "failed",
      message: "O modelo da nota mudou (município ou CNPJ) depois do pedido. Peça a emissão de novo.",
      errors: [],
    };
  }
  const result = await deps.client.emit(signNfseXml(xml, "infDPS", deps.signingKey));
  if (result.kind === "issued") return { ...result, environment: deps.environment };
  // Virada da NT 009 (01/12/2026): o governo ainda não publicou o cronograma formal da
  // produção. Se o esquema recusar o leiaute da data, a DPS não foi registrada, então a
  // mesma DPS sai uma vez no outro leiaute. Com NFSE_LEIAUTE forçado, não troca.
  if (!layoutForced() && isSchemaRejection(result.errors)) {
    const other: NfseLayout = layout === "nt009" ? "nt004" : "nt009";
    const second = await deps.client.emit(signNfseXml(build(other).xml, "infDPS", deps.signingKey));
    if (second.kind === "issued") {
      console.warn(`[nfse] o esquema recusou o leiaute ${layout}; a DPS ${job.dpsId} saiu no ${other}. Confira a virada e o NFSE_LEIAUTE.`);
      return { ...second, environment: deps.environment };
    }
    // As duas recusadas: fica o erro do leiaute da data, que é o que explica o problema.
  }
  if (result.errors.some((error) => error.code === "E0014")) {
    const recovered = await deps.client.findAccessKeyByDps(job.dpsId);
    if (recovered) {
      return { kind: "issued", accessKey: recovered, nfseNumber: await deps.client.getNfseNumber(recovered), environment: deps.environment, foundByDps: true };
    }
  }
  return { kind: "failed", message: formatNfseErrors(result.errors), errors: result.errors };
}

async function cancel(job: NfseJob, deps: NfseJobDeps): Promise<NfseJobOutcome> {
  if (!job.accessKey || !job.cancelReasonCode || !job.cancelReasonText) {
    return { kind: "cancel_rejected", message: "Pedido de cancelamento incompleto.", errors: [] };
  }
  if (job.issuedEnvironment !== deps.environment) {
    return {
      kind: "cancel_rejected",
      message: "Esta nota foi emitida em outro ambiente do Sistema Nacional; cancele por ele.",
      errors: [],
    };
  }
  const { xml } = buildCancelRequestXml({
    environment: deps.environment,
    requestedAt: nfseIssueTimestamp(deps.now),
    providerCnpj: deps.providerCnpj,
    accessKey: job.accessKey,
    reasonCode: job.cancelReasonCode,
    reasonText: job.cancelReasonText,
  });
  const result = await deps.client.cancel(job.accessKey, signNfseXml(xml, "infPedReg", deps.signingKey));
  return result.kind === "cancelled"
    ? result
    : { kind: "cancel_rejected", message: formatNfseErrors(result.errors), errors: result.errors };
}

/**
 * Decide o desfecho de uma nota reivindicada. Não toca no banco: quem
 * grava é o repositório do serviço fiscal.
 */
export async function runNfseJob(job: NfseJob, deps: NfseJobDeps): Promise<NfseJobOutcome> {
  try {
    return job.status === "queued" ? await issue(job, deps) : await cancel(job, deps);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha desconhecida.";
    const giveUp = (text: string): NfseJobOutcome =>
      job.status === "queued"
        ? { kind: "failed", message: text, errors: [] }
        : { kind: "cancel_rejected", message: text, errors: [] };
    // Erro que não é de rede (montagem, assinatura) não melhora repetindo.
    if (!(error instanceof NfseTransientError)) return giveUp(message);
    const delay = NFSE_RETRY_DELAYS_MINUTES[job.attemptCount - 1];
    if (delay === undefined) return giveUp(`${message} (desistiu depois de ${job.attemptCount} tentativas)`);
    return { kind: "retry", message, delayMinutes: delay };
  }
}
