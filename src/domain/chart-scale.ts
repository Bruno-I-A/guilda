/**
 * Escala de um eixo de valores (funções puras), para os gráficos desenhados à
 * mão em SVG. O zero entra sempre no domínio: barras saem da linha do zero, e
 * caixa negativo só se lê como negativo se o zero estiver à vista.
 */

export interface ValueScale {
  min: number;
  max: number;
  /** Marcas do eixo, em passos "redondos" (1, 2 ou 5 × 10ⁿ). */
  ticks: number[];
}

export function niceScale(values: readonly number[], targetTicks = 4): ValueScale {
  let lo = Math.min(0, ...values);
  let hi = Math.max(0, ...values);
  if (lo === hi) hi = lo + 1;

  const rough = (hi - lo) / targetTicks;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const residual = rough / magnitude;
  const step =
    (residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 5 ? 5 : 10) * magnitude;

  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let index = 0; lo + index * step <= hi + step / 2; index += 1) {
    // Multiplicar a partir do mínimo evita o erro acumulado de somar o passo.
    ticks.push(Number((lo + index * step).toPrecision(12)));
  }
  return { min: lo, max: hi, ticks };
}
