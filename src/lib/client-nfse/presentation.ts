import type { ClientNfseIssuerView, ClientNfseMonthNoteView } from "./loaders";

type Note = Pick<ClientNfseMonthNoteView, "amount"> & { invoice: Pick<ClientNfseMonthNoteView["invoice"], "status"> };

/** O que uma empresa tem no mês. Cancelada fica na lista, mas não conta. */
export function summarizeNotes(notes: readonly Note[]) {
  const issued = notes.filter((note) => note.invoice.status === "issued");
  return {
    issued: issued.length,
    issuedCents: issued.reduce((sum, note) => sum + Math.round(Number(note.amount) * 100), 0),
    failed: notes.filter((note) => note.invoice.status === "failed").length,
    working: notes.filter((note) => note.invoice.status === "queued" || note.invoice.status === "cancel_requested").length,
  };
}

export type CompanyFilter = "failed" | "working" | "issued" | "none";

export const COMPANY_FILTERS: readonly [CompanyFilter, string][] = [
  ["failed", "Com erro"],
  ["working", "Em andamento"],
  ["issued", "Emitidas"],
  ["none", "Sem nota"],
];

export function matchesCompanyFilter(notes: readonly Note[], filter: CompanyFilter | null): boolean {
  if (filter === null) return true;
  const summary = summarizeNotes(notes);
  if (filter === "failed") return summary.failed > 0;
  if (filter === "working") return summary.working > 0;
  if (filter === "issued") return summary.issued > 0;
  return summary.issued + summary.failed + summary.working === 0;
}

const normalize = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function matchesIssuer(issuer: Pick<ClientNfseIssuerView, "name" | "cnpj">, query: string) {
  const needle = normalize(query.trim());
  const digits = query.replace(/\D/g, "");
  return !needle || normalize(issuer.name).includes(needle) || (digits.length >= 3 && Boolean(issuer.cnpj?.includes(digits)));
}

/** O pedido chega pelo nome de quem recebe a nota tanto quanto pelo da empresa. */
export function matchesCompanyQuery(issuer: Pick<ClientNfseIssuerView, "name" | "cnpj" | "takers" | "notes">, query: string): boolean {
  if (matchesIssuer(issuer, query)) return true;
  const needle = normalize(query.trim());
  const digits = query.replace(/\D/g, "");
  const people = [...issuer.takers.map((taker) => ({ name: taker.name, document: taker.document })), ...issuer.notes.map((note) => ({ name: note.takerName, document: note.takerDocument }))];
  return people.some((person) => normalize(person.name).includes(needle) || (digits.length >= 3 && person.document.includes(digits)));
}
