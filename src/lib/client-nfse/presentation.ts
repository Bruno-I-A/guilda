import type { ClientNfseFreeNoteView, ClientNfseIssuerView, ClientNfseNoteView } from "./loaders";

export type NoteFilter = "pending" | "working" | "issued" | "failed" | "cancelled";
export type MonthNote = ClientNfseNoteView | ClientNfseFreeNoteView;

export function matchesNoteFilter(note: MonthNote, filter: NoteFilter): boolean {
  const status = note.invoice?.status;
  // Uma fixa cancelada pode ser emitida novamente; também permanece no histórico.
  if (filter === "pending") return "modelId" in note && (!status || status === "cancelled");
  if (filter === "working") return status === "queued" || status === "cancel_requested";
  return status === filter;
}

export function issuerMonthNotes(issuer: Pick<ClientNfseIssuerView, "notes" | "freeNotes">): MonthNote[] {
  return [...issuer.notes, ...issuer.freeNotes];
}

export function summarizeNotes(notes: readonly MonthNote[]) {
  const issued = notes.filter((note) => note.invoice?.status === "issued");
  return {
    total: notes.length,
    issued: issued.length,
    issuedCents: issued.reduce((sum, note) => sum + Math.round(Number(note.amount) * 100), 0),
    pending: notes.filter((note) => matchesNoteFilter(note, "pending")).length,
    failed: notes.filter((note) => matchesNoteFilter(note, "failed")).length,
    working: notes.some((note) => matchesNoteFilter(note, "working")),
  };
}

const normalize = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function matchesIssuer(issuer: Pick<ClientNfseIssuerView, "name" | "cnpj">, query: string) {
  const needle = normalize(query.trim());
  const digits = query.replace(/\D/g, "");
  return !needle || normalize(issuer.name).includes(needle) || (digits.length >= 3 && Boolean(issuer.cnpj?.includes(digits)));
}

/**
 * O pedido chega pelo nome de quem recebe a nota tanto quanto pelo da empresa,
 * então a busca também olha os clientes dela: tomadores, previstas e notas do mês.
 */
export function matchesDeskQuery(issuer: ClientNfseIssuerView, query: string): boolean {
  if (matchesIssuer(issuer, query)) return true;
  const needle = normalize(query.trim());
  const digits = query.replace(/\D/g, "");
  const people = [...issuer.takers.map((taker) => ({ name: taker.name, document: taker.document })), ...issuer.forecast.notes.map((note) => ({ name: note.takerName, document: note.takerDocument })), ...issuerMonthNotes(issuer).map((note) => ({ name: note.takerName, document: note.takerDocument }))];
  return people.some((person) => normalize(person.name).includes(needle) || (digits.length >= 3 && person.document.includes(digits)));
}

/** O grupo da Mesa do mês: o que a pessoa precisa olhar primeiro vem antes. */
export type DeskGroup = "resolve" | "forecast" | "working" | "issued" | "quiet";

export const DESK_GROUP_ORDER: readonly DeskGroup[] = ["resolve", "forecast", "working", "issued", "quiet"];

export interface IssuerDesk {
  group: DeskGroup;
  failed: number;
  working: number;
  issued: number;
  issuedCents: number;
  /** Previstas e notas padrão ainda em aberto. */
  forecast: number;
  forecastCents: number;
  /** A empresa não pode emitir agora e tem nota esperando. */
  blocked: boolean;
}

export function issuerDesk(issuer: ClientNfseIssuerView): IssuerDesk {
  const summary = summarizeNotes(issuerMonthNotes(issuer));
  const openFixed = issuer.notes.filter((note) => matchesNoteFilter(note, "pending"));
  const forecast = issuer.forecast.notes.length + openFixed.length;
  const forecastCents = [...issuer.forecast.notes, ...openFixed].reduce((sum, note) => sum + Math.round(Number(note.amount) * 100), 0);
  const working = issuerMonthNotes(issuer).filter((note) => matchesNoteFilter(note, "working")).length;
  const blocked = Boolean(issuer.active && issuer.problem && forecast > 0);
  const group: DeskGroup = summary.failed > 0 || blocked ? "resolve" : forecast > 0 ? "forecast" : working > 0 ? "working" : summary.issued > 0 ? "issued" : "quiet";
  return { group, failed: summary.failed, working, issued: summary.issued, issuedCents: summary.issuedCents, forecast, forecastCents, blocked };
}

/** Os números do placar. Um número só por situação: quantas notas e em quantas empresas. */
export function deskScore(desks: readonly IssuerDesk[]) {
  const companies = (test: (desk: IssuerDesk) => boolean) => desks.filter(test).length;
  const sum = (pick: (desk: IssuerDesk) => number) => desks.reduce((total, desk) => total + pick(desk), 0);
  return {
    resolve: { count: sum((desk) => desk.failed + (desk.blocked ? 1 : 0)), companies: companies((desk) => desk.group === "resolve") },
    forecast: { count: sum((desk) => desk.forecast), companies: companies((desk) => desk.forecast > 0) },
    working: { count: sum((desk) => desk.working), companies: companies((desk) => desk.working > 0) },
    issued: { count: sum((desk) => desk.issued), companies: companies((desk) => desk.issued > 0), cents: sum((desk) => desk.issuedCents) },
  };
}

export type DeskFilter = Exclude<DeskGroup, "quiet">;

/** O placar também filtra: mostra toda empresa com aquela situação, seja qual for o grupo dela. */
export function matchesDeskFilter(desk: IssuerDesk, filter: DeskFilter | null): boolean {
  if (filter === null) return true;
  if (filter === "resolve") return desk.group === "resolve";
  if (filter === "forecast") return desk.forecast > 0;
  if (filter === "working") return desk.working > 0;
  return desk.issued > 0;
}

/** Como terminou o lote: o que saiu, o que deu erro e o que ainda está na fila. */
export function batchOutcome(invoiceIds: ReadonlySet<string>, issuers: readonly Pick<ClientNfseIssuerView, "notes" | "freeNotes">[]) {
  const outcome = { issued: 0, failed: 0, waiting: 0, total: invoiceIds.size };
  const seen = new Set<string>();
  for (const note of issuers.flatMap(issuerMonthNotes)) {
    const invoice = note.invoice;
    if (!invoice || !invoiceIds.has(invoice.id)) continue;
    seen.add(invoice.id);
    if (invoice.status === "issued") outcome.issued++;
    else if (invoice.status === "failed") outcome.failed++;
    else if (invoice.status === "queued") outcome.waiting++;
  }
  // A tela pode ainda não ter recarregado com as notas recém-pedidas.
  outcome.waiting += invoiceIds.size - seen.size;
  return outcome;
}

const PORTAL_STALE_MS = 24 * 60 * 60 * 1000;

/** A leitura das notas do Portal é antiga: o que saiu lá depois dela ainda não abateu a previsão. */
export function portalReadIsStale(readAt: string | null, now: Date): boolean {
  return !readAt || now.getTime() - new Date(readAt).getTime() > PORTAL_STALE_MS;
}
