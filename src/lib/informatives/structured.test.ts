import { describe, expect, test } from "vitest";

import {
  buildStructuredInformativePayload,
  structuredInformativeSourceText,
} from "./structured";

const clans = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Fiscal" },
  { id: "22222222-2222-4222-8222-222222222222", name: "RH" },
];

describe("buildStructuredInformativePayload", () => {
  test("aceita várias missões no mesmo clã e em clãs diferentes", () => {
    const payload = buildStructuredInformativePayload({
      clans,
      missions: [
        { clanId: clans[0].id, description: "Parametrizar o Simples Nacional" },
        { clanId: clans[0].id, description: "Revisar as notas de entrada" },
        { clanId: clans[1].id, description: "Cadastrar o pró-labore" },
      ],
    });

    expect(payload.tasks).toHaveLength(3);
    expect(payload.tasks.map((task) => task.clanName)).toEqual([
      "Fiscal",
      "Fiscal",
      "RH",
    ]);
    expect(payload.tasks.every((task) => task.assignmentType === "clan")).toBe(true);
    expect(payload.kind).toBe("general_task");
  });

  test("preserva os dados de empresa já resolvidos sem inferência", () => {
    const payload = buildStructuredInformativePayload({
      clans,
      missions: [{ clanId: clans[0].id, description: "Parametrizar a empresa" }],
      company: {
        legalName: "EMPRESA TESTE LTDA",
        normalizedCnpj: "11222333000181",
        taxRegime: "simples",
        clientId: null,
        createClient: true,
        cnaeCode: "6920601",
        cnaeDescription: "Atividades de contabilidade",
        secondaryCnaes: [],
        openedAt: "2026-08-27",
      },
    });

    expect(payload.kind).toBe("new_client");
    expect(payload.company).toMatchObject({
      legalName: "EMPRESA TESTE LTDA",
      normalizedCnpj: "11222333000181",
      createClient: true,
    });
  });

  test("gera texto de auditoria com o nome do clã selecionado", () => {
    expect(
      structuredInformativeSourceText(
        [{ clanId: clans[1].id, description: "Cadastrar o pró-labore" }],
        clans,
      ),
    ).toContain("RH — Cadastrar o pró-labore");
  });

  test("aceita alteração de cliente sem missão e preserva observações", () => {
    const payload = buildStructuredInformativePayload({
      clans,
      missions: [],
      kind: "client_change",
      company: {
        legalName: "EMPRESA EXISTENTE LTDA",
        normalizedCnpj: "11222333000181",
        taxRegime: "simples",
        clientId: "33333333-3333-4333-8333-333333333333",
        createClient: false,
        cnaeCode: null,
        cnaeDescription: null,
        secondaryCnaes: null,
        openedAt: null,
      },
      observations: ["Razão social atualizada"],
    });

    expect(payload.kind).toBe("client_change");
    expect(payload.tasks).toEqual([]);
    expect(payload.observations).toEqual(["Razão social atualizada"]);
    expect(payload.warnings).toEqual([]);
  });
});
