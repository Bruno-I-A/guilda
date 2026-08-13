import { describe, expect, it } from "vitest";

import { resolveClientName } from "./client-resolution";

const clients = [
  { id: "1", name: "SCHARFF CONTABILIDADE LTDA" },
  { id: "2", name: "PICCOLI AGRO SERVIÇOS LTDA" },
  { id: "3", name: "CLÍNICA SCHARFF ODONTOLOGIA LTDA" },
];

describe("resolveClientName", () => {
  it("resolve o nome completo ignorando acentos e caixa", () => {
    expect(resolveClientName("Piccoli Agro Serviços Ltda", clients)?.id).toBe("2");
  });

  it("resolve um trecho exclusivo do nome", () => {
    expect(resolveClientName("Piccoli", clients)?.id).toBe("2");
  });

  it("recusa um trecho ambíguo", () => {
    expect(resolveClientName("Scharff", clients)).toBeNull();
  });

  it("não usa apenas sufixos societários", () => {
    expect(resolveClientName("LTDA", clients)).toBeNull();
  });
});
