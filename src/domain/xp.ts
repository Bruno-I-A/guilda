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

/**
 * XP total acumulado necessário para ATINGIR o nível `n`:
 * `floor(100 * n^1.5)` — nível 0 começa em 0 XP.
 */
export function xpForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 0) {
    throw new RangeError("nível deve ser um inteiro >= 0");
  }
  return Math.floor(100 * Math.pow(level, 1.5));
}

/**
 * Nível derivado do XP total: o maior `n` com xpForLevel(n) <= totalXp.
 * XP negativo (saldo após reversões) ou inválido clampa para nível 0.
 */
export function levelFromXp(totalXp: number): number {
  if (!Number.isFinite(totalXp) || totalXp <= 0) {
    return 0;
  }
  let level = 0;
  while (xpForLevel(level + 1) <= totalXp) {
    level++;
  }
  return level;
}

export interface LevelProgress {
  level: number;
  totalXp: number;
  /** XP total onde o nível atual começa. */
  currentLevelXp: number;
  /** XP total onde o próximo nível começa. */
  nextLevelXp: number;
  /** Progresso 0..1 dentro do nível atual. */
  ratio: number;
}

/** Dados prontos para a barra de progresso do perfil. */
export function levelProgress(totalXp: number): LevelProgress {
  const safeXp = Number.isFinite(totalXp) ? Math.max(0, totalXp) : 0;
  const level = levelFromXp(safeXp);
  const currentLevelXp = xpForLevel(level);
  const nextLevelXp = xpForLevel(level + 1);
  const span = nextLevelXp - currentLevelXp;
  const ratio = span > 0 ? (safeXp - currentLevelXp) / span : 0;
  return {
    level,
    totalXp: safeXp,
    currentLevelXp,
    nextLevelXp,
    ratio: Math.min(1, Math.max(0, ratio)),
  };
}
