import { describe, expect, test } from "vitest";
import type { ClientNfseFreeNoteView, ClientNfseIssuerView, ClientNfseNoteView } from "./loaders";
import { issuerMonthNotes, matchesIssuer, matchesNoteFilter, summarizeNotes } from "./presentation";

// Só os campos usados pelo resumo; os demais pertencem aos formulários.
const fixed = (status?: string, amount = "100.10") => ({ modelId: "model", amount, invoice: status ? { status } : null }) as ClientNfseNoteView;
const free = (status: string, amount = "200.20") => ({ amount, invoice: { status } }) as ClientNfseFreeNoteView;

describe("painel de emissão", () => {
  test("soma fixas e avulsas emitidas, sem incluir pendentes, falhas ou canceladas no valor emitido", () => {
    const notes = [fixed("issued"), free("issued"), fixed(), free("failed"), free("cancelled"), free("queued")];
    expect(summarizeNotes(notes)).toEqual({ total: 6, issued: 2, issuedCents: 30030, pending: 1, failed: 1, working: true });
  });
  test("a empresa que só tem fixa emitida não fica vazia", () => {
    const notes = issuerMonthNotes({ notes: [fixed("issued")], freeNotes: [] } as unknown as ClientNfseIssuerView);
    expect(summarizeNotes(notes)).toMatchObject({ total: 1, issued: 1, issuedCents: 10010 });
  });
  test("avulsa na fila ou cancelando mantém a atualização automática", () => {
    expect(summarizeNotes([free("queued")]).working).toBe(true);
    expect(summarizeNotes([free("cancel_requested")]).working).toBe(true);
    expect(summarizeNotes([free("failed")]).working).toBe(false);
  });
  test("cancelada fixa pode ser reemitida; avulsa cancelada não vira pendência", () => {
    expect(matchesNoteFilter(fixed("cancelled"), "pending")).toBe(true);
    expect(matchesNoteFilter(free("cancelled"), "pending")).toBe(false);
    expect(matchesNoteFilter(fixed("cancelled"), "cancelled")).toBe(true);
    expect(matchesNoteFilter(fixed("failed"), "pending")).toBe(false);
  });
  test("encontra empresa por nome sem acento e por CNPJ formatado", () => {
    const issuer = { name: "Clínica Exemplo", cnpj: "12345678000190" };
    expect(matchesIssuer(issuer, "clinica")).toBe(true);
    expect(matchesIssuer(issuer, "12.345.678/0001-90")).toBe(true);
    expect(matchesIssuer(issuer, "outra")).toBe(false);
  });
});
