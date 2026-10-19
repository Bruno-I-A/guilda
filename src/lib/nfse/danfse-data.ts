import type { Element } from "@xmldom/xmldom";

import { formatCnpj } from "@/domain/cnpj";
import { amountToCents } from "@/domain/nfse";

import { ibgeCity } from "./municipios";
import { at, child, parseXmlRoot, read } from "./xml-dom";

/**
 * O DANFSe (o PDF da nota) a partir do XML da NFS-e, no leiaute v2.0 da
 * NT 008/2026. A API do governo que gerava o PDF foi suspensa em 03/08/2026;
 * desde então quem emite precisa montar o próprio. Aqui só se lê e formata:
 * tudo vem do XML ("não poderão ser impressas informações que não constem do
 * arquivo da NFS-e") e o que falta vira traço. Os formatos seguem o DANFSe
 * que o Portal Nacional gera para as notas do escritório (nota 104).
 */

export interface DanfseField {
  label: string;
  value: string;
  /** Colunas ocupadas, de quatro. */
  span?: number;
  shaded?: boolean;
  /** Quebra em várias linhas; os demais campos são cortados com reticências. */
  multiline?: boolean;
}

export type DanfseSection =
  /** O título ocupa a primeira coluna da primeira linha. */
  | { kind: "block"; title: string; rows: DanfseField[][] }
  | { kind: "notice"; text: string };

export interface Danfse {
  accessKey: string;
  qrCodeUrl: string;
  homologation: boolean;
  header: { city: string; generator: string; environment: string };
  /** Linhas da identificação, abaixo da chave de acesso. */
  identification: DanfseField[][];
  sections: DanfseSection[];
  complementary: { text: string | null; approximateTaxes: string };
  /** "Nº NFS-e / chave", do canhoto. */
  stub: string;
}

const DASH = "-";
const QR_CODE_BASE = "https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=";

const STATUS: Record<string, string> = {
  "100": "NFS-e Gerada",
  "102": "NFS-e de Decisão Judicial",
  "103": "NFS-e Avulsa",
  "107": "NFS-e MEI",
};
const ISSUER: Record<string, string> = { "1": "Prestador", "2": "Tomador", "3": "Intermediário" };
const PURPOSE: Record<string, string> = { "0": "NFS-e regular" };
const SIMPLES: Record<string, string> = {
  "1": "Não Optante",
  "2": "Optante - Microempreendedor Individual (MEI)",
  "3": "Optante - Microempresa ou Empresa de Pequeno Porte (ME/EPP)",
};
const SIMPLES_REGIME: Record<string, string> = {
  "1": "Regime de apuração dos tributos federais e municipal pelo Simples Nacional",
  "2": "Regime de apuração dos tributos federais pelo SN e o ISSQN por fora do SN conforme respectiva legislação municipal do tributo",
  "3": "Regime de apuração dos tributos federais e municipal por fora do SN conforme respectivas legislações federal e municipal de cada tributo",
};
const SPECIAL_REGIME: Record<string, string> = {
  "1": "Ato Cooperado (Cooperativa)",
  "2": "Estimativa",
  "3": "Microempresa Municipal",
  "4": "Notário ou Registrador",
  "5": "Profissional Autônomo",
  "6": "Sociedade de Profissionais",
  "9": "Outros",
};
const ISSQN_TAXATION: Record<string, string> = {
  "1": "Operação Tributável",
  "2": "Imunidade",
  "3": "Exportação de Serviço",
  "4": "Não Incidência",
};
const IMMUNITY: Record<string, string> = {
  "0": "Imunidade (tipo não informado na nota de origem)",
  "1": "Patrimônio, renda ou serviços, uns dos outros",
  "2": "Templos de qualquer culto",
  "3": "Patrimônio, renda ou serviços dos partidos políticos e entidades sem fins lucrativos",
  "4": "Livros, jornais, periódicos e o papel destinado a sua impressão",
  "5": "Fonogramas e videofonogramas musicais produzidos no Brasil",
};
const SUSPENSION: Record<string, string> = {
  "1": "Exigibilidade Suspensa por Decisão Judicial",
  "2": "Exigibilidade Suspensa por Processo Administrativo",
};
const MUNICIPAL_BENEFIT: Record<string, string> = {
  "1": "Isenção",
  "2": "Redução da BC em %",
  "3": "Redução da BC em R$",
  "4": "Alíquota Diferenciada",
};
const ISSQN_WITHHOLDING: Record<string, string> = {
  "1": "Não Retido",
  "2": "Retido pelo Tomador",
  "3": "Retido pelo Intermediário",
};
const PIS_COFINS_WITHHOLDING: Record<string, string> = {
  "0": "PIS/COFINS/CSLL Não Retidos",
  "1": "PIS/COFINS Retidos",
  "2": "PIS/COFINS Não Retidos",
  "3": "PIS/COFINS/CSLL Retidos",
  "4": "PIS/COFINS Retidos, CSLL Não Retido",
  "5": "PIS Retido, COFINS/CSLL Não Retido",
  "6": "COFINS Retido, PIS/CSLL Não Retido",
  "7": "PIS Não Retido, COFINS/CSLL Retidos",
  "8": "PIS/COFINS Não Retidos, CSLL Retido",
  "9": "COFINS Não Retido, PIS/CSLL Retidos",
};

// ---------------------------------------------------------------- formatos

function decimal(value: string): string {
  const [integer, fraction = ""] = value.split(".");
  return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${fraction.padEnd(2, "0")}`;
}

function money(value: string | null): string {
  return value === null ? DASH : `R$ ${decimal(value)}`;
}

function percent(value: string | null): string {
  return value === null ? DASH : `${decimal(value)} %`;
}

/** Soma de valores do XML; sem nenhum deles, null. */
function sum(values: (string | null)[]): string | null {
  const present = values.filter((value): value is string => value !== null);
  if (present.length === 0) return null;
  const cents = present.reduce((total, value) => total + amountToCents(value), 0);
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

function date(value: string | null): string {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  return match ? `${match[3]}/${match[2]}/${match[1]}` : DASH;
}

/** A hora como o XML traz (já no fuso de quem emitiu), sem converter. */
function dateTime(value: string | null): string {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2}:\d{2})/.exec(value) : null;
  return match ? `${match[3]}/${match[2]}/${match[1]} ${match[4]}` : DASH;
}

function zipCode(value: string): string {
  return /^\d{8}$/.test(value) ? `${value.slice(0, 2)}.${value.slice(2, 5)}-${value.slice(5)}` : value;
}

function phone(value: string | null): string {
  if (!value) return DASH;
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  return value;
}

function cityName(code: string | null): { name: string; state: string } | null {
  return code ? ibgeCity(code) : null;
}

function labelOf(map: Record<string, string>, code: string | null): string {
  return code === null ? DASH : (map[code] ?? code);
}

function orDash(value: string | null): string {
  return value ?? DASH;
}

function joinParts(parts: (string | null)[]): string {
  const present = parts.filter((part): part is string => Boolean(part));
  return present.length > 0 ? present.join(", ") : DASH;
}

// ---------------------------------------------------------------- pessoas

interface Party {
  document: string;
  municipalRegistration: string;
  phone: string;
  name: string;
  city: string;
  cityCodeAndZip: string;
  address: string;
  email: string;
}

function documentOf(element: Element | null): string {
  const cnpj = read(element, "CNPJ");
  if (cnpj) return formatCnpj(cnpj);
  const cpf = read(element, "CPF");
  if (cpf && /^\d{11}$/.test(cpf)) return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
  return orDash(cpf ?? read(element, "NIF"));
}

/** prest, toma, interm e dest: CNPJ/CPF/NIF, nome e o endereço nacional ou exterior. */
function readParty(element: Element | null): Party | null {
  if (!element) return null;
  const address = child(element, "end");
  const national = child(address, "endNac");
  const foreign = child(address, "endExt");
  let city = DASH;
  let cityCodeAndZip = DASH;
  if (national) {
    const code = read(national, "cMun");
    const known = cityName(code);
    city = known ? `${known.name} / ${known.state}` : orDash(code);
    const zip = read(national, "CEP");
    cityCodeAndZip = `${orDash(code)} / ${zip ? zipCode(zip) : DASH}`;
  } else if (foreign) {
    city = `${orDash(read(foreign, "xCidade"))} / ${orDash(read(foreign, "cPais"))}`;
    cityCodeAndZip = `${DASH} / ${orDash(read(foreign, "cEndPost"))}`;
  }
  return {
    document: documentOf(element),
    municipalRegistration: orDash(read(element, "IM")),
    phone: phone(read(element, "fone")),
    name: orDash(read(element, "xNome")),
    city,
    cityCodeAndZip,
    address: address
      ? joinParts([read(address, "xLgr"), read(address, "nro"), read(address, "xCpl"), read(address, "xBairro")])
      : DASH,
    email: orDash(read(element, "email")),
  };
}

/** O emitente que o Sistema Nacional grava na nota, com o endereço completo. */
function readEmitter(emit: Element | null): Party | null {
  if (!emit) return null;
  const address = child(emit, "enderNac");
  const code = read(address, "cMun");
  const known = cityName(code);
  const zip = read(address, "CEP");
  return {
    document: documentOf(emit),
    municipalRegistration: orDash(read(emit, "IM")),
    phone: phone(read(emit, "fone")),
    name: orDash(read(emit, "xNome")),
    city: known ? `${known.name} / ${known.state}` : orDash(read(address, "UF")),
    cityCodeAndZip: `${orDash(code)} / ${zip ? zipCode(zip) : DASH}`,
    address: joinParts([read(address, "xLgr"), read(address, "nro"), read(address, "xCpl"), read(address, "xBairro")]),
    email: orDash(read(emit, "email")),
  };
}

/** Campo a campo, o que a DPS não trouxe vem do emitente (quando o emitente é o prestador). */
function mergeParty(primary: Party | null, fallback: Party | null): Party | null {
  if (!primary || !fallback) return primary ?? fallback;
  const merged = { ...primary };
  for (const key of Object.keys(merged) as (keyof Party)[]) {
    if (merged[key] === DASH || merged[key] === `${DASH} / ${DASH}`) merged[key] = fallback[key];
  }
  return merged;
}

function partyBlock(title: string, party: Party, withRegistration = true): DanfseSection {
  return {
    kind: "block",
    title,
    rows: [
      [
        { label: "CNPJ / CPF / NIF", value: party.document },
        withRegistration
          ? { label: "Indicador Municipal (Inscrição)", value: party.municipalRegistration }
          : { label: "", value: "" },
        { label: "Telefone", value: party.phone },
      ],
      [
        { label: "Nome / Nome Empresarial", value: party.name, span: 2 },
        { label: "Município / Sigla UF", value: party.city },
        { label: "Código IBGE / CEP", value: party.cityCodeAndZip },
      ],
      [
        { label: "Endereço", value: party.address, span: 2 },
        { label: "E-mail", value: party.email, span: 2 },
      ],
    ],
  };
}

// ---------------------------------------------------------------- códigos

/** "171901" → "17.19.01"; com o código municipal, "17.19.01 / 001". */
function serviceCode(national: string | null, municipal: string | null): string {
  if (!national) return DASH;
  const formatted = /^\d{6}$/.test(national)
    ? `${national.slice(0, 2)}.${national.slice(2, 4)}.${national.slice(4)}`
    : national;
  return municipal ? `${formatted} / ${municipal}` : formatted;
}

/** "113022100" → "1.1302.21.00". */
function nbsCode(value: string | null): string {
  if (!value) return DASH;
  return /^\d{9}$/.test(value) ? `${value[0]}.${value.slice(1, 5)}.${value.slice(5, 7)}.${value.slice(7)}` : value;
}

/** "Município / UF / País"; o país só existe no XML quando é exterior. */
function placeWithCountry(name: string | null, code: string | null, country: string | null): string {
  if (!name && !code) return DASH;
  const state = cityName(code)?.state ?? DASH;
  return `${name ?? cityName(code)?.name ?? DASH} / ${state} / ${orDash(country)}`;
}

function approximateTaxes(totals: Element | null): string {
  const monetary = child(totals, "vTotTrib");
  const percentual = child(totals, "pTotTrib");
  const parts: [string, string][] = monetary
    ? [
        ["Federais", money(read(monetary, "vTotTribFed"))],
        ["Estaduais", money(read(monetary, "vTotTribEst"))],
        ["Municipais", money(read(monetary, "vTotTribMun"))],
      ]
    : percentual
      ? [
          ["Federais", percent(read(percentual, "pTotTribFed"))],
          ["Estaduais", percent(read(percentual, "pTotTribEst"))],
          ["Municipais", percent(read(percentual, "pTotTribMun"))],
        ]
      : [
          ["Federais", DASH],
          ["Estaduais", DASH],
          ["Municipais", DASH],
        ];
  return `Totais aproximados dos Tributos cfe. Lei n° 12.741/2012: ${parts.map(([name, value]) => `${name}: ${value};`).join(" ")}`;
}

// ---------------------------------------------------------------- DANFSe

export function readDanfse(nfseXml: string): Danfse {
  const root = parseXmlRoot(nfseXml);
  const inf = root?.localName === "NFSe" ? child(root, "infNFSe") : null;
  const dps = at(inf, "DPS/infDPS");
  if (!inf || !dps) throw new Error("O XML recebido não é de uma NFS-e.");

  const accessKey = (inf.getAttribute("Id") ?? "").replace(/^NFS/, "");
  if (!/^\d{50}$/.test(accessKey)) throw new Error("A NFS-e não tem chave de acesso válida.");

  const emit = child(inf, "emit");
  const environment = read(dps, "tpAmb");
  const issuer = read(dps, "tpEmit");
  const ibsCbsDps = child(dps, "IBSCBS");
  const ibsCbs = child(inf, "IBSCBS");
  const values = child(dps, "valores");
  const municipal = at(values, "trib/tribMun");
  const federal = at(values, "trib/tribFed");
  const pisCofins = child(federal, "piscofins");
  const nfseValues = child(inf, "valores");
  const discounts = child(values, "vDescCondIncond");
  const ibsCbsValues = child(ibsCbs, "valores");
  const ibsTotals = at(ibsCbs, "totCIBS/gIBS");
  const cbsTotals = at(ibsCbs, "totCIBS/gCBS");
  const competence = read(dps, "dCompet");

  const sections: DanfseSection[] = [];

  const emitter = readEmitter(emit);
  const provider = mergeParty(readParty(child(dps, "prest")), issuer === "1" ? emitter : null) ?? emitter;
  if (provider) {
    const block = partyBlock("PRESTADOR / FORNECEDOR", provider) as Extract<DanfseSection, { kind: "block" }>;
    block.rows.push([
      { label: "Simples Nacional na Data de Competência", value: labelOf(SIMPLES, read(dps, "prest/regTrib/opSimpNac")) },
      {
        label: "Regime de Apuração Tributária pelo SN",
        value: labelOf(SIMPLES_REGIME, read(dps, "prest/regTrib/regApTribSN")),
        span: 3,
      },
    ]);
    sections.push(block);
  }

  const taker = readParty(child(dps, "toma"));
  sections.push(
    taker
      ? partyBlock("TOMADOR / ADQUIRENTE", taker)
      : { kind: "notice", text: "TOMADOR/ADQUIRENTE DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e" },
  );
  const recipient = readParty(child(ibsCbsDps, "dest"));
  sections.push(
    recipient
      ? partyBlock("DESTINATÁRIO DA OPERAÇÃO", recipient, false)
      : { kind: "notice", text: "DESTINATÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e" },
  );
  const intermediary = readParty(child(dps, "interm"));
  sections.push(
    intermediary
      ? partyBlock("INTERMEDIÁRIO DA OPERAÇÃO", intermediary)
      : { kind: "notice", text: "INTERMEDIÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e" },
  );

  sections.push({
    kind: "block",
    title: "SERVIÇO PRESTADO",
    rows: [
      [
        {
          label: "Código de Tributação Nacional/Municipal",
          value: serviceCode(read(dps, "serv/cServ/cTribNac"), read(dps, "serv/cServ/cTribMun")),
        },
        { label: "Código da NBS", value: nbsCode(read(dps, "serv/cServ/cNBS")) },
        {
          label: "Local da Prestação / Sigla UF / País",
          value: placeWithCountry(
            read(inf, "xLocPrestacao"),
            read(dps, "serv/locPrest/cLocPrestacao"),
            read(dps, "serv/locPrest/cPaisPrestacao"),
          ),
        },
      ],
      [{ label: "", value: orDash(read(inf, "xTribMun") ?? read(inf, "xTribNac")), span: 4 }],
      [{ label: "Descrição do Serviço", value: orDash(read(dps, "serv/cServ/xDescServ")), span: 4, multiline: true }],
    ],
  });

  const issqnRows: DanfseField[][] = [
    [
      { label: "Tipo de Tributação do ISSQN", value: labelOf(ISSQN_TAXATION, read(municipal, "tribISSQN")) },
      {
        label: "Município / Sigla UF / País de Incidência do ISSQN",
        value: placeWithCountry(read(inf, "xLocIncid"), read(inf, "cLocIncid"), read(municipal, "cPaisResult")),
        span: 2,
      },
    ],
  ];
  // Linhas opcionais (nota 5 da NT): saem quando nenhum campo delas tem dado.
  // Regime especial "0 - Nenhum" não conta como dado, como no DANFSe do Portal.
  const specialRegime = read(dps, "prest/regTrib/regEspTrib");
  const exemptionRow: DanfseField[] = [
    { label: "Regime Especial de Tributação do ISSQN", value: specialRegime === "0" ? DASH : labelOf(SPECIAL_REGIME, specialRegime) },
    { label: "Tipo de Imunidade do ISSQN", value: labelOf(IMMUNITY, read(municipal, "tpImunidade")) },
    { label: "Suspensão da Exigibilidade do ISSQN", value: labelOf(SUSPENSION, read(municipal, "exigSusp/tpSusp")) },
    { label: "Número Processo Suspensão", value: orDash(read(municipal, "exigSusp/nProcesso")) },
  ];
  const deductionsRow: DanfseField[] = [
    { label: "Benefício Municipal", value: labelOf(MUNICIPAL_BENEFIT, read(nfseValues, "tpBM")) },
    { label: "Cálculo do BM", value: money(read(nfseValues, "vCalcBM") ?? read(municipal, "BM/vRedBCBM")) },
    {
      label: "Total Deduções/Reduções",
      value: money(sum([read(nfseValues, "vCalcDR") ?? read(values, "vDedRed/vDR"), read(ibsCbsValues, "vCalcReeRepRes")])),
    },
    { label: "Desconto Incondicionado", value: money(read(discounts, "vDescIncond")) },
  ];
  for (const row of [exemptionRow, deductionsRow]) {
    if (row.some((field) => field.value !== DASH)) issqnRows.push(row);
  }
  issqnRows.push([
    { label: "BC ISSQN", value: money(read(nfseValues, "vBC")) },
    { label: "Alíquota Aplicada", value: percent(read(nfseValues, "pAliqAplic")) },
    { label: "Retenção do ISSQN", value: labelOf(ISSQN_WITHHOLDING, read(municipal, "tpRetISSQN")) },
    { label: "ISSQN Apurado", value: money(read(nfseValues, "vISSQN")) },
  ]);
  sections.push({ kind: "block", title: "TRIBUTAÇÃO MUNICIPAL (ISSQN)", rows: issqnRows });

  // Com PIS/COFINS retidos (tpRetPisCofins 1), os dois entram nas
  // contribuições retidas e o débito de apuração própria zera (NT 008 v1.02).
  const pisCofinsWithheld = read(pisCofins, "tpRetPisCofins") === "1";
  const federalRows: DanfseField[][] = [
    [
      { label: "IRRF", value: money(read(federal, "vRetIRRF")) },
      { label: "Contribuição Previdenciária - Retida", value: money(read(federal, "vRetCP")) },
      {
        label: "Contribuições Sociais - Retidas",
        value: money(
          pisCofinsWithheld
            ? sum([read(federal, "vRetCSLL"), read(pisCofins, "vPis"), read(pisCofins, "vCofins")])
            : read(federal, "vRetCSLL"),
        ),
      },
    ],
  ];
  // Só para competência até o fim de 2026 (nota 6 da NT).
  if (!competence || Number(competence.slice(0, 4)) <= 2026) {
    const withholding = read(pisCofins, "tpRetPisCofins");
    federalRows.push([
      { label: "PIS - Débito Apuração Própria", value: pisCofinsWithheld ? money("0.00") : money(read(pisCofins, "vPis")) },
      { label: "COFINS - Débito Apuração Própria", value: pisCofinsWithheld ? money("0.00") : money(read(pisCofins, "vCofins")) },
      {
        label: "Descrição Contrib. Sociais - Retidas",
        value: withholding === null ? DASH : `${withholding} - ${labelOf(PIS_COFINS_WITHHOLDING, withholding)}`,
        span: 2,
      },
    ]);
  }
  sections.push({ kind: "block", title: "TRIBUTAÇÃO FEDERAL (EXCETO CBS)", rows: federalRows });

  const classification = at(ibsCbsDps, "valores/trib/gIBSCBS");
  const incidenceCode = read(ibsCbs, "cLocalidadeIncid");
  const cst = read(classification, "CST");
  const classTrib = read(classification, "cClassTrib");
  const exclusions = ibsCbs
    ? (sum([
        read(discounts, "vDescIncond"),
        read(ibsCbsValues, "vCalcReeRepRes"),
        read(nfseValues, "vISSQN"),
        read(pisCofins, "vPis"),
        read(pisCofins, "vCofins"),
      ]) ?? "0.00")
    : null;
  const ibsTotal = read(ibsTotals, "vIBSTot");
  const cbsTotal = read(cbsTotals, "vCBS");
  sections.push({
    kind: "block",
    title: "TRIBUTAÇÃO IBS/CBS",
    rows: [
      [
        { label: "CST / cClassTrib", value: cst || classTrib ? `${orDash(cst)} / ${orDash(classTrib)}` : DASH },
        {
          label: "Indicador de Operação / Código IBGE Incidência / Município Incidência / Sigla UF",
          value: ibsCbs
            ? [
                orDash(read(ibsCbsDps, "cIndOp")),
                orDash(incidenceCode),
                orDash(read(ibsCbs, "xLocalidadeIncid")),
                cityName(incidenceCode)?.state ?? DASH,
              ].join(" / ")
            : DASH,
          span: 2,
        },
      ],
      [
        { label: "Exclusões e Reduções da Base de Cálculo", value: money(exclusions) },
        { label: "Base de Cálculo Após Exclusões e Reduções", value: money(read(ibsCbsValues, "vBC")) },
        {
          label: "Red. Alíquota IBS / Red. Alíquota CBS",
          value: ibsCbs
            ? [
                percent(read(ibsCbsValues, "uf/pRedAliqUF")),
                percent(read(ibsCbsValues, "mun/pRedAliqMun")),
                percent(read(ibsCbsValues, "fed/pRedAliqCBS")),
              ].join(" / ")
            : DASH,
        },
        {
          label: "Alíquota - IBS UF / IBS Mun",
          value: ibsCbs
            ? `${percent(read(ibsCbsValues, "uf/pIBSUF"))} / ${percent(read(ibsCbsValues, "mun/pIBSMun"))}`
            : DASH,
        },
      ],
      [
        { label: "Alíq. Efetiva Municipal - IBS", value: percent(read(ibsCbsValues, "mun/pAliqEfetMun")) },
        { label: "Valor Apurado Municipal - IBS", value: money(read(ibsTotals, "gIBSMunTot/vIBSMun")) },
        { label: "Alíq. Efetiva Estadual - IBS", value: percent(read(ibsCbsValues, "uf/pAliqEfetUF")) },
        { label: "Valor Apurado Estadual - IBS", value: money(read(ibsTotals, "gIBSUFTot/vIBSUF")) },
      ],
      [
        { label: "Valor Total Apurado - IBS", value: money(ibsTotal) },
        { label: "Alíquota - CBS", value: percent(read(ibsCbsValues, "fed/pCBS")) },
        { label: "Alíquota Efetiva - CBS", value: percent(read(ibsCbsValues, "fed/pAliqEfetCBS")) },
        { label: "Valor Total Apurado - CBS", value: money(cbsTotal) },
      ],
    ],
  });

  sections.push({
    kind: "block",
    title: "VALOR TOTAL DA NFS-e",
    rows: [
      [
        { label: "VALOR DA OPERAÇÃO / SERVIÇO", value: money(read(values, "vServPrest/vServ")) },
        { label: "Desconto Incondicionado", value: money(read(discounts, "vDescIncond")) },
        { label: "Desconto Condicionado", value: money(read(discounts, "vDescCond")) },
      ],
      [
        { label: "Total das Retenções (ISSQN / Federais)", value: money(read(nfseValues, "vTotalRet")) },
        { label: "VALOR LÍQUIDO DA NFS-e", value: money(read(nfseValues, "vLiq")) },
        { label: "Total do IBS/CBS", value: money(sum([ibsTotal, cbsTotal])) },
        { label: "VALOR LÍQUIDO DA NFS-e + IBS/CBS", value: money(read(ibsCbs, "totCIBS/vTotNF")), shaded: true },
      ],
    ],
  });

  // Ordem e rótulos do item 2.4.5 da NT, separados por " | ".
  const complementary = [
    ["Inf. Cont.", read(dps, "serv/infoCompl/xInfComp")],
    ["NFS-e Subst.", read(dps, "subst/chSubstda")],
    ["Doc. Ref.", read(dps, "serv/infoCompl/docRef")],
    ["Cod. Obra", read(dps, "serv/obra/cObra")],
    ["Insc. Imob.", read(dps, "serv/obra/inscImobFisc")],
    ["Cod. Evt.", read(dps, "serv/atvEvento/idAtvEvt")],
    ["Doc. Tec.", read(dps, "serv/infoCompl/idDocTec")],
    ["Núm. Ped.", read(dps, "serv/infoCompl/xPed")],
    ["Item Ped.", read(dps, "serv/infoCompl/gItemPed/xItemPed")],
    ["Inf. A. T. Mun.", read(inf, "xOutInf")],
  ]
    .filter((entry): entry is [string, string] => entry[1] !== null)
    .map(([label, value]) => `${label}: ${value}`)
    .join(" | ");

  const city = read(inf, "xLocEmi");
  const nfseNumber = orDash(read(inf, "nNFSe"));
  return {
    accessKey,
    qrCodeUrl: `${QR_CODE_BASE}${accessKey}`,
    homologation: environment === "2",
    header: {
      city: `Município: ${orDash(city)} - ${orDash(read(emit, "enderNac/UF"))}`,
      generator: `Ambiente Gerador: ${orDash(read(inf, "ambGer"))}`,
      environment: `Tipo de Ambiente: ${orDash(environment)}`,
    },
    identification: [
      [
        { label: "NÚMERO DA NFS-e", value: nfseNumber },
        { label: "COMPETÊNCIA DA NFS-e", value: date(competence) },
        { label: "DATA E HORA DA EMISSÃO DA NFS-e", value: dateTime(read(inf, "dhProc")) },
      ],
      [
        { label: "NÚMERO DA DPS", value: orDash(read(dps, "nDPS")) },
        { label: "SÉRIE DA DPS", value: orDash(read(dps, "serie")) },
        { label: "DATA E HORA DA EMISSÃO DA DPS", value: dateTime(read(dps, "dhEmi")) },
      ],
      [
        { label: "EMITENTE DA NFS-e", value: labelOf(ISSUER, issuer), shaded: true },
        { label: "SITUAÇÃO DA NFS-e", value: labelOf(STATUS, read(inf, "cStat")) },
        { label: "FINALIDADE", value: labelOf(PURPOSE, read(ibsCbsDps, "finNFSe")) },
      ],
    ],
    sections,
    complementary: { text: complementary || null, approximateTaxes: approximateTaxes(at(values, "trib/totTrib")) },
    stub: `${nfseNumber} / ${accessKey}`,
  };
}
