import { clientNfseMonthDescription } from "@/domain/client-nfse";

import type { AddressInput, ServiceOverride } from "./registry";
import { monthOf, templateDescription } from "./suggest";

/**
 * A previsão do mês: as notas emitidas no mês anterior, com o mês do texto
 * trocado, menos o que já se resolveu neste mês. É só uma sugestão: nada sai
 * sem o clique do Fiscal, e a emissão confere a origem de novo.
 */

export interface ForecastSource {
  accessKey: string;
  takerDocument: string;
  takerName: string;
  address: AddressInput | null;
  amountCents: number;
  description: string;
  issuedAt: Date;
  service: ServiceOverride | null;
}

/** Uma nota que já existe neste mês: pedida na Guilda ou emitida no Portal. */
export interface ForecastClaim {
  takerDocument: string;
  amountCents: number;
  /** Veio da previsão: resolve exatamente esta origem, e nenhuma outra. */
  sourceAccessKey: string | null;
}

export interface ForecastNote {
  sourceAccessKey: string;
  takerDocument: string;
  takerName: string;
  address: AddressInput | null;
  amountCents: number;
  description: string;
  service: ServiceOverride | null;
  /** O texto cita uma data que não deu para trocar: o Fiscal precisa conferir. */
  textNeedsReview: boolean;
  sourceIssuedAt: Date;
}

const MONTH_NAME = /\b(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/;
const MONTH_SHORT = /\b(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[/.-]\d{2,4}\b/;
const MONTH_NUMBER = /\b(0?[1-9]|1[0-2])[/-](\d{4}|\d{2})\b/;

/** Sobrou data depois da troca do mês? Citar outro mês na nota emitida seria erro real. */
export function forecastTextNeedsReview(template: string): boolean {
  const text = template
    .replaceAll("{mes}", "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  return MONTH_NAME.test(text) || MONTH_SHORT.test(text) || MONTH_NUMBER.test(text);
}

function toNote(source: ForecastSource, period: { year: number; month: number }): ForecastNote {
  const shape = templateDescription(source.description, monthOf(source.issuedAt));
  return {
    sourceAccessKey: source.accessKey,
    takerDocument: source.takerDocument,
    takerName: source.takerName,
    address: source.address,
    amountCents: source.amountCents,
    description: clientNfseMonthDescription(shape.description, period, shape.reference),
    service: source.service,
    textNeedsReview: forecastTextNeedsReview(shape.description),
    sourceIssuedAt: source.issuedAt,
  };
}

export function buildMonthForecast(input: {
  period: { year: number; month: number };
  sources: readonly ForecastSource[];
  claims: readonly ForecastClaim[];
  /** CPF/CNPJ de cada nota padrão ainda em aberto no mês: ela já ocupa o lugar da previsão. */
  standing: readonly string[];
  skipped: ReadonlySet<string>;
}): { notes: ForecastNote[]; skipped: ForecastNote[] } {
  const claimedKeys = new Set(input.claims.flatMap((claim) => (claim.sourceAccessKey ? [claim.sourceAccessKey] : [])));
  const open = [...input.sources]
    .filter((source) => !claimedKeys.has(source.accessKey))
    .sort((a, b) => a.issuedAt.getTime() - b.issuedAt.getTime());
  const skipped = open.filter((source) => input.skipped.has(source.accessKey));
  let pending = open.filter((source) => !input.skipped.has(source.accessKey));

  const take = (document: string, amountCents: number | null) => {
    const sameTaker = pending.filter((source) => source.takerDocument === document);
    // Havendo mais de uma nota para a pessoa, a de mesmo valor é a que se resolveu.
    const match = sameTaker.find((source) => source.amountCents === amountCents) ?? sameTaker[0];
    if (match) pending = pending.filter((source) => source !== match);
  };
  // Primeiro quem tem valor, para a nota padrão não levar a origem errada.
  for (const claim of input.claims) if (!claim.sourceAccessKey) take(claim.takerDocument, claim.amountCents);
  for (const document of input.standing) take(document, null);

  const byName = (a: ForecastNote, b: ForecastNote) => a.takerName.localeCompare(b.takerName, "pt-BR") || a.amountCents - b.amountCents;
  return {
    notes: pending.map((source) => toNote(source, input.period)).sort(byName),
    skipped: skipped.map((source) => toNote(source, input.period)).sort(byName),
  };
}
