"use client";

import { useMemo, useState } from "react";

import {
  constellationNodes,
  starField,
  VIEW_H,
  VIEW_W,
  type ConstellationNode,
} from "@/lib/constellation";
import { cn } from "@/lib/utils";

function fmt(xp: number): string {
  return xp.toLocaleString("pt-BR");
}

function nodeDetail(node: ConstellationNode, totalXp: number): string {
  if (node.level === 0) return "Nível 0 — o início da jornada";
  if (node.reached) return `Nível ${node.level} — alcançado com ${fmt(node.xpRequired)} XP`;
  return `Nível ${node.level} — faltam ${fmt(node.xpRequired - totalXp)} XP`;
}

/** Losango centrado em (0,0) com "raio" r, como path SVG. */
function diamond(r: number): string {
  return `M 0 ${-r} L ${r} 0 L 0 ${r} L ${-r} 0 Z`;
}

/**
 * Constelação de progressão: nós = níveis (janela deslizante), caminho que
 * ascende para a direita, faixa de detalhe fixa sob o céu (mobile-first).
 * Tudo derivado de totalXp — nenhum estado vem do cliente além da seleção.
 */
export function Constellation({ totalXp }: { totalXp: number }) {
  const data = useMemo(() => constellationNodes(totalXp), [totalXp]);
  const stars = useMemo(() => starField(), []);
  const [selected, setSelected] = useState(data.level);

  const selectedNode =
    data.nodes.find((n) => n.level === selected) ??
    data.nodes.find((n) => n.current)!;

  return (
    <div className="grid gap-3">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="h-auto w-full"
        role="group"
        aria-label="Constelação de níveis"
      >
        {/* Céu de fundo */}
        {stars.map((s, i) => (
          <circle
            key={i}
            cx={s.x}
            cy={s.y}
            r={s.r}
            fill="var(--foreground)"
            opacity={s.opacity}
          />
        ))}

        {/* Caminho entre os nós */}
        {data.nodes.slice(0, -1).map((node, i) => {
          const next = data.nodes[i + 1];
          const key = `${node.level}-${next.level}`;
          if (next.reached) {
            // Trecho já percorrido
            return (
              <line
                key={key}
                x1={node.x}
                y1={node.y}
                x2={next.x}
                y2={next.y}
                stroke="var(--gold)"
                strokeOpacity={0.5}
                strokeWidth={1.5}
              />
            );
          }
          if (node.current) {
            // Trecho em andamento: tracejado + sobreposição sólida = progresso real
            const len = Math.hypot(next.x - node.x, next.y - node.y);
            return (
              <g key={key}>
                <line
                  x1={node.x}
                  y1={node.y}
                  x2={next.x}
                  y2={next.y}
                  stroke="var(--muted-foreground)"
                  strokeOpacity={0.35}
                  strokeWidth={1}
                  strokeDasharray="3 5"
                />
                <line
                  x1={node.x}
                  y1={node.y}
                  x2={next.x}
                  y2={next.y}
                  stroke="var(--gold)"
                  strokeOpacity={0.7}
                  strokeWidth={1.5}
                  strokeDasharray={`${len * data.ratio} ${len}`}
                />
              </g>
            );
          }
          // Trecho futuro
          return (
            <line
              key={key}
              x1={node.x}
              y1={node.y}
              x2={next.x}
              y2={next.y}
              stroke="var(--muted-foreground)"
              strokeOpacity={0.25}
              strokeWidth={1}
              strokeDasharray="3 5"
            />
          );
        })}

        {/* Nós */}
        {data.nodes.map((node) => {
          const isSelected = node.level === selectedNode.level;
          return (
            <g
              key={node.level}
              transform={`translate(${node.x} ${node.y})`}
              role="button"
              tabIndex={0}
              aria-label={nodeDetail(node, data.totalXp)}
              aria-pressed={isSelected}
              className="cursor-pointer outline-none focus-visible:[&>.node-hit]:stroke-[var(--ring)]"
              onClick={() => setSelected(node.level)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelected(node.level);
                }
              }}
            >
              {/* Área de toque generosa (invisível) */}
              <circle className="node-hit" r={20} fill="transparent" strokeWidth={1} />

              {isSelected ? (
                <path
                  d={diamond(node.current ? 21 : 14)}
                  fill="none"
                  stroke="var(--primary)"
                  strokeOpacity={0.8}
                  strokeWidth={1}
                />
              ) : null}

              {node.current ? (
                <>
                  <path
                    d={diamond(16)}
                    fill="var(--card)"
                    stroke="var(--gold)"
                    strokeOpacity={0.65}
                    strokeWidth={1.5}
                  />
                  <path
                    d={diamond(11.5)}
                    fill="none"
                    stroke="var(--gold)"
                    strokeOpacity={0.3}
                    strokeWidth={1}
                  />
                  <text
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="var(--gold)"
                    fontSize={12}
                    fontWeight={700}
                    style={{ fontFamily: "var(--font-cinzel)" }}
                  >
                    {node.level}
                  </text>
                </>
              ) : node.reached ? (
                <>
                  <path d={diamond(6)} fill="var(--gold)" fillOpacity={0.9} />
                  <path
                    d={diamond(10)}
                    fill="none"
                    stroke="var(--gold)"
                    strokeOpacity={0.3}
                    strokeWidth={1}
                  />
                </>
              ) : (
                <path
                  d={diamond(6)}
                  fill="var(--card)"
                  stroke="var(--muted-foreground)"
                  strokeOpacity={0.45}
                  strokeWidth={1}
                />
              )}

              {!node.current ? (
                <text
                  y={node.reached ? 22 : 20}
                  textAnchor="middle"
                  fontSize={10}
                  fill="var(--muted-foreground)"
                  fillOpacity={node.reached ? 0.9 : 0.55}
                  style={{ fontFamily: "var(--font-geist-mono)" }}
                >
                  {node.level}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>

      {/* Faixa de detalhe do nó selecionado */}
      <p
        aria-live="polite"
        className={cn(
          "border-t border-border pt-2 text-center font-mono text-xs",
          selectedNode.reached ? "text-gold" : "text-muted-foreground",
        )}
      >
        {nodeDetail(selectedNode, data.totalXp)}
      </p>
    </div>
  );
}
