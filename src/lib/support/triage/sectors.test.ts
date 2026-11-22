import { describe, expect, test } from "vitest";

import { clanForSector, sectorForClan } from "./sectors";

const clans = [
  { id: "1", name: "Fiscal", slug: "fiscal" },
  { id: "2", name: "Contabilidade", slug: "contabilidade" },
  { id: "3", name: "Departamento Pessoal", slug: "departamento-pessoal" },
  { id: "4", name: "Societário", slug: "societario" },
  { id: "5", name: "Financeiro", slug: "financeiro" },
];

describe("setor da triagem para clã da Guilda", () => {
  test("acha o clã pelo nome, com ou sem acento", () => {
    expect(clanForSector("fiscal", clans)?.id).toBe("1");
    expect(clanForSector("contabil", clans)?.id).toBe("2");
    expect(clanForSector("trabalhista/dp", clans)?.id).toBe("3");
    expect(clanForSector("societario", clans)?.id).toBe("4");
    expect(clanForSector("financeiro", clans)?.id).toBe("5");
  });
  test("DP também pelo nome curto", () => {
    expect(clanForSector("trabalhista/dp", [{ id: "9", name: "DP", slug: "dp" }])?.id).toBe("9");
  });
  test("outro, setor sem clã e clã ambíguo ficam sem sugestão", () => {
    expect(clanForSector("outro", clans)).toBeNull();
    expect(clanForSector("financeiro", clans.slice(0, 2))).toBeNull();
    expect(clanForSector("fiscal", [...clans, { id: "6", name: "Fiscal 2", slug: "fiscal-2" }])).toBeNull();
  });
});

describe("clã da Guilda para setor da triagem", () => {
  test("o setor cujo clã é este; clã sem setor fica sem", () => {
    expect(sectorForClan(clans[0], clans)).toBe("fiscal");
    expect(sectorForClan(clans[2], clans)).toBe("trabalhista/dp");
    expect(sectorForClan({ id: "7", name: "Atendimento", slug: "atendimento" }, [...clans, { id: "7", name: "Atendimento", slug: "atendimento" }])).toBeNull();
  });
});