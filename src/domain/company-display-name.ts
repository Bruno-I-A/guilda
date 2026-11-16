/**
 * Nome de empresa para LEITURA na tela (decisão de 2026-11-15, pedido do Bruno).
 *
 * A razão social vem da Receita em CAIXA ALTA, e a do MEI ainda carrega a raiz
 * do CNPJ na frente ("05.309.568 ELIANE HIRT") — que a linha já mostra logo
 * abaixo. Em lista de centenas de empresas, caixa alta e número repetido são o
 * que mais custa para achar uma.
 *
 * SÓ EXIBIÇÃO. O nome gravado continua o oficial: ele vai para a NFS-e, para o
 * XML, para a pasta da Domínio e para as buscas. Nunca gravar o resultado disto.
 *
 * Regras, nesta ordem:
 * 1. Tira a raiz do CNPJ no começo (com ou sem pontuação) e o CPF de 11
 *    dígitos no fim — os dois formatos que a Receita usou para o nome do MEI.
 * 2. Se o nome já tem minúscula, alguém digitou com cuidado: fica como está.
 * 3. Caixa alta vira "Nome Próprio", com exceções que perderiam sentido:
 *    sufixos societários (ME, EPP, EIRELI, S/A…), siglas sem vogal (GV, KMJ),
 *    palavras de duas letras que não são conectivo (RS, TI), numerais romanos
 *    e qualquer coisa com dígito ou ponto. Conectivos (da, de, e…) ficam em
 *    minúscula, menos no começo.
 */

const KEEP_UPPER = new Set([
  "ME",
  "EPP",
  "EIRELI",
  "SA",
  "S/A",
  "S.A",
  "S.A.",
  "SLU",
  "MEI",
  "SS",
  "LTDA-ME",
]);

const CONNECTORS = new Set([
  "a",
  "o",
  "e",
  "da",
  "de",
  "do",
  "das",
  "dos",
  "em",
  "na",
  "no",
  "nas",
  "nos",
  "à",
  "às",
  "ao",
  "aos",
  "para",
  "com",
  "por",
  "y",
]);

const ROMAN = /^(I{2,3}|IV|VI{0,3}|IX|XI{0,3})$/;
const VOWEL = /[AEIOUÁÉÍÓÚÂÊÔÃÕÀÜY]/i;
const LEADING_CNPJ_ROOT = /^\s*\d{2}\.?\d{3}\.?\d{3}\s+/;
const TRAILING_CPF = /\s+\d{3}\.?\d{3}\.?\d{3}-?\d{2}\s*$/;

function capitalize(word: string): string {
  const lower = word.toLocaleLowerCase("pt-BR");
  // D'AGOSTINI → D'Agostini; MARIA-CLARA → Maria-Clara.
  return lower.replace(/(^|['’\-])(\p{L})/gu, (_, sep: string, letter: string) =>
    sep + letter.toLocaleUpperCase("pt-BR"),
  );
}

function shouldKeepUpper(token: string): boolean {
  if (KEEP_UPPER.has(token)) return true;
  if (/[\d.]/.test(token)) return true;
  if (ROMAN.test(token)) return true;
  const letters = token.replace(/[^\p{L}]/gu, "");
  if (letters.length === 0) return true;
  if (!VOWEL.test(letters)) return true;
  if (letters.length <= 2 && !CONNECTORS.has(letters.toLocaleLowerCase("pt-BR"))) {
    return true;
  }
  return false;
}

export function companyDisplayName(raw: string | null | undefined): string {
  if (!raw) return "";
  const stripped = raw.replace(LEADING_CNPJ_ROOT, "").replace(TRAILING_CPF, "").trim();
  // Nome que era só número (cadastro ruim) não pode sumir.
  const name = stripped.length > 0 ? stripped : raw.trim();

  if (/\p{Ll}/u.test(name)) return name;

  return name
    .split(/\s+/)
    .map((token, index) => {
      const lower = token.toLocaleLowerCase("pt-BR");
      if (index > 0 && CONNECTORS.has(lower)) return lower;
      if (shouldKeepUpper(token)) return token;
      return capitalize(token);
    })
    .join(" ");
}
