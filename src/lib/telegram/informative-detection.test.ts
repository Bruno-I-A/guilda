import { describe, expect, it } from "vitest";

import {
  isBusinessMissionMessage,
  isClientWorkMessage,
  validateBusinessMissionFormat,
} from "./informative-detection";

describe("isClientInformative", () => {
  it.each([
    "INFORMATIVO NOVO CLIENTE",
    "INFORMATIVO ALTERAÇÃO CLIENTE",
    "INFORMATIVO DE BAIXA DE CLIENTE",
    "[10:59] Eder: INFORMATIVO DE BAIXA DE CLIENTE\nBAIXA DE CLIENTE – código (487)",
  ])("reconhece %s", (text) => {
    expect(isClientWorkMessage(text)).toBe(true);
  });

  it("reconhece solicitação empresarial curta", () => {
    const message =
      "MISSÃO EMPRESARIAL\nTIPO: ABERTURA\nEMPRESA: PICCOLI AGRO SERVIÇOS LTDA\nAÇÕES:\n- Encaminhar na prefeitura\n- Solicitar certificado digital\nRESPONSÁVEL: Bruno";
    expect(isClientWorkMessage(message)).toBe(true);
    expect(isBusinessMissionMessage(message)).toBe(true);
  });

  it("não envia conversa comum para classificação", () => {
    expect(isClientWorkMessage("Bom dia, quais são minhas tarefas?")).toBe(false);
  });
});

describe("validateBusinessMissionFormat", () => {
  const valid = `MISSÃO EMPRESARIAL
TIPO: ALTERAÇÃO
EMPRESA: ALTA GENETICS ALTO URUGUAI LTDA
AÇÕES:
- Alterar alvará em razão da mudança de endereço
RESPONSÁVEL: Bruno`;

  it("aceita o modelo completo", () => {
    expect(validateBusinessMissionFormat(valid)).toBeNull();
  });

  it.each(["ABRIU", "FECHOU", "ALTEROU"])(
    "aceita o verbo padronizado %s no tipo",
    (type) => {
      expect(validateBusinessMissionFormat(valid.replace("ALTERAÇÃO", type))).toBeNull();
    },
  );

  it("aponta responsável ausente sem chamar a IA", () => {
    expect(
      validateBusinessMissionFormat(valid.replace("RESPONSÁVEL: Bruno", "")),
    ).toContain("RESPONSÁVEL");
  });

  it("exige ações em lista", () => {
    expect(validateBusinessMissionFormat(valid.replace("- Alterar alvará", "Alterar alvará"))).toContain(
      "hífen",
    );
  });
});
