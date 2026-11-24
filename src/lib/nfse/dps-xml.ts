import { buildDpsId, centsToNfseAmount, normalizeDpsSeries, type NfseTakerAddress } from "@/domain/nfse";

import { nfseServiceRequiresConstruction, nfseServiceRequiresOperationType, type NfseIssuerTemplate } from "./template";
import {
  element,
  NFSE_APP_VERSION,
  NFSE_LAYOUT_VERSION,
  NFSE_NAMESPACE,
  XML_DECLARATION,
} from "./xml";

/**
 * Leiaute da DPS. "nt004": o de produção até 30/11/2026 (NT 004 v2.0).
 * "nt009": o da Nota Técnica 009 (XSD de produção restrita de 20/10/2026),
 * exigido na produção restrita desde 20/10/2026 e na produção a partir de
 * 01/12/2026. Diferenças que a Guilda usa: finNFSe sai do IBSCBS e vai para o
 * infDPS (obrigatório, logo após tpEmit); no cServ, cNBS vem antes do
 * xDescServ; no IBSCBS, CST e cClassTrib saem do gIBSCBS para o trib.
 */
export type NfseLayout = "nt004" | "nt009";

/** Virada da produção para a NT 009: 01/12/2026, 00h em Brasília. */
export const NT009_PRODUCTION_START = new Date("2026-12-01T00:00:00-03:00");

/**
 * O leiaute de uma DPS pelo ambiente e pela data de emissão. NFSE_LEIAUTE
 * (nt004 | nt009) força um dos dois — para o caso de o governo adiar ou
 * antecipar a virada sem precisar de deploy de código.
 */
export function nfseLayoutFor(environment: 1 | 2, issuedAt: Date, override = process.env.NFSE_LEIAUTE): NfseLayout {
  if (override === "nt004" || override === "nt009") return override;
  if (environment === 2) return "nt009";
  return issuedAt >= NT009_PRODUCTION_START ? "nt009" : "nt004";
}

export interface DpsInput {
  environment: 1 | 2;
  /** Sem informar, sai do ambiente e da data de emissão (nfseLayoutFor). */
  layout?: NfseLayout;
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
 * DPS de quem emite (escritório ou empresa-cliente), na ordem exata das
 * sequências do XSD v1.01 do leiaute em vigor (NT 004 ou NT 009).
 * O prestador é quem emite (tpEmit = 1), então nome e endereço dele vêm do
 * cadastro nacional e não são informados.
 */
export function buildDpsXml(input: DpsInput): { id: string; xml: string } {
  const t = input.template;
  const layout = input.layout ?? nfseLayoutFor(input.environment, new Date(input.issuedAt));
  const nt009 = layout === "nt009";
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
  // TCCServ: na NT 009 o cNBS vem antes da descrição.
  const serviceCodes = `${element("cTribNac", t.service.nationalTaxCode)}${element("cTribMun", t.service.municipalTaxCode)}`;
  const cServ = nt009
    ? `<cServ>${serviceCodes}${element("cNBS", t.service.nbsCode)}${element("xDescServ", input.description)}</cServ>`
    : `<cServ>${serviceCodes}${element("xDescServ", input.description)}${element("cNBS", t.service.nbsCode)}</cServ>`;
  // E0370: serviço de obra leva o grupo da obra logo depois do cServ (TCServ:
  // locPrest, cServ, comExt, obra). Fora desses serviços ele não vai.
  const c = nfseServiceRequiresConstruction(t.service.nationalTaxCode) ? t.construction : undefined;
  const obra = !c
    ? ""
    : `<obra>${element("inscImobFisc", c.propertyRegistration)}` +
      (c.kind === "cno"
        ? element("cObra", c.code)
        : c.kind === "cib"
          ? element("cCIB", c.code)
          : `<end>${element("CEP", c.zipCode)}${element("xLgr", c.street)}${element("nro", c.number)}${element("xCpl", c.complement)}${element("xBairro", c.district)}</end>`) +
      `</obra>`;
  // A obra é igual nos dois leiautes (TCInfoObra não mudou na NT 009).
  const serv = `<serv><locPrest>${element("cLocPrestacao", t.cityCode)}</locPrest>${cServ}${obra}</serv>`;
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
  // Ordem do TCRTCInfoIBSCBS: (finNFSe só na NT 004), (indFinal), cIndOp, ..., indDest, ..., valores.
  // finNFSe 0 = NFS-e regular; indDest 0 = o tomador é o próprio destinatário.
  // NT 009: CST e cClassTrib direto no trib (o gIBSCBS fica para crédito presumido/diferimento).
  // E0903/E0904: o tipo de operação é da empresa, mas só vai nos serviços que o
  // exigem. Quem decide é o serviço desta nota, que pode não ser o da empresa.
  const operationType = nfseServiceRequiresOperationType(t.service.nationalTaxCode) ? t.ibsCbs?.operationType : undefined;
  const classification = t.ibsCbs ? `${element("CST", t.ibsCbs.cst)}${element("cClassTrib", t.ibsCbs.classification)}` : "";
  const ibsCbs = t.ibsCbs
    ? `<IBSCBS>${nt009 ? "" : element("finNFSe", "0")}${element("cIndOp", t.ibsCbs.operationIndicator)}${element("tpOper", operationType)}${element("indDest", "0")}` +
      `<valores><trib>${nt009 ? classification : `<gIBSCBS>${classification}</gIBSCBS>`}</trib></valores></IBSCBS>`
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
    // NT 009: finalidade da NFS-e no infDPS, obrigatória em toda nota (0 = regular).
    `${nt009 ? element("finNFSe", "0") : ""}` +
    `${element("cLocEmi", t.cityCode)}` +
    `${prest}${toma}${serv}${valores}${ibsCbs}</infDPS>`;
  return {
    id,
    xml: `${XML_DECLARATION}<DPS xmlns="${NFSE_NAMESPACE}" versao="${NFSE_LAYOUT_VERSION}">${infDps}</DPS>`,
  };
}
