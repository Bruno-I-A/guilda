/** Instantes do sistema são exibidos no fuso usado pela operação da Guilda. */
export const APP_TIME_ZONE = "America/Sao_Paulo";

export function formatAppDateTime(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleString("pt-BR", { timeZone: APP_TIME_ZONE });
}

export function formatAppDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleDateString("pt-BR", { timeZone: APP_TIME_ZONE });
}

/** Ano corrente no fuso da Guilda: na noite de 31/12 ainda é o ano velho, mesmo com o UTC já no novo. */
export function currentAppYear(now: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIME_ZONE, year: "numeric" }).format(now),
  );
}
