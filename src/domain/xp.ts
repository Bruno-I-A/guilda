/**
 * Regras de XP da gamificação (funções puras — todo cálculo no servidor).
 */

export const MIN_DIFFICULTY = 1;
export const MAX_DIFFICULTY = 5;
export const MIN_PRIORITY = 1;
export const MAX_PRIORITY = 3;
export const CLOSING_YEAR_XP = 15;

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
 * Nível a partir do qual o custo do próximo nível passa a crescer
 * geometricamente. Abaixo dele, a curva é a original — ver `xpForLevel`.
 */
export const LEVEL_SOFT_CAP = 25;

/** Quanto cada nível acima do patamar custa em relação ao anterior. */
const SOFT_CAP_GROWTH = 1.12;

/**
 * XP total acumulado necessário para ATINGIR o nível `n`. Nível 0 = 0 XP.
 *
 * Até o nível 25 (`LEVEL_SOFT_CAP`) é a fórmula original, `floor(100*n^1.5)`.
 * Acima dele, o custo do próximo nível cresce 12% a cada degrau.
 *
 * POR QUE O PATAMAR (decisão de 2026-09-04). Em `100*n^1.5` o custo marginal
 * cresce com a RAIZ do nível: 100 XP para sair do 0, 679 para sair do 20,
 * 1.066 para sair do 50. Em missões de 50 XP isso é 14 missões no nível 20
 * contra 21 no nível 50 — o nível nunca vira conquista, só um contador de
 * quanto tempo a pessoa está na Guilda. A oito missões por dia útil dava
 * nível ~100 em doze meses, e o número perdia sentido.
 *
 * Com o patamar, o degrau 40→41 custa 83 missões e o 50→51 custa 257: subir
 * de nível volta a ser evento. Os mesmos doze meses intensos dão nível 48 em
 * vez de 100, e um ano de uso normal (~25 mil XP) dá 34 em vez de 39.
 *
 * POR QUE EM 25, E NÃO ANTES. O nível é DERIVADO do saldo do ledger, nunca
 * gravado: mudar a fórmula reescreve o nível de todo mundo na renderização
 * seguinte, inclusive para baixo, e ver o próprio nível cair é irreversível
 * na percepção de quem viu. Emendar em 25 é a garantia de que ninguém abaixo
 * de 14.029 XP (o primeiro valor em que as duas curvas discordam, ~281
 * missões de 50 XP) muda de nível — nem para cima, nem para baixo. Só o
 * futuro fica mais caro. Se alguém na organização já passou disso, subir a
 * constante é a correção.
 *
 * A emenda é contínua de propósito: o degrau custa 743 XP antes dela, 757 nela
 * e 847 depois — não há salto no ponto de troca.
 */
export function xpForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 0) {
    throw new RangeError("nível deve ser um inteiro >= 0");
  }
  if (level <= LEVEL_SOFT_CAP) {
    return Math.floor(100 * Math.pow(level, 1.5));
  }
  const base = Math.floor(100 * Math.pow(LEVEL_SOFT_CAP, 1.5));
  // O custo do primeiro degrau acima do patamar é o mesmo que a curva antiga
  // cobraria ali — é isso que faz a emenda não ter degrau visível.
  const firstStep =
    Math.floor(100 * Math.pow(LEVEL_SOFT_CAP + 1, 1.5)) - base;
  const steps = level - LEVEL_SOFT_CAP;
  const total =
    base +
    (firstStep * (Math.pow(SOFT_CAP_GROWTH, steps) - 1)) / (SOFT_CAP_GROWTH - 1);
  // Níveis absurdos (fora de qualquer faixa de XP real) estouram a precisão
  // de inteiro. Saturar mantém a função crescente em vez de devolver lixo —
  // e a saturação é justamente por que `levelFromXp` tem teto: com todos os
  // níveis do topo valendo o mesmo, o laço lá não teria condição de parada.
  return Number.isSafeInteger(Math.floor(total))
    ? Math.floor(total)
    : Number.MAX_SAFE_INTEGER;
}

/**
 * Teto do laço de `levelFromXp`. Não é um limite de progressão: o nível 200
 * exige ~2×10^14 XP, umas cem mil vezes o que a coluna de XP comporta somar.
 * Existe para o laço ter parada garantida na faixa em que `xpForLevel` satura.
 */
export const MAX_LEVEL = 200;

/**
 * Nível derivado do XP total: o maior `n` com xpForLevel(n) <= totalXp.
 * XP negativo (saldo após reversões) ou inválido clampa para nível 0.
 */
export function levelFromXp(totalXp: number): number {
  if (!Number.isFinite(totalXp) || totalXp <= 0) {
    return 0;
  }
  let level = 0;
  while (level < MAX_LEVEL && xpForLevel(level + 1) <= totalXp) {
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
