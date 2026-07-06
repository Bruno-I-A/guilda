import { levelProgress, xpForLevel } from "@/domain/xp";

/**
 * Layout puro da constelação de progressão do perfil.
 * Janela deslizante de níveis: max(0, nível-4) .. nível+6 (até 11 nós).
 * Determinístico: mesmo nível ⇒ mesma posição, sempre.
 */

export const VIEW_W = 680;
export const VIEW_H = 300;

/** Margens para nó (raio ~15) + rótulo numérico abaixo. */
const PAD_X = 28;
const PAD_TOP = 26;
const PAD_BOTTOM = 44;

/** 11 slots art-directed: jornada serpenteando para cima/direita. */
const SLOTS: readonly [number, number][] = [
  [48, 244],
  [114, 188],
  [184, 222],
  [252, 150],
  [318, 184],
  [384, 104],
  [450, 142],
  [514, 74],
  [578, 116],
  [634, 56],
  [656, 110],
];

export const WINDOW_BEHIND = 4;
export const WINDOW_AHEAD = 6;

export interface ConstellationNode {
  level: number;
  x: number;
  y: number;
  /** Nível já atingido (inclui o atual). */
  reached: boolean;
  current: boolean;
  /** XP total necessário para ATINGIR o nível. */
  xpRequired: number;
}

export interface ConstellationData {
  nodes: ConstellationNode[];
  /** Progresso 0..1 dentro do nível atual (segmento atual→próximo). */
  ratio: number;
  level: number;
  totalXp: number;
}

/** Ruído determinístico em [-amp, amp] a partir de uma seed. */
function jitter(seed: number, amp: number): number {
  const s = Math.sin(seed) * 43758.5453;
  return (s - Math.floor(s) - 0.5) * 2 * amp;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function constellationNodes(totalXp: number): ConstellationData {
  const progress = levelProgress(totalXp);
  const start = Math.max(0, progress.level - WINDOW_BEHIND);
  const end = progress.level + WINDOW_AHEAD;

  const nodes: ConstellationNode[] = [];
  for (let level = start; level <= end; level++) {
    const [sx, sy] = SLOTS[level - start];
    nodes.push({
      level,
      x: clamp(sx + jitter(level * 127.1, 9), PAD_X, VIEW_W - PAD_X),
      y: clamp(sy + jitter(level * 311.7, 9), PAD_TOP, VIEW_H - PAD_BOTTOM),
      reached: level <= progress.level,
      current: level === progress.level,
      xpRequired: xpForLevel(level),
    });
  }

  return {
    nodes,
    ratio: progress.ratio,
    level: progress.level,
    totalXp: progress.totalXp,
  };
}

export interface DecorStar {
  x: number;
  y: number;
  r: number;
  opacity: number;
}

/** Estrelinhas decorativas de fundo (seed fixa — sempre o mesmo céu). */
export function starField(count = 40): DecorStar[] {
  const stars: DecorStar[] = [];
  for (let i = 1; i <= count; i++) {
    const fx = Math.sin(i * 12.9898) * 43758.5453;
    const fy = Math.sin(i * 78.233) * 12543.2971;
    const fr = Math.sin(i * 39.425) * 27183.1131;
    stars.push({
      x: (fx - Math.floor(fx)) * VIEW_W,
      y: (fy - Math.floor(fy)) * VIEW_H,
      r: 0.7 + (fr - Math.floor(fr)) * 0.9,
      opacity: 0.04 + (fr - Math.floor(fr)) * 0.04,
    });
  }
  return stars;
}
