const brlFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Formata o valor canônico do banco para exibição em reais. */
export function formatBRLCurrency(value: string | number | null | undefined): string {
  if (value === null || value === undefined || String(value).trim() === "") return "";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? brlFormatter.format(numeric) : "";
}

/**
 * Converte o texto visível da máscara (`R$ 30.000,00`) para o formato
 * canônico aceito pelas actions e pelo Postgres (`30000.00`).
 */
export function parseBRLCurrencyInput(
  input: string,
  options: { allowNegative?: boolean } = {},
): string {
  const hasDigits = /\d/.test(input);
  if (!hasDigits) return "";

  const negative = Boolean(options.allowNegative && input.includes("-"));
  const cleaned = input.replace(/[^\d,]/g, "");
  const commaIndex = cleaned.lastIndexOf(",");
  const integerPart = commaIndex >= 0 ? cleaned.slice(0, commaIndex) : cleaned;
  const decimalPart = commaIndex >= 0 ? cleaned.slice(commaIndex + 1) : "";
  const integer = integerPart.replace(/\D/g, "").replace(/^0+(?=\d)/, "") || "0";
  const decimals = decimalPart.replace(/\D/g, "").slice(0, 2).padEnd(2, "0");
  return `${negative ? "-" : ""}${integer}.${decimals}`;
}
