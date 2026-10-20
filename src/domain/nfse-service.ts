/**
 * Quem emite NFS-e (presta serviço): a marcação "Emite NFS-e (serviço)" da
 * Ficha Fiscal manda; sem ela, o CNAE principal sugere (decisão de 2026-10-20).
 * A sugestão é só um ponto de partida: comércio que também presta serviço,
 * por exemplo, o Fiscal marca na mão.
 */

/**
 * Divisões do CNAE 2.3 (dois primeiros dígitos) em que a atividade costuma
 * sair com NFS-e: manutenção de máquinas (33), construção (41–43), serviços
 * auxiliares do transporte e correio (52–53), alojamento (55), audiovisual
 * (59–60), tecnologia (62–63), financeiras (64–66), imobiliárias (68),
 * profissionais e técnicas (69–75), administrativas (77–82), educação (85),
 * saúde (86–88), artes e esporte (90–93) e outros serviços (94–96).
 * Comércio, indústria, agro, restaurantes, transporte de carga e telecom
 * ficam de fora.
 */
const SERVICE_DIVISIONS = new Set([
  33, 41, 42, 43, 52, 53, 55, 59, 60, 62, 63, 64, 65, 66, 68, 69, 70, 71, 72, 73, 74, 75, 77, 78, 79, 80, 81, 82, 85, 86,
  87, 88, 90, 91, 92, 93, 94, 95, 96,
]);

/** Dentro do comércio, manutenção e reparação de veículos (45.20) e de motocicletas (45.43). */
const SERVICE_PREFIXES_IN_TRADE = ["452", "4543"];

/** O CNAE principal sugere serviço? null quando não há CNAE para julgar. */
export function isServiceCnae(code: string | null): boolean | null {
  const digits = code?.replace(/\D/g, "") ?? "";
  if (digits.length < 4) return null;
  if (SERVICE_PREFIXES_IN_TRADE.some((prefix) => digits.startsWith(prefix))) return true;
  return SERVICE_DIVISIONS.has(Number(digits.slice(0, 2)));
}

export type NfseIssuerSource = "ficha" | "cnae" | "none";

/** A marcação da Ficha vale mais que o CNAE; "não informado" cai na sugestão. */
export function nfseIssuer(input: {
  applicability: "unknown" | "required" | "not_required" | "not_applicable" | null;
  cnaeCode: string | null;
}): { issues: boolean | null; source: NfseIssuerSource } {
  if (input.applicability === "required") return { issues: true, source: "ficha" };
  if (input.applicability === "not_required" || input.applicability === "not_applicable") {
    return { issues: false, source: "ficha" };
  }
  const suggestion = isServiceCnae(input.cnaeCode);
  return suggestion === null ? { issues: null, source: "none" } : { issues: suggestion, source: "cnae" };
}
