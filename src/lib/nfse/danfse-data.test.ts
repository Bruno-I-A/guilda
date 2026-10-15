import { describe, expect, test } from "vitest";

import { type DanfseSection, readDanfse } from "./danfse-data";
import { TEST_ACCESS_KEY, testNfseXml } from "./testing/nfse-xml";
import { nfseXsdErrors } from "./testing/xsd";

function values(section: DanfseSection | undefined): string[][] {
  if (!section || section.kind !== "block") throw new Error("Bloco esperado.");
  return section.rows.map((row) => row.map((field) => field.value));
}

function block(sections: DanfseSection[], title: string): DanfseSection | undefined {
  return sections.find((section) => section.kind === "block" && section.title === title);
}

describe("leitura do DANFSe a partir do XML da NFS-e", () => {
  test("a fixture segue o XSD oficial da NFS-e", async () => {
    expect(await nfseXsdErrors(testNfseXml(), "NFSe_v1.01.xsd")).toEqual([]);
  });

  test("formata cada campo como o DANFSe que o Portal gerou para a nota 104", () => {
    const danfse = readDanfse(testNfseXml());

    expect(danfse.accessKey).toBe(TEST_ACCESS_KEY);
    expect(danfse.qrCodeUrl).toBe(`https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=${TEST_ACCESS_KEY}`);
    expect(danfse.homologation).toBe(false);
    expect(danfse.header).toEqual({
      city: "Município: Getúlio Vargas - RS",
      generator: "Ambiente Gerador: 2",
      environment: "Tipo de Ambiente: 1",
    });
    expect(danfse.identification.map((row) => row.map((field) => field.value))).toEqual([
      ["107", "15/10/2026", "15/10/2026 11:02:31"],
      ["12", "1", "15/10/2026 11:01:31"],
      ["Prestador", "NFS-e Gerada", "NFS-e regular"],
    ]);

    // O nome, o telefone e o endereço do prestador não vão na DPS: vêm do emitente.
    expect(values(block(danfse.sections, "PRESTADOR / FORNECEDOR"))).toEqual([
      ["11.222.333/0001-81", "12345", "(54) 2084-0005"],
      ["ESCRITORIO CONTABIL TESTE LTDA", "Getúlio Vargas / RS", "4308904 / 99.900-000"],
      ["RUA DAS FLORES, 551, CENTRO", "CONTATO@ESCRITORIO.TEST"],
      [
        "Optante - Microempresa ou Empresa de Pequeno Porte (ME/EPP)",
        "Regime de apuração dos tributos federais e municipal pelo Simples Nacional",
      ],
    ]);
    expect(values(block(danfse.sections, "TOMADOR / ADQUIRENTE"))).toEqual([
      ["33.000.167/0001-01", "-", "-"],
      ["PADARIA PAO & CIA LTDA", "Getúlio Vargas / RS", "4308904 / 99.900-000"],
      ["RUA DAS PALMEIRAS, 871, SANTO ANDRE", "-"],
    ]);
    expect(danfse.sections.filter((section) => section.kind === "notice")).toEqual([
      { kind: "notice", text: "DESTINATÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e" },
      { kind: "notice", text: "INTERMEDIÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e" },
    ]);
    expect(values(block(danfse.sections, "SERVIÇO PRESTADO"))).toEqual([
      ["17.19.01 / 001", "1.1302.21.00", "Getúlio Vargas / RS / -"],
      ["Atividades de contabilidade"],
      ["HONORÁRIOS CONTÁBEIS REFERENTE A COMPETÊNCIA 09/2026"],
    ]);
    // Sem regime especial, imunidade, benefício ou dedução, as duas linhas do meio saem.
    expect(values(block(danfse.sections, "TRIBUTAÇÃO MUNICIPAL (ISSQN)"))).toEqual([
      ["Operação Tributável", "Getúlio Vargas / RS / -"],
      ["-", "-", "Não Retido", "-"],
    ]);
    expect(values(block(danfse.sections, "TRIBUTAÇÃO FEDERAL (EXCETO CBS)"))).toEqual([
      ["-", "-", "-"],
      ["-", "-", "-"],
    ]);
    expect(values(block(danfse.sections, "TRIBUTAÇÃO IBS/CBS"))).toEqual([
      ["200 / 200052", "100301 / 4308904 / Getúlio Vargas / RS"],
      ["R$ 0,00", "R$ 250,00", "30,00 % / 30,00 % / 30,00 %", "0,10 % / 0,00 %"],
      ["0,00 %", "R$ 0,00", "0,07 %", "R$ 0,18"],
      ["R$ 0,18", "0,90 %", "0,63 %", "R$ 1,58"],
    ]);
    expect(values(block(danfse.sections, "VALOR TOTAL DA NFS-e"))).toEqual([
      ["R$ 250,00", "-", "-"],
      ["-", "R$ 250,00", "R$ 1,76", "R$ 250,00"],
    ]);
    expect(danfse.complementary).toEqual({
      text: null,
      approximateTaxes: "Totais aproximados dos Tributos cfe. Lei n° 12.741/2012: Federais: -; Estaduais: -; Municipais: -;",
    });
    expect(danfse.stub).toBe(`107 / ${TEST_ACCESS_KEY}`);
  });

  test("valor com milhar e nota de homologação", () => {
    const danfse = readDanfse(
      testNfseXml({ environment: 2, amountCents: 123456 }, { valores: "<valores><vLiq>1234.56</vLiq></valores>" }),
    );
    expect(danfse.homologation).toBe(true);
    expect(danfse.header.environment).toBe("Tipo de Ambiente: 2");
    expect(values(block(danfse.sections, "VALOR TOTAL DA NFS-e"))[1][1]).toBe("R$ 1.234,56");
    expect(values(block(danfse.sections, "VALOR TOTAL DA NFS-e"))[0][0]).toBe("R$ 1.234,56");
  });

  test("recusa o que não é NFS-e", () => {
    expect(() => readDanfse("<DPS/>")).toThrow("não é de uma NFS-e");
    expect(() => readDanfse("isto não é XML")).toThrow();
  });
});
