const TELEGRAM_TEXT_LIMIT = 4096;

// Nota: NÃO existe escape de HTML aqui de propósito. Todas as mensagens do bot
// são enviadas como TEXTO PURO (sem parse_mode), então não há marcação a
// escapar. Se um dia alguém ligar `parse_mode: "HTML"`, precisará reintroduzir
// um escape e aplicá-lo a TODO texto de origem de usuário — caso contrário,
// abre injeção de marcação nas notificações que a organização inteira recebe.

/**
 * Limita uma mensagem sem cortar um par substituto Unicode. Reserva espaço
 * para a reticência e remove espaços inúteis no final.
 */
export function truncateTelegramText(
  value: string,
  maxLength = TELEGRAM_TEXT_LIMIT,
): string {
  if (!Number.isInteger(maxLength) || maxLength < 1) {
    throw new Error("Limite de mensagem inválido");
  }
  const chars = Array.from(value);
  if (chars.length <= maxLength) return value;
  if (maxLength === 1) return "…";
  return `${chars.slice(0, maxLength - 1).join("").trimEnd()}…`;
}

/** Junta blocos opcionais sem produzir linhas vazias em excesso. */
export function joinTelegramLines(
  lines: ReadonlyArray<string | null | undefined | false>,
): string {
  return lines
    .filter((line): line is string => typeof line === "string" && line.length > 0)
    .join("\n");
}

export function formatTelegramDate(
  value: Date,
  timeZone = "America/Sao_Paulo",
): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(value);
}
