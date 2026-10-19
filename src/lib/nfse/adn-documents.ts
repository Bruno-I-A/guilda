import { at, child, parseXmlRoot, read } from "./xml-dom";

/**
 * Eventos que cancelam a nota (tiposEventos_v1.01.xsd): cancelamento,
 * cancelamento por substituição, cancelamento deferido por análise fiscal e
 * cancelamento de ofício. O indeferido (e105105) não cancela.
 */
export const CANCELLATION_EVENTS = ["e101101", "e105102", "e105104", "e305101"] as const;

export type AdnDocumentReading =
  | { kind: "issued"; accessKey: string; nfseNumber: string | null; issuedAt: Date; competence: string | null }
  | { kind: "cancellation"; accessKey: string; cancelledAt: Date | null }
  | { kind: "ignored" };

const ACCESS_KEY = /^\d{50}$/;
// A competência vai para uma coluna date: texto fora deste formato quebraria o INSERT.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function toDate(value: string | null): Date | null {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

/**
 * Classifica um documento da distribuição (já descompactado). Só entra a NFS-e
 * prestada pela empresa: o prestador da DPS é o CNPJ dela, mesmo quando quem
 * emitiu foi o tomador. O evento só conta se for de cancelamento.
 */
export function readAdnDocument(xml: string, clientCnpj: string): AdnDocumentReading {
  const root = parseXmlRoot(xml);
  if (root?.localName === "NFSe") {
    const inf = child(root, "infNFSe");
    const accessKey = (inf?.getAttribute("Id") ?? "").replace(/^NFS/, "");
    const issuedAt = toDate(read(inf, "dhProc"));
    if (!ACCESS_KEY.test(accessKey) || !issuedAt || read(inf, "DPS/infDPS/prest/CNPJ") !== clientCnpj) {
      return { kind: "ignored" };
    }
    const competence = read(inf, "DPS/infDPS/dCompet");
    return {
      kind: "issued",
      accessKey,
      nfseNumber: read(inf, "nNFSe"),
      issuedAt,
      competence: competence && ISO_DATE.test(competence) ? competence : null,
    };
  }
  if (root?.localName === "evento") {
    const request = at(root, "infEvento/pedRegEvento/infPedReg");
    const accessKey = read(request, "chNFSe");
    if (!accessKey || !ACCESS_KEY.test(accessKey) || !CANCELLATION_EVENTS.some((code) => child(request, code))) {
      return { kind: "ignored" };
    }
    return { kind: "cancellation", accessKey, cancelledAt: toDate(read(root, "infEvento/dhProc")) };
  }
  return { kind: "ignored" };
}
