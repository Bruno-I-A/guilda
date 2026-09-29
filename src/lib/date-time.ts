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
