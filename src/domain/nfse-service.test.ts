import { describe, expect, test } from "vitest";

import { isServiceCnae, nfseIssuer } from "./nfse-service";

describe("CNAE de serviço (sugestão de quem emite NFS-e)", () => {
  test.each([
    ["6920601", "contabilidade"],
    ["6911701", "advocacia"],
    ["7112000", "engenharia"],
    ["6201501", "desenvolvimento de software"],
    ["4120400", "construção de edifícios"],
    ["8630503", "atividade médica ambulatorial"],
    ["8599604", "treinamento profissional"],
    ["9602501", "cabeleireiros"],
    ["3314710", "manutenção de máquinas"],
    ["4520001", "manutenção mecânica de veículos"],
    ["4543900", "manutenção de motocicletas"],
    ["6821801", "corretagem de imóveis"],
    ["5510801", "hotéis"],
  ])("%s (%s) sugere serviço", (code) => {
    expect(isServiceCnae(code)).toBe(true);
  });

  test.each([
    ["4711302", "supermercado"],
    ["4530703", "comércio de peças para veículos"],
    ["1091101", "fabricação de produtos de panificação"],
    ["0115600", "cultivo de soja"],
    ["5611201", "restaurantes"],
    ["4930202", "transporte rodoviário de carga"],
    ["6110801", "telefonia fixa"],
  ])("%s (%s) não sugere serviço", (code) => {
    expect(isServiceCnae(code)).toBe(false);
  });

  test("formatado ou sem CNAE", () => {
    expect(isServiceCnae("69.20-6/01")).toBe(true);
    expect(isServiceCnae(null)).toBeNull();
    expect(isServiceCnae("")).toBeNull();
  });
});

describe("emite NFS-e: a Ficha manda, o CNAE sugere", () => {
  test("marcado na Ficha vale mais que o CNAE", () => {
    expect(nfseIssuer({ applicability: "required", cnaeCode: "4711302" })).toEqual({ issues: true, source: "ficha" });
    expect(nfseIssuer({ applicability: "not_required", cnaeCode: "6920601" })).toEqual({ issues: false, source: "ficha" });
    expect(nfseIssuer({ applicability: "not_applicable", cnaeCode: "6920601" })).toEqual({ issues: false, source: "ficha" });
  });

  test("não informado: sugestão do CNAE, ou a classificar sem CNAE", () => {
    expect(nfseIssuer({ applicability: "unknown", cnaeCode: "6920601" })).toEqual({ issues: true, source: "cnae" });
    expect(nfseIssuer({ applicability: null, cnaeCode: "4711302" })).toEqual({ issues: false, source: "cnae" });
    expect(nfseIssuer({ applicability: "unknown", cnaeCode: null })).toEqual({ issues: null, source: "none" });
  });
});
