"use client";

import { ChartLine } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { niceScale, type ValueScale } from "@/domain/chart-scale";
import { monthShortLabel, type SeriesPoint } from "@/domain/closing-overview";
import { formatBRLCompact, formatBRLCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

/*
 * Evolução de uma empresa no ano: caixa em linha, resultado em barras.
 *
 * São DOIS painéis alinhados pelo mês, cada um com a sua escala — e não um
 * gráfico de dois eixos: caixa e resultado são reais, mas de grandezas muito
 * diferentes (caixa de R$ 880 mil ao lado de resultado de R$ 5 mil), e um eixo
 * só achataria o resultado num risco. Dois eixos no mesmo desenho inventariam
 * uma relação entre as linhas que não existe.
 */

const PAD_LEFT = 68;
const PAD_RIGHT = 12;
const PLOT_H = 112;
const PAD_Y = 8;
const AXIS_H = 22;

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    // Mede a largura real para o texto do eixo ficar em 11px também no celular
    // (um SVG esticado por viewBox encolheria as letras junto).
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(260, Math.round(entry.contentRect.width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

interface Slot {
  month: number;
  point: SeriesPoint | null;
}

/** Um espaço por mês entre o primeiro e o último fechado: buraco é buraco. */
function slotsOf(series: readonly SeriesPoint[]): Slot[] {
  const first = series[0]?.month ?? 1;
  const last = series.at(-1)?.month ?? first;
  const byMonth = new Map(series.map((point) => [point.month, point]));
  return Array.from({ length: last - first + 1 }, (_, index) => ({
    month: first + index,
    point: byMonth.get(first + index) ?? null,
  }));
}

function money(value: number | null): string {
  return value === null ? "—" : formatBRLCurrency(value);
}

function Panel({
  width,
  slots,
  scale,
  active,
  onActive,
  showMonths,
  label,
  children,
}: {
  width: number;
  slots: readonly Slot[];
  scale: ValueScale;
  active: number;
  onActive: (index: number) => void;
  showMonths: boolean;
  label: string;
  children: (helpers: { x: (index: number) => number; y: (value: number) => number; slotW: number }) => React.ReactNode;
}) {
  const plotW = width - PAD_LEFT - PAD_RIGHT;
  const slotW = plotW / slots.length;
  const height = PAD_Y * 2 + PLOT_H + (showMonths ? AXIS_H : 0);
  const x = (index: number) => PAD_LEFT + slotW * (index + 0.5);
  const y = (value: number) =>
    PAD_Y + (PLOT_H * (scale.max - value)) / (scale.max - scale.min);

  return (
    <svg width={width} height={height} role="img" aria-label={label} className="block overflow-visible">
      {/* Coluna do mês ativo: a "mira" que acompanha a leitura acima. */}
      <rect
        x={PAD_LEFT + slotW * active}
        y={PAD_Y}
        width={slotW}
        height={PLOT_H}
        className="fill-foreground/5"
      />
      {scale.ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={PAD_LEFT}
            x2={width - PAD_RIGHT}
            y1={y(tick)}
            y2={y(tick)}
            className={tick === 0 ? "stroke-muted-foreground/70" : "stroke-border/60"}
            strokeWidth={1}
          />
          <text
            x={PAD_LEFT - 8}
            y={y(tick)}
            textAnchor="end"
            dominantBaseline="middle"
            className="fill-muted-foreground font-mono text-[length:var(--text-hud)] tabular-nums"
          >
            {formatBRLCompact(tick)}
          </text>
        </g>
      ))}
      {children({ x, y, slotW })}
      {showMonths
        ? slots.map((slot, index) => (
            <text
              key={slot.month}
              x={x(index)}
              y={PAD_Y + PLOT_H + 16}
              textAnchor="middle"
              className={cn(
                "font-mono text-[length:var(--text-hud)]",
                index === active ? "fill-foreground" : "fill-muted-foreground",
              )}
            >
              {monthShortLabel(slot.month)}
            </text>
          ))
        : null}
      {/* Alvo do mês inteiro: maior que a marca, e alcançável pelo teclado. */}
      {slots.map((slot, index) => (
        <rect
          key={slot.month}
          x={PAD_LEFT + slotW * index}
          y={0}
          width={slotW}
          height={height}
          fill="transparent"
          tabIndex={0}
          aria-label={`${monthShortLabel(slot.month)}: ${
            slot.point
              ? `caixa ${money(slot.point.cash)}, resultado ${money(slot.point.result)}`
              : "sem período fechado"
          }`}
          onMouseEnter={() => onActive(index)}
          onFocus={() => onActive(index)}
          className="cursor-crosshair outline-none focus-visible:stroke-primary focus-visible:stroke-2"
        />
      ))}
    </svg>
  );
}

function EvolutionChart({ series }: { series: readonly SeriesPoint[] }) {
  const [ref, width] = useWidth();
  const slots = slotsOf(series);
  const lastWithData = slots.findLastIndex((slot) => slot.point !== null);
  const [active, setActive] = useState(Math.max(0, lastWithData));
  const current = slots[active];

  const cashValues = series.flatMap((point) => (point.cash === null ? [] : [point.cash]));
  const resultValues = series.flatMap((point) => (point.result === null ? [] : [point.result]));
  const cashScale = niceScale(cashValues);
  const resultScale = niceScale(resultValues);

  return (
    <div ref={ref} className="grid min-w-0 grid-cols-1 gap-1">
      <p className="min-h-5 font-mono text-xs tabular-nums" aria-live="polite">
        <span className="text-foreground">{monthShortLabel(current.month)}</span>
        <span className="text-muted-foreground">
          {current.point
            ? ` · caixa ${money(current.point.cash)} · resultado ${money(current.point.result)}`
            : " · sem período fechado"}
        </span>
      </p>

      <p className="hud-label mt-1">Saldo de caixa</p>
      {cashValues.length > 0 ? (
        <Panel
          width={width}
          slots={slots}
          scale={cashScale}
          active={active}
          onActive={setActive}
          showMonths={false}
          label="Saldo de caixa por mês"
        >
          {({ x, y }) => {
            // A linha liga os períodos lançados, passando por cima dos meses
            // sem fechamento: mês sem fechamento é mês sem medição, e quebrar
            // a linha ali transformava a evolução em pontos soltos. Os pontos
            // marcam onde existe dado de verdade.
            const points = slots.flatMap((slot, index) =>
              slot.point?.cash == null ? [] : [{ index, value: slot.point.cash }],
            );
            return (
              <g>
                <polyline
                  points={points.map((p) => `${x(p.index)},${y(p.value)}`).join(" ")}
                  fill="none"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  className="stroke-primary"
                />
                {points.map((p) => (
                  <circle
                    key={p.index}
                    cx={x(p.index)}
                    cy={y(p.value)}
                    r={4}
                    strokeWidth={2}
                    className="fill-primary stroke-card"
                  />
                ))}
              </g>
            );
          }}
        </Panel>
      ) : (
        <p className="py-3 text-xs text-muted-foreground">Nenhum período com saldo de caixa lançado.</p>
      )}

      <p className="hud-label mt-2">Resultado do período</p>
      {resultValues.length > 0 ? (
        <Panel
          width={width}
          slots={slots}
          scale={resultScale}
          active={active}
          onActive={setActive}
          showMonths
          label="Resultado do período por mês"
        >
          {({ x, y, slotW }) => {
            const barW = Math.min(28, slotW * 0.56);
            return (
              <g>
                {slots.map((slot, index) => {
                  const value = slot.point?.result;
                  if (value == null) return null;
                  const top = Math.min(y(value), y(0));
                  const height = Math.max(1, Math.abs(y(value) - y(0)));
                  return (
                    <rect
                      key={slot.month}
                      x={x(index) - barW / 2}
                      y={top}
                      width={barW}
                      height={height}
                      className={value < 0 ? "fill-destructive" : "fill-primary/80"}
                    />
                  );
                })}
              </g>
            );
          }}
        </Panel>
      ) : (
        <p className="py-3 text-xs text-muted-foreground">Nenhum período com resultado lançado.</p>
      )}
    </div>
  );
}

/**
 * Botão da linha da leitura: abre a evolução da empresa no ano. Só aparece
 * quando há o que comparar — dois períodos fechados com mês, no mínimo.
 */
export function ClosingEvolutionButton({
  companyName,
  year,
  series,
}: {
  companyName: string;
  year: number;
  series: readonly SeriesPoint[];
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="touch-target text-muted-foreground hover:text-primary"
          aria-label={`Ver a evolução de ${companyName} em ${year}`}
          title="Ver a evolução no ano"
        >
          <ChartLine aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{companyName}</DialogTitle>
          <DialogDescription>
            Evolução dos períodos fechados em {year}, mês a mês.
          </DialogDescription>
        </DialogHeader>
        <EvolutionChart series={series} />
        <table className="w-full border-t border-border/60 text-xs">
          <caption className="sr-only">Valores de cada período fechado</caption>
          <thead>
            <tr className="text-left text-muted-foreground">
              <th scope="col" className="py-1.5 font-medium">Mês</th>
              <th scope="col" className="py-1.5 text-right font-medium">Caixa</th>
              <th scope="col" className="py-1.5 text-right font-medium">Resultado</th>
              <th scope="col" className="py-1.5 text-right font-medium">Empréstimo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40 font-mono tabular-nums">
            {series.map((point) => (
              <tr key={point.month}>
                <th scope="row" className="py-1.5 text-left font-normal">
                  {monthShortLabel(point.month)}
                </th>
                {[point.cash, point.result, point.loan].map((value, column) => (
                  <td
                    key={column}
                    className={cn(
                      "py-1.5 text-right",
                      value !== null && value < 0 ? "text-destructive" : "text-foreground",
                    )}
                  >
                    {money(value)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </DialogContent>
    </Dialog>
  );
}
