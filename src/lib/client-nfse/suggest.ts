import type { ClientNfseReference } from "@/domain/client-nfse";
import type { NfseIssuerTemplate } from "@/lib/nfse/template";

import type { IssuedNoteFacts } from "./from-xml";
import type { AddressInput } from "./registry";

/**
 * Sugestões para cadastrar uma empresa emissora a partir das notas que ela já
 * emitiu: o modelo fiscal da nota mais recente, uma série de DPS que ela não
 * usa e as notas do último mês como notas padrão. Nada é gravado aqui: o
 * Fiscal confere e confirma.
 */

const BRASILIA_OFFSET_MS = 3 * 60 * 60 * 1000;
/** Primeira série tentada; sobe até achar uma que a empresa não use. */
const FIRST_SERIES = 900;

function monthOf(date: Date): { year: number; month: number } {
  const shifted = new Date(date.getTime() - BRASILIA_OFFSET_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1 };
}

function monthKey(period: { year: number; month: number }): string {
  return `${period.year}-${String(period.month).padStart(2, "0")}`;
}

function previous(period: { year: number; month: number }) {
  return period.month === 1 ? { year: period.year - 1, month: 12 } : { year: period.year, month: period.month - 1 };
}

function mmYyyy(period: { year: number; month: number }): string {
  return `${String(period.month).padStart(2, "0")}/${period.year}`;
}

/**
 * A descrição de uma nota emitida vira a da nota padrão: o "09/2026" do mês
 * anterior ao da emissão vira {mes} com referência ao mês anterior; o do
 * próprio mês, {mes} com referência ao próprio. Sem data, o texto fica igual.
 */
export function templateDescription(
  text: string,
  issued: { year: number; month: number },
): { description: string; reference: ClientNfseReference } {
  const before = mmYyyy(previous(issued));
  if (text.includes(before)) return { description: text.replaceAll(before, "{mes}"), reference: "previous" };
  const same = mmYyyy(issued);
  if (text.includes(same)) return { description: text.replaceAll(same, "{mes}"), reference: "current" };
  return { description: text, reference: "previous" };
}

/** A primeira série a partir de 900 que nenhuma nota da empresa usa. */
export function freeDpsSeries(used: Iterable<string | null>): string {
  const taken = new Set([...used].filter((value): value is string => Boolean(value)).map((value) => String(Number(value))));
  for (let series = FIRST_SERIES; series <= 49_999; series++) {
    if (!taken.has(String(series))) return String(series);
  }
  return String(FIRST_SERIES);
}

/**
 * A série seguinte à que colidiu com outro sistema da empresa: a primeira
 * acima dela que nenhuma nota guardada nem pedida usa. Null quando acabou a
 * faixa da Guilda (até 49999; o Emissor Web usa 70000+).
 */
export function nextDpsSeriesAfter(current: string, used: Iterable<string | null>): string | null {
  const taken = new Set([...used].filter((value): value is string => Boolean(value)).map((value) => String(Number(value))));
  for (let series = Number(current) + 1; series <= 49_999; series++) {
    if (!taken.has(String(series))) return String(series);
  }
  return null;
}

export interface ModelSuggestion {
  key: string;
  takerDocument: string;
  takerName: string;
  address: AddressInput | null;
  /** Decimal canônico ("150.00"). */
  amount: string;
  description: string;
  reference: ClientNfseReference;
  /** Saiu também no mês anterior ao último: é nota que se repete. */
  recurring: boolean;
}

export interface IssuerSuggestion {
  template: NfseIssuerTemplate | null;
  dpsSeries: string;
  basedOn: { notes: number; lastIssuedAt: string | null; month: string | null };
  models: ModelSuggestion[];
}

export function suggestFromIssuedNotes(
  notes: readonly IssuedNoteFacts[],
  existing: { models: readonly { takerDocument: string; description: string }[] } = { models: [] },
): IssuerSuggestion {
  const dated = notes
    .filter((note): note is IssuedNoteFacts & { issuedAt: Date } => Boolean(note.issuedAt))
    .sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime());
  const latest = dated[0] ?? null;
  const series = freeDpsSeries(notes.map((note) => note.series));
  if (!latest) return { template: null, dpsSeries: series, basedOn: { notes: 0, lastIssuedAt: null, month: null }, models: [] };

  const lastMonth = monthOf(latest.issuedAt);
  const lastKey = monthKey(lastMonth);
  const beforeKey = monthKey(previous(lastMonth));
  const known = new Set(existing.models.map((model) => `${model.takerDocument}|${model.description}`));
  const shapeOf = (note: (typeof dated)[number]) => {
    if (!note.taker || !note.description || note.amountCents === null) return null;
    const issued = monthOf(note.issuedAt);
    return { ...templateDescription(note.description, issued), issued: monthKey(issued) };
  };
  const earlier = new Set(
    dated.flatMap((note) => {
      const shape = shapeOf(note);
      return shape && shape.issued === beforeKey ? [`${note.taker!.document}|${shape.description}`] : [];
    }),
  );
  const models = new Map<string, ModelSuggestion>();
  for (const note of dated) {
    const shape = shapeOf(note);
    if (!shape || shape.issued !== lastKey) continue;
    const key = `${note.taker!.document}|${shape.description}`;
    if (models.has(key) || known.has(key)) continue;
    models.set(key, {
      key,
      takerDocument: note.taker!.document,
      takerName: note.taker!.name,
      address: note.taker!.address,
      amount: (note.amountCents! / 100).toFixed(2),
      description: shape.description,
      reference: shape.reference,
      recurring: earlier.has(key),
    });
  }
  return {
    template: latest.template,
    dpsSeries: series,
    basedOn: { notes: notes.length, lastIssuedAt: latest.issuedAt.toISOString(), month: lastKey },
    models: [...models.values()].sort((a, b) => a.takerName.localeCompare(b.takerName, "pt-BR")),
  };
}
