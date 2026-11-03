import type { ClientNfseFreeNoteView, ClientNfseIssuerView, ClientNfseNoteView } from "./loaders";

export type NoteFilter = "all" | "pending" | "working" | "issued" | "failed" | "cancelled";
export type MonthNote = ClientNfseNoteView | ClientNfseFreeNoteView;

export const NOTE_FILTERS: readonly [NoteFilter, string][] = [
  ["all", "Todas"], ["pending", "A emitir"], ["working", "Em processamento"],
  ["issued", "Emitidas"], ["failed", "Com erro"], ["cancelled", "Canceladas"],
];

export function matchesNoteFilter(note: MonthNote, filter: NoteFilter): boolean {
  const status = note.invoice?.status;
  if (filter === "all") return true;
  // Uma fixa cancelada pode ser emitida novamente; também permanece no histórico.
  if (filter === "pending") return "modelId" in note && (!status || status === "cancelled");
  if (filter === "working") return status === "queued" || status === "cancel_requested";
  return status === filter;
}

export function issuerMonthNotes(issuer: ClientNfseIssuerView): MonthNote[] {
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

export function matchesIssuer(issuer: Pick<ClientNfseIssuerView, "name" | "cnpj">, query: string) {
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const needle = normalize(query.trim());
  const digits = query.replace(/\D/g, "");
  return !needle || normalize(issuer.name).includes(needle) || (digits.length >= 3 && Boolean(issuer.cnpj?.includes(digits)));
}
