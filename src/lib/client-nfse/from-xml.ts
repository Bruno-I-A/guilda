import { amountToCents } from "@/domain/nfse";
import { ibgeCity } from "@/lib/nfse/municipios";
import type { NfseIssuerTemplate } from "@/lib/nfse/template";
import { at, child, parseXmlRoot, read } from "@/lib/nfse/xml-dom";

import type { AddressInput } from "./registry";

/**
 * O que uma NFS-e já emitida pela empresa ensina sobre ela: o modelo fiscal
 * (o que o Fiscal copiaria do Portal à mão), a série da DPS que ela usa e, de
 * cada nota, tomador, valor e descrição. Lê o XML que a rotina da aba XML
 * guardou; não consulta nada novo no governo.
 */
export interface IssuedNoteFacts {
  issuedAt: Date | null;
  series: string | null;
  /** Campos que faltarem na nota vêm vazios: o formulário mostra e o Fiscal completa. */
  template: NfseIssuerTemplate;
  taker: { document: string; name: string; address: AddressInput | null } | null;
  amountCents: number | null;
  description: string | null;
}

/** "2" ou "2.5" no XML viram "2.00"/"2.50", o formato do modelo. */
function twoDecimals(value: string | null): string | undefined {
  if (!value) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return undefined;
  return number === 0 ? "0" : number.toFixed(2);
}

function readTotalTaxes(totTrib: ReturnType<typeof at>): NfseIssuerTemplate["totalTaxes"] {
  const simples = twoDecimals(read(totTrib, "pTotTribSN"));
  if (simples) return { kind: "simples", percent: simples };
  const percent = child(totTrib, "pTotTrib");
  if (percent) {
    return {
      kind: "percent",
      federal: twoDecimals(read(percent, "pTotTribFed")) ?? "0",
      state: twoDecimals(read(percent, "pTotTribEst")) ?? "0",
      municipal: twoDecimals(read(percent, "pTotTribMun")) ?? "0",
    };
  }
  return { kind: "none" };
}

function readTaker(toma: ReturnType<typeof at>): IssuedNoteFacts["taker"] {
  const document = read(toma, "CNPJ") ?? read(toma, "CPF");
  const name = read(toma, "xNome");
  if (!document || !name) return null;
  const end = child(toma, "end");
  const cityCode = read(end, "endNac/cMun");
  const city = cityCode ? ibgeCity(cityCode) : null;
  const address: AddressInput | null = end
    ? {
        street: read(end, "xLgr"),
        number: read(end, "nro"),
        complement: read(end, "xCpl"),
        district: read(end, "xBairro"),
        city: city?.name ?? null,
        state: city?.state ?? null,
        zipCode: read(end, "endNac/CEP"),
      }
    : null;
  return { document, name, address };
}

export function readIssuedNoteFacts(xml: string): IssuedNoteFacts | null {
  const root = parseXmlRoot(xml);
  const inf = root?.localName === "NFSe" ? child(root, "infNFSe") : null;
  const dps = at(inf, "DPS/infDPS");
  if (!inf || !dps) return null;
  const regTrib = at(dps, "prest/regTrib");
  const cServ = at(dps, "serv/cServ");
  const tribMun = at(dps, "valores/trib/tribMun");
  const ibsCbs = child(dps, "IBSCBS");
  const gIbsCbs = at(ibsCbs, "valores/trib/gIBSCBS");
  const issuedAt = read(inf, "dhProc") ?? read(dps, "dhEmi");
  const amount = read(dps, "valores/vServPrest/vServ");
  let amountCents: number | null = null;
  try {
    amountCents = amount ? amountToCents(amount) : null;
  } catch {
    amountCents = null;
  }
  const operationIndicator = read(ibsCbs, "cIndOp");
  const template = {
    cityCode: read(dps, "cLocEmi") ?? "",
    municipalRegistration: read(dps, "prest/IM") ?? undefined,
    taxRegime: {
      opSimpNac: read(regTrib, "opSimpNac") ?? "",
      regApTribSN: read(regTrib, "regApTribSN") ?? undefined,
      regEspTrib: read(regTrib, "regEspTrib") ?? "0",
    },
    service: {
      nationalTaxCode: read(cServ, "cTribNac") ?? "",
      municipalTaxCode: read(cServ, "cTribMun") ?? undefined,
      nbsCode: read(cServ, "cNBS") ?? undefined,
    },
    // Sem retenção na v1: a nota de referência pode ter, o modelo não leva.
    issqn: { taxation: read(tribMun, "tribISSQN") ?? "1", withholding: "1", rate: twoDecimals(read(tribMun, "pAliq")) },
    totalTaxes: readTotalTaxes(at(dps, "valores/trib/totTrib")),
    ibsCbs: operationIndicator
      ? { operationIndicator, cst: read(gIbsCbs, "CST") ?? "", classification: read(gIbsCbs, "cClassTrib") ?? "" }
      : undefined,
  } as NfseIssuerTemplate;
  return {
    issuedAt: issuedAt ? new Date(issuedAt) : null,
    series: read(dps, "serie"),
    template,
    taker: readTaker(child(dps, "toma")),
    amountCents,
    description: read(cServ, "xDescServ"),
  };
}
