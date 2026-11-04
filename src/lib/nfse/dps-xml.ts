import { buildDpsId, centsToNfseAmount, normalizeDpsSeries, type NfseTakerAddress } from "@/domain/nfse";

import { nfseServiceRequiresOperationType, type NfseIssuerTemplate } from "./template";
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
  template: NfseIssuerTemplate;
  taker: { cnpj: string; name: string; address?: NfseTakerAddress | null };
  amountCents: number;
  description: string;
}

function normalizeName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, 300);
}

/**
 * DPS de quem emite (escritório ou empresa-cliente), na ordem exata das sequências do XSD v1.01.
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
  // TCInfoPessoa: CNPJ, xNome, end (endNac com município e CEP, depois rua,
  // número, complemento e bairro). Obrigatório quando a nota leva IBS/CBS.
  const address = input.taker.address;
  const end = address
    ? `<end><endNac>${element("cMun", address.cityCode)}${element("CEP", address.zipCode)}</endNac>` +
      `${element("xLgr", address.street)}${element("nro", address.number)}` +
      `${element("xCpl", address.complement)}${element("xBairro", address.district)}</end>`
    : "";
  // Tomador avulso pessoa física (produtor rural) vai com CPF.
  const document = input.taker.cnpj.length === 11 ? element("CPF", input.taker.cnpj) : element("CNPJ", input.taker.cnpj);
  const toma = `<toma>${document}${element("xNome", normalizeName(input.taker.name))}${end}</toma>`;
  const cServ =
    `<cServ>${element("cTribNac", t.service.nationalTaxCode)}` +
    `${element("cTribMun", t.service.municipalTaxCode)}` +
    `${element("xDescServ", input.description)}` +
    `${element("cNBS", t.service.nbsCode)}</cServ>`;
  const serv = `<serv><locPrest>${element("cLocPrestacao", t.cityCode)}</locPrest>${cServ}</serv>`;
  // A alíquota só vai quando o Sistema Nacional não a tira do cadastro do
  // município. E0625: ME/EPP que apura o ISS pelo Simples, sem retenção (ela
  // está no DAS). E0617: não optante do Simples, com o município ativo no
  // Sistema Nacional (vale a do município). O modelo copiado de uma nota
  // antiga pode trazer a alíquota; nesses casos ela fica de fora.
  const issInSimples = t.taxRegime.opSimpNac === "3" && t.taxRegime.regApTribSN === "1" && t.issqn.withholding === "1";
  const notOptant = t.taxRegime.opSimpNac === "1";
  const tribMun =
    `<tribMun>${element("tribISSQN", t.issqn.taxation)}` +
    `${element("tpRetISSQN", t.issqn.withholding)}${issInSimples || notOptant ? "" : element("pAliq", t.issqn.rate)}</tribMun>`;
  // Retenções federais da nota (já em centavos, calculadas ao pedir).
  const fed = t.federal;
  const money = (cents: number | undefined) => (cents ? centsToNfseAmount(cents) : undefined);
  const pisCofins = fed?.pisCofins
    ? `<piscofins>${element("CST", fed.pisCofins.cst)}${element("vBCPisCofins", centsToNfseAmount(fed.pisCofins.baseCents))}` +
      `${element("pAliqPis", fed.pisCofins.pisPercent)}${element("pAliqCofins", fed.pisCofins.cofinsPercent)}` +
      `${element("vPis", fed.pisCofins.pisCents ? centsToNfseAmount(fed.pisCofins.pisCents) : "0.00")}` +
      `${element("vCofins", fed.pisCofins.cofinsCents ? centsToNfseAmount(fed.pisCofins.cofinsCents) : "0.00")}` +
      `${element("tpRetPisCofins", fed.pisCofins.retention)}</piscofins>`
    : "";
  const tribFed = fed
    ? `<tribFed>${pisCofins}${element("vRetCP", money(fed.cpCents))}${element("vRetIRRF", money(fed.irrfCents))}${element("vRetCSLL", money(fed.csllCents))}</tribFed>`
    : "";
  const totTrib =
    t.totalTaxes.kind === "simples"
      ? `<totTrib>${element("pTotTribSN", t.totalTaxes.percent)}</totTrib>`
      : t.totalTaxes.kind === "percent"
        ? `<totTrib><pTotTrib>${element("pTotTribFed", t.totalTaxes.federal)}${element("pTotTribEst", t.totalTaxes.state)}${element("pTotTribMun", t.totalTaxes.municipal)}</pTotTrib></totTrib>`
        : `<totTrib>${element("indTotTrib", "0")}</totTrib>`;
  const valores =
    `<valores><vServPrest>${element("vServ", centsToNfseAmount(input.amountCents))}</vServPrest>` +
    `<trib>${tribMun}${tribFed}${totTrib}</trib></valores>`;
  // Ordem do TCRTCInfoIBSCBS: finNFSe, (indFinal), cIndOp, ..., indDest, ..., valores.
  // finNFSe 0 = NFS-e regular; indDest 0 = o tomador é o próprio destinatário.
  // E0903/E0904: o tipo de operação é da empresa, mas só vai nos serviços que o
  // exigem. Quem decide é o serviço desta nota, que pode não ser o da empresa.
  const operationType = nfseServiceRequiresOperationType(t.service.nationalTaxCode) ? t.ibsCbs?.operationType : undefined;
  const ibsCbs = t.ibsCbs
    ? `<IBSCBS>${element("finNFSe", "0")}${element("cIndOp", t.ibsCbs.operationIndicator)}${element("tpOper", operationType)}${element("indDest", "0")}` +
      `<valores><trib><gIBSCBS>${element("CST", t.ibsCbs.cst)}${element("cClassTrib", t.ibsCbs.classification)}</gIBSCBS></trib></valores></IBSCBS>`
    : "";
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
    `${prest}${toma}${serv}${valores}${ibsCbs}</infDPS>`;
  return {
    id,
    xml: `${XML_DECLARATION}<DPS xmlns="${NFSE_NAMESPACE}" versao="${NFSE_LAYOUT_VERSION}">${infDps}</DPS>`,
  };
}
