export type ResolvedClient = Readonly<{
  id: string;
  name: string;
  cnpj?: string | null;
  taxRegime?: "mei" | "simples" | "presumido" | "association" | "real";
}>;

const LEGAL_SUFFIXES = new Set([
  "cia",
  "eireli",
  "ltda",
  "me",
  "mei",
  "sa",
  "ss",
]);

function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Aceita nome completo ou trecho inequívoco; qualquer ambiguidade bloqueia o vínculo. */
export function resolveClientName(
  requestedName: string,
  clients: ResolvedClient[],
): ResolvedClient | null {
  const requested = normalizeName(requestedName);
  if (!requested) return null;

  const exact = clients.filter((client) => normalizeName(client.name) === requested);
  if (exact.length === 1) return exact[0];

  const phraseMatches = clients.filter((client) => {
    const normalized = normalizeName(client.name);
    return ` ${normalized} `.includes(` ${requested} `);
  });
  if (phraseMatches.length === 1) return phraseMatches[0];

  const meaningfulTokens = requested
    .split(" ")
    .filter((token) => token.length >= 3 && !LEGAL_SUFFIXES.has(token));
  if (meaningfulTokens.length === 0) return null;

  const tokenMatches = clients.filter((client) => {
    const tokens = new Set(normalizeName(client.name).split(" "));
    return meaningfulTokens.every((token) => tokens.has(token));
  });
  return tokenMatches.length === 1 ? tokenMatches[0] : null;
}
