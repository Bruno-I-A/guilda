import { amountToCents } from "@/domain/nfse";
import { firstElementText } from "@/lib/nfse/xml";

/**
 * A nota achada pela DPS é mesmo a que pedimos? A numeração da DPS é por
 * CNPJ: se a empresa já usou a mesma série em outro sistema, a consulta "a
 * DPS já existe?" devolveria a nota de lá — e a Guilda a adotaria como sua.
 * Conferir prestador, tomador e valor separa as duas.
 */
export function nfseXmlMatchesRequest(
  xml: string,
  request: { providerCnpj: string; takerDocument: string; amountCents: number },
): boolean {
  const prest = /<(?:\w+:)?prest>([\s\S]*?)<\/(?:\w+:)?prest>/.exec(xml)?.[1] ?? "";
  const toma = /<(?:\w+:)?toma>([\s\S]*?)<\/(?:\w+:)?toma>/.exec(xml)?.[1] ?? "";
  const takerDocument = firstElementText(toma, "CNPJ") ?? firstElementText(toma, "CPF");
  const amount = firstElementText(xml, "vServ");
  let amountCents: number | null = null;
  try {
    amountCents = amount ? amountToCents(amount) : null;
  } catch {
    amountCents = null;
  }
  return (
    firstElementText(prest, "CNPJ") === request.providerCnpj &&
    takerDocument === request.takerDocument &&
    amountCents === request.amountCents
  );
}
