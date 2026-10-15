import { buildDpsXml, type DpsInput } from "../dps-xml";
import type { NfseTemplate } from "../template";
import { NFSE_NAMESPACE, XML_DECLARATION } from "../xml";
import { TEST_TEMPLATE } from "./fixtures";

/** Modelo da nota real do escritório (nota 104 de 08/10/2026), com o município de Getúlio Vargas. */
export const OFFICE_TEMPLATE: NfseTemplate = {
  ...TEST_TEMPLATE,
  cityCode: "4308904",
  service: { nationalTaxCode: "171901", municipalTaxCode: "001", nbsCode: "113022100" },
  ibsCbs: { operationIndicator: "100301", cst: "200", classification: "200052" },
};

// cMun + ambGer + tpInsc + CNPJ + nNFSe + AAMM + código + DV: 50 dígitos.
export const TEST_ACCESS_KEY = `4308904${"2"}${"1"}11222333000181${"107".padStart(13, "0")}2610${"018125555"}4`;

/** Assinatura de mentira: o XSD exige o elemento, e o DANFSe não o lê. */
function fakeSignature(reference: string): string {
  return (
    `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo>` +
    `<CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>` +
    `<SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>` +
    `<Reference URI="#${reference}"><Transforms>` +
    `<Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/>` +
    `<Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/></Transforms>` +
    `<DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><DigestValue>AAAA</DigestValue></Reference>` +
    `</SignedInfo><SignatureValue>AAAA</SignatureValue>` +
    `<KeyInfo><X509Data><X509Certificate>AAAA</X509Certificate></X509Data></KeyInfo></Signature>`
  );
}

/**
 * NFS-e como o Sistema Nacional devolve em GET /nfse/{chave}: a DPS que a
 * Guilda envia, embrulhada no infNFSe com o emitente, os valores apurados e o
 * IBS/CBS calculado. Os números repetem a nota 104 do escritório; o tomador é
 * fictício.
 */
export function testNfseXml(overrides: Partial<DpsInput> = {}, infOverrides: { valores?: string } = {}): string {
  const { id, xml: dps } = buildDpsXml({
    environment: 1,
    issuedAt: "2026-10-15T11:01:31-03:00",
    competenceDate: "2026-10-15",
    series: "1",
    number: 12,
    providerCnpj: "11222333000181",
    template: OFFICE_TEMPLATE,
    taker: {
      cnpj: "33000167000101",
      name: "PADARIA PAO & CIA LTDA",
      address: {
        cityCode: "4308904",
        zipCode: "99900000",
        street: "RUA DAS PALMEIRAS",
        number: "871",
        complement: null,
        district: "SANTO ANDRE",
      },
    },
    amountCents: 25000,
    description: "HONORÁRIOS CONTÁBEIS REFERENTE A COMPETÊNCIA 09/2026",
    ...overrides,
  });
  const signedDps = dps
    .replace(XML_DECLARATION, "")
    .replace(` xmlns="${NFSE_NAMESPACE}"`, "")
    .replace("</infDPS>", `</infDPS>${fakeSignature(id)}`);
  const nfseId = `NFS${TEST_ACCESS_KEY}`;
  return (
    `${XML_DECLARATION}<NFSe xmlns="${NFSE_NAMESPACE}" versao="1.01"><infNFSe Id="${nfseId}">` +
    `<xLocEmi>Getúlio Vargas</xLocEmi><xLocPrestacao>Getúlio Vargas</xLocPrestacao><nNFSe>107</nNFSe>` +
    `<cLocIncid>4308904</cLocIncid><xLocIncid>Getúlio Vargas</xLocIncid>` +
    `<xTribNac>Atividades de contabilidade</xTribNac><xNBS>Serviços de contabilidade</xNBS>` +
    `<verAplic>SefinNac_1.6.0</verAplic><ambGer>2</ambGer><tpEmis>1</tpEmis><procEmi>1</procEmi>` +
    `<cStat>100</cStat><dhProc>2026-10-15T11:02:31-03:00</dhProc><nDFSe>1234567</nDFSe>` +
    `<emit><CNPJ>11222333000181</CNPJ><IM>12345</IM><xNome>ESCRITORIO CONTABIL TESTE LTDA</xNome>` +
    `<enderNac><xLgr>RUA DAS FLORES</xLgr><nro>551</nro><xBairro>CENTRO</xBairro>` +
    `<cMun>4308904</cMun><UF>RS</UF><CEP>99900000</CEP></enderNac>` +
    `<fone>5420840005</fone><email>CONTATO@ESCRITORIO.TEST</email></emit>` +
    (infOverrides.valores ?? `<valores><vLiq>250.00</vLiq></valores>`) +
    `<IBSCBS><cLocalidadeIncid>4308904</cLocalidadeIncid><xLocalidadeIncid>Getúlio Vargas</xLocalidadeIncid>` +
    `<valores><vBC>250.00</vBC>` +
    `<uf><pIBSUF>0.10</pIBSUF><pRedAliqUF>30.00</pRedAliqUF><pAliqEfetUF>0.07</pAliqEfetUF></uf>` +
    `<mun><pIBSMun>0</pIBSMun><pRedAliqMun>30.00</pRedAliqMun><pAliqEfetMun>0</pAliqEfetMun></mun>` +
    `<fed><pCBS>0.90</pCBS><pRedAliqCBS>30.00</pRedAliqCBS><pAliqEfetCBS>0.63</pAliqEfetCBS></fed></valores>` +
    `<totCIBS><vTotNF>250.00</vTotNF>` +
    `<gIBS><vIBSTot>0.18</vIBSTot><gIBSUFTot><vIBSUF>0.18</vIBSUF></gIBSUFTot><gIBSMunTot><vIBSMun>0</vIBSMun></gIBSMunTot></gIBS>` +
    `<gCBS><vCBS>1.58</vCBS></gCBS></totCIBS></IBSCBS>` +
    `${signedDps}</infNFSe>${fakeSignature(nfseId)}</NFSe>`
  );
}
