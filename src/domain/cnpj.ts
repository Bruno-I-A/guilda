/**
 * Validação de CNPJ (funções puras).
 * O CNPJ é OPCIONAL no cadastro de clientes; quando presente, é armazenado
 * normalizado (só dígitos) e precisa ter dígitos verificadores válidos.
 */

/** Remove máscara/formatação: "12.345.678/0001-95" → "12345678000195". */
export function normalizeCnpj(input: string): string {
  return input.replace(/\D/g, "");
}

function checkDigit(digits: string, weights: number[]): number {
  const sum = weights.reduce((acc, weight, i) => acc + weight * Number(digits[i]), 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

/** Valida um CNPJ JÁ NORMALIZADO (14 dígitos + DVs; rejeita repetição). */
export function validateCnpj(cnpj: string): boolean {
  if (!/^\d{14}$/.test(cnpj)) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false; // 00000000000000, 111… etc.

  const dv1 = checkDigit(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (dv1 !== Number(cnpj[12])) return false;

  const dv2 = checkDigit(cnpj.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return dv2 === Number(cnpj[13]);
}

/** "12345678000195" → "12.345.678/0001-95" (exibição). */
export function formatCnpj(cnpj: string): string {
  if (!/^\d{14}$/.test(cnpj)) return cnpj;
  return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;
}
