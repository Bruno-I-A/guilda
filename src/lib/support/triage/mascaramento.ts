/**
 * Mascaramento de PII antes de QUALQUER chamada externa (spec §5.4).
 * A triagem por setor não precisa de CPF/CNPJ/cartão para classificar.
 *
 * Ordem importa: padrões mais longos primeiro (cartão 16 dígitos, CNPJ 14,
 * CPF 11) evita que um CNPJ seja parcialmente confundido com fragmento de CPF.
 */

const CARTAO = /\b\d{4}[\s.-]?\d{4}[\s.-]?\d{4}[\s.-]?\d{4}\b/g;
const CNPJ = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
const CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;

export function mascararPii(texto: string): string {
  return texto.replace(CARTAO, "***").replace(CNPJ, "***").replace(CPF, "***");
}
