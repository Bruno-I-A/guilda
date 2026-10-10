import { buildDpsId, centsToNfseAmount, normalizeDpsSeries } from "@/domain/nfse";

import type { NfseTemplate } from "./template";
import {
  element,
  NFSE_APP_VERSION,
  NFSE_LAYOUT_VERSION,
  NFSE_NAMESPACE,
  XML_DECLARATION,
} from "./xml";

export interface DpsInput {
  environment: 1 | 2;
  issuedAt: string;
  competenceDate: string;
  series: string;
  number: number;
  providerCnpj: string;
  template: NfseTemplate;
  taker: { cnpj: string; name: string };
  amountCents: number;
  description: string;
}

function normalizeName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, 300);
}

/**
 * DPS da nota de honorário, na ordem exata das sequências do XSD v1.01.
 * O prestador é quem emite (tpEmit = 1), então nome e endereço dele vêm do
 * cadastro nacional e não são informados.
 */
export function buildDpsXml(input: DpsInput): { id: string; xml: string } {
  const t = input.template;
  const id = buildDpsId({
    cityCode: t.cityCode,
    cnpj: input.providerCnpj,
    series: input.series,
    number: input.number,
  });
  const regTrib =
    `<regTrib>${element("opSimpNac", t.taxRegime.opSimpNac)}` +
    `${element("regApTribSN", t.taxRegime.regApTribSN)}` +
    `${element("regEspTrib", t.taxRegime.regEspTrib)}</regTrib>`;
  const prest = `<prest>${element("CNPJ", input.providerCnpj)}${element("IM", t.municipalRegistration)}${regTrib}</prest>`;
  const toma = `<toma>${element("CNPJ", input.taker.cnpj)}${element("xNome", normalizeName(input.taker.name))}</toma>`;
  const cServ =
    `<cServ>${element("cTribNac", t.service.nationalTaxCode)}` +
    `${element("cTribMun", t.service.municipalTaxCode)}` +
    `${element("xDescServ", input.description)}` +
    `${element("cNBS", t.service.nbsCode)}</cServ>`;
  const serv = `<serv><locPrest>${element("cLocPrestacao", t.cityCode)}</locPrest>${cServ}</serv>`;
  const tribMun =
    `<tribMun>${element("tribISSQN", t.issqn.taxation)}` +
    `${element("tpRetISSQN", t.issqn.withholding)}${element("pAliq", t.issqn.rate)}</tribMun>`;
  const totTrib =
    t.totalTaxes.kind === "simples"
      ? `<totTrib>${element("pTotTribSN", t.totalTaxes.percent)}</totTrib>`
      : `<totTrib>${element("indTotTrib", "0")}</totTrib>`;
  const valores =
    `<valores><vServPrest>${element("vServ", centsToNfseAmount(input.amountCents))}</vServPrest>` +
    `<trib>${tribMun}${totTrib}</trib></valores>`;
  const infDps =
    `<infDPS Id="${id}">` +
    `${element("tpAmb", String(input.environment))}` +
    `${element("dhEmi", input.issuedAt)}` +
    `${element("verAplic", NFSE_APP_VERSION)}` +
    `${element("serie", normalizeDpsSeries(input.series))}` +
    `${element("nDPS", String(input.number))}` +
    `${element("dCompet", input.competenceDate)}` +
    `${element("tpEmit", "1")}` +
    `${element("cLocEmi", t.cityCode)}` +
    `${prest}${toma}${serv}${valores}</infDPS>`;
  return {
    id,
    xml: `${XML_DECLARATION}<DPS xmlns="${NFSE_NAMESPACE}" versao="${NFSE_LAYOUT_VERSION}">${infDps}</DPS>`,
  };
}
