import { describe, expect, it } from "vitest";

import { companyDisplayName } from "./company-display-name";

describe("companyDisplayName", () => {
  it("tira a raiz do CNPJ do nome do MEI", () => {
    expect(companyDisplayName("05.309.568 ELIANE HIRT")).toBe("Eliane Hirt");
    expect(companyDisplayName("05309568 ELIANE HIRT")).toBe("Eliane Hirt");
  });

  it("tira o CPF que o MEI antigo levava no fim", () => {
    expect(companyDisplayName("ELIANE HIRT 01234567890")).toBe("Eliane Hirt");
    expect(companyDisplayName("ELIANE HIRT 012.345.678-90")).toBe("Eliane Hirt");
  });

  it("passa caixa alta para nome próprio com conectivos em minúscula", () => {
    expect(companyDisplayName("26.582.389 ANA MICHELE TOMELERO MARTINELLO")).toBe(
      "Ana Michele Tomelero Martinello",
    );
    expect(companyDisplayName("PADARIA DO JOÃO E FILHOS LTDA")).toBe(
      "Padaria do João e Filhos Ltda",
    );
    expect(companyDisplayName("A CASA DO PÃO")).toBe("A Casa do Pão");
  });

  it("mantém sufixos societários, siglas e numerais", () => {
    expect(companyDisplayName("SCHARFF & CIA LTDA ME")).toBe("Scharff & Cia Ltda ME");
    expect(companyDisplayName("COMERCIO GV KMJ EIRELI")).toBe("Comercio GV KMJ EIRELI");
    expect(companyDisplayName("AGRO SUL S/A")).toBe("Agro Sul S/A");
    expect(companyDisplayName("TRANSPORTES RS II LTDA EPP")).toBe("Transportes RS II Ltda EPP");
    expect(companyDisplayName("J.R. MATERIAIS 2000")).toBe("J.R. Materiais 2000");
  });

  it("acerta apóstrofo e hífen", () => {
    expect(companyDisplayName("GAYGER & D'AGOSTINI ADVOCACIA")).toBe(
      "Gayger & D'Agostini Advocacia",
    );
    expect(companyDisplayName("MARIA-CLARA MODAS")).toBe("Maria-Clara Modas");
  });

  it("não mexe em nome que já foi digitado com minúsculas", () => {
    expect(companyDisplayName("Academia UpFit Treinamento")).toBe("Academia UpFit Treinamento");
    expect(companyDisplayName("05.309.568 Eliane Hirt")).toBe("Eliane Hirt");
  });

  it("não deixa o nome sumir", () => {
    expect(companyDisplayName("05.309.568")).toBe("05.309.568");
    expect(companyDisplayName("")).toBe("");
    expect(companyDisplayName(null)).toBe("");
  });
});
