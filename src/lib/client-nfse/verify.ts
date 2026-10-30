import { amountToCents } from "@/domain/nfse";
import { firstElementText } from "@/lib/nfse/xml";

export interface NfseRequestFacts {
  providerCnpj: string;
  takerDocument: string;
  amountCents: number;
}

/** O que a nota encontrada diz, para mostrar ao lado do que foi pedido. */
export interface NfseFoundFacts {
  nfseNumber: string | null;
  providerCnpj: string | null;
  takerDocument: string | null;
  amountCents: number | null;
}

/**
 * A nota achada pela DPS é mesmo a que pedimos? A numeração da DPS é por
 * CNPJ: se a empresa já usou a mesma série em outro sistema, a consulta "a
 * DPS já existe?" devolveria a nota de lá — e a Guilda a adotaria como sua.
 * Conferir prestador, tomador e valor separa as duas. Devolve null quando
 * bate; senão, o que a nota encontrada tem.
 */
export function nfseXmlMismatch(xml: string, request: NfseRequestFacts): NfseFoundFacts | null {
  const prest = /<(?:\w+:)?prest>([\s\S]*?)<\/(?:\w+:)?prest>/.exec(xml)?.[1] ?? "";
  const toma = /<(?:\w+:)?toma>([\s\S]*?)<\/(?:\w+:)?toma>/.exec(xml)?.[1] ?? "";
  const amount = firstElementText(xml, "vServ");
  let amountCents: number | null = null;
  try {
    amountCents = amount ? amountToCents(amount) : null;
  } catch {
    amountCents = null;
  }
  const found: NfseFoundFacts = {
    nfseNumber: firstElementText(xml, "nNFSe"),
    providerCnpj: firstElementText(prest, "CNPJ"),
    takerDocument: firstElementText(toma, "CNPJ") ?? firstElementText(toma, "CPF"),
    amountCents,
  };
  const matches =
    found.providerCnpj === request.providerCnpj &&
    found.takerDocument === request.takerDocument &&
    found.amountCents === request.amountCents;
  return matches ? null : found;
}

export function nfseXmlMatchesRequest(xml: string, request: NfseRequestFacts): boolean {
  return nfseXmlMismatch(xml, request) === null;
}

function money(cents: number | null): string {
  return cents === null ? "sem valor" : (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * A mensagem do conflito diz o que há na outra nota: com isso o Fiscal
 * confere no Portal se é mesmo de outro sistema antes de trocar a série.
 */
export function dpsConflictMessage(input: {
  dpsSeries: string;
  dpsNumber: number;
  request: NfseRequestFacts;
  found: NfseFoundFacts;
}): string {
  const { found, request } = input;
  const differs = [
    found.providerCnpj !== request.providerCnpj ? `prestador ${found.providerCnpj ?? "não lido"}` : null,
    found.takerDocument !== request.takerDocument ? `tomador ${found.takerDocument ?? "não lido"} (este pedido: ${request.takerDocument})` : null,
    found.amountCents !== request.amountCents ? `valor ${money(found.amountCents)} (este pedido: ${money(request.amountCents)})` : null,
  ].filter(Boolean);
  return (
    `A DPS ${input.dpsSeries}/${input.dpsNumber} já existe no Sistema Nacional com outra nota` +
    `${found.nfseNumber ? ` (NFS-e nº ${found.nfseNumber})` : ""}: ${differs.join("; ")}. ` +
    "Se ela for de outro sistema da empresa, troque a série da DPS no cadastro da empresa e clique em Tentar de novo."
  );
}
