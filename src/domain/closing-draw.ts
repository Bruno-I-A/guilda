/**
 * Sorteio da próxima empresa a fechar (funções puras).
 *
 * Entra no sorteio a empresa que ninguém tocou no ano: ano em aberto, nenhum
 * período lançado e nenhuma observação. As duas ausências são estritas de
 * propósito — período PENDENTE quer dizer que alguém já começou (muitas vezes
 * é a missão de alguém), e observação, mesmo resolvida, quer dizer que alguém
 * já olhou para a empresa. Sortear uma delas mandaria duas pessoas para o
 * mesmo trabalho.
 */

export interface ClosingDrawFacts {
  yearClosed: boolean;
  /** Períodos do ano em qualquer situação, pendentes inclusive. */
  periodCount: number;
  /** Observações do ano em qualquer estado, resolvidas inclusive. */
  observationCount: number;
}

export function isClosingDrawEligible(facts: ClosingDrawFacts): boolean {
  return !facts.yearClosed && facts.periodCount === 0 && facts.observationCount === 0;
}

/**
 * Escolhe a próxima. `random` devolve um número em [0, 1) — injetado para o
 * teste ser determinístico. Rolar de novo nunca repete a última sorteada
 * quando existe alternativa: quem rola de novo está pedindo OUTRA empresa.
 */
export function pickClosingDraw<T extends { id: string }>(
  pool: readonly T[],
  previousId: string | null,
  random: () => number,
): T | null {
  const options =
    previousId !== null && pool.length > 1
      ? pool.filter((item) => item.id !== previousId)
      : pool;
  if (options.length === 0) return null;
  const index = Math.min(options.length - 1, Math.floor(random() * options.length));
  return options[Math.max(0, index)];
}

/**
 * Ritmo da rolagem: os nomes trocam rápido e vão desacelerando até parar,
 * como um dado que perde força. A soma fica perto de um segundo — tempo de
 * criar expectativa sem virar espera.
 */
export const DRAW_ROLL_DELAYS_MS: readonly number[] = [
  40, 45, 50, 60, 70, 85, 100, 120, 145, 175, 210,
];

/** Pausa entre o último nome do giro e a empresa sorteada assentar. */
export const DRAW_LANDING_DELAY_MS = 250;
