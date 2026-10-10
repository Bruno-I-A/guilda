import { nfseCompetenceDate, type NfseCancelReasonCode } from "@/domain/nfse";

import { buildCancelRequestXml } from "./cancel-xml";
import { buildDpsXml } from "./dps-xml";
import { NfseTransientError, type NfseApiError, type SefinClient } from "./sefin-client";
import { signNfseXml, type NfseSigningKey } from "./sign";
import type { NfseTemplate } from "./template";
import { nfseIssueTimestamp, nfseToday } from "./time";

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
  description: string;
  accessKey: string | null;
  issuedEnvironment: 1 | 2 | null;
  cancelReasonCode: NfseCancelReasonCode | null;
  cancelReasonText: string | null;
}

export type NfseJobOutcome =
  | { kind: "issued"; accessKey: string; nfseNumber: string | null; environment: 1 | 2 }
  | { kind: "failed"; message: string; errors: NfseApiError[] }
  | { kind: "retry"; message: string; delayMinutes: number }
  | { kind: "cancelled" }
  | { kind: "cancel_rejected"; message: string; errors: NfseApiError[] };

export interface NfseJobDeps {
  client: SefinClient;
  environment: 1 | 2;
  providerCnpj: string;
  template: NfseTemplate;
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

async function issue(job: NfseJob, deps: NfseJobDeps): Promise<NfseJobOutcome> {
  // Consulta antes de emitir: se uma tentativa anterior caiu depois do envio,
  // a nota já existe e só precisa ser recuperada.
  const existing = await deps.client.findAccessKeyByDps(job.dpsId);
  if (existing) {
    return { kind: "issued", accessKey: existing, nfseNumber: await deps.client.getNfseNumber(existing), environment: deps.environment };
  }
  const { id, xml } = buildDpsXml({
    environment: deps.environment,
    issuedAt: nfseIssueTimestamp(deps.now),
    competenceDate: nfseCompetenceDate({ year: job.periodYear, month: job.periodMonth }, nfseToday(deps.now)),
    series: job.dpsSeries,
    number: job.dpsNumber,
    providerCnpj: deps.providerCnpj,
    template: deps.template,
    taker: { cnpj: job.takerCnpj, name: job.takerName },
    amountCents: job.amountCents,
    description: job.description,
  });
  if (id !== job.dpsId) {
    return {
      kind: "failed",
      message: "O modelo da nota mudou (município ou CNPJ) depois do pedido. Peça a emissão de novo.",
      errors: [],
    };
  }
  const result = await deps.client.emit(signNfseXml(xml, "infDPS", deps.signingKey));
  if (result.kind === "issued") return { ...result, environment: deps.environment };
  if (result.errors.some((error) => error.code === "E0014")) {
    const recovered = await deps.client.findAccessKeyByDps(job.dpsId);
    if (recovered) {
      return { kind: "issued", accessKey: recovered, nfseNumber: await deps.client.getNfseNumber(recovered), environment: deps.environment };
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
