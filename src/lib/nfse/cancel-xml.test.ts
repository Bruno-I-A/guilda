import { describe, expect, test } from "vitest";

import { buildCancelRequestXml } from "./cancel-xml";
import { nfseXsdErrors } from "./testing/xsd";

const KEY = "43149022112223330001810000000000001226100012345678";

describe("pedido de cancelamento", () => {
  test("é válido contra o XSD oficial v1.01", async () => {
    const { id, xml } = buildCancelRequestXml({
      environment: 2,
      requestedAt: "2026-10-05T09:15:00-03:00",
      providerCnpj: "11222333000181",
      accessKey: KEY,
      reasonCode: 1,
      reasonText: "Valor do honorário informado errado.",
    });
    expect(id).toBe(`PRE${KEY}101101`);
    expect(xml).toContain("<xDesc>Cancelamento de NFS-e</xDesc>");
    expect(await nfseXsdErrors(xml, "pedRegEvento_v1.01.xsd")).toEqual([]);
  });

  test("justificativa curta é recusada antes de chegar ao Sistema Nacional", () => {
    expect(() =>
      buildCancelRequestXml({
        environment: 2,
        requestedAt: "2026-10-05T09:15:00-03:00",
        providerCnpj: "11222333000181",
        accessKey: KEY,
        reasonCode: 9,
        reasonText: "errado",
      }),
    ).toThrow(/15/);
  });
});
