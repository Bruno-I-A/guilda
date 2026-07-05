/**
 * Regras de XP da gamificação (funções puras — todo cálculo no servidor).
 */

export const MIN_DIFFICULTY = 1;
export const MAX_DIFFICULTY = 5;
export const MIN_PRIORITY = 1;
export const MAX_PRIORITY = 3;

/**
 * XP da tarefa, congelado na criação:
 * `xp_value = difficulty * 20 + (priority - 1) * 10`
 * (dificuldade 1–5 → 20 a 100 XP base; prioridade adiciona 0/10/20).
 */
export function calculateTaskXp(difficulty: number, priority: number): number {
  if (
    !Number.isInteger(difficulty) ||
    difficulty < MIN_DIFFICULTY ||
    difficulty > MAX_DIFFICULTY
  ) {
    throw new RangeError(`dificuldade deve ser um inteiro entre ${MIN_DIFFICULTY} e ${MAX_DIFFICULTY}`);
  }
  if (
    !Number.isInteger(priority) ||
    priority < MIN_PRIORITY ||
    priority > MAX_PRIORITY
  ) {
    throw new RangeError(`prioridade deve ser um inteiro entre ${MIN_PRIORITY} e ${MAX_PRIORITY}`);
  }
  return difficulty * 20 + (priority - 1) * 10;
}
