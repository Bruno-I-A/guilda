/**
 * Gera os ícones rasterizados do app a partir do brasão (Yggdrasil em escudo).
 *
 * O favicon é src/app/icon.svg (vetorial, servido direto). Este script só existe
 * para os alvos que exigem PNG opaco — hoje o apple-icon, porque o iOS compõe o
 * ícone da tela de início sobre fundo próprio e ignora transparência.
 *
 * Rodar depois de mexer em <GuildCrest /> (src/components/guild-crest.tsx):
 *   node scripts/generate-app-icons.mjs
 *
 * Usa sharp, que vem junto com o Next e não está no package.json. Se um dia
 * sumir do node_modules, instalar como devDependency antes de rodar.
 *
 * As cores abaixo são os tokens --crest-* e --background de globals.css
 * convertidos para hex: um SVG rasterizado fora do browser não resolve var().
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import sharp from "sharp";

const GROUND = "#091018"; // --background  oklch(0.17 0.02 252)
const PLATE = "#151F2A"; // --crest-plate  oklch(0.235 0.025 252)
const EDGE = "#B1B9BE"; // --crest-edge   oklch(0.78 0.012 240)
const BEVEL = "#4E5B69"; // --crest-bevel  oklch(0.75 0.03 240 / 30%) sobre a placa
const MARK = "#7FB3D1"; // --crest-mark   oklch(0.74 0.07 235)

const RIVETS = [
  [24, 9.2], [32, 9.2], [40, 9.2],
  [50.4, 13.6], [13.6, 13.6],
  [54.9, 23], [54.9, 31], [9.1, 23], [9.1, 31],
  [52.3, 39.5], [11.7, 39.5],
  [48.6, 44.5], [15.4, 44.5],
];

/** Brasão completo, na mesma geometria de <GuildCrest />, em 64x64. */
function crest() {
  return `
    <path d="M17 7H47L57 17V30C57 43.5 46.6 53.6 32 59C17.4 53.6 7 43.5 7 30V17Z"
          fill="${PLATE}" stroke="${EDGE}" stroke-width="2.4" stroke-linejoin="miter"/>
    <path d="M20 11.5H45.2L52.8 19.1V30C52.8 41.2 44.3 49.7 32 54.6C19.7 49.7 11.2 41.2 11.2 30V19.1Z"
          fill="none" stroke="${BEVEL}" stroke-width="1"/>
    <g fill="${EDGE}">
      ${RIVETS.map(([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="1.15"/>`).join("\n      ")}
    </g>
    <g stroke="${MARK}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <path d="M32 42V18"/>
      <path d="M32 32L24 25M24 25L19.5 20.5M24 25L23.5 19"/>
      <path d="M32 32L40 25M40 25L44.5 20.5M40 25L40.5 19"/>
      <path d="M32 26L26.5 20M26.5 20L23 15.5M26.5 20L27.5 14.5"/>
      <path d="M32 26L37.5 20M37.5 20L41 15.5M37.5 20L36.5 14.5"/>
      <path d="M32 22L28.5 17M32 22L35.5 17"/>
      <path d="M32 42L25 47M25 47L20.5 49M25 47L24.5 51"/>
      <path d="M32 42L39 47M39 47L43.5 49M39 47L39.5 51"/>
      <path d="M32 42V50"/>
    </g>`;
}

/**
 * Brasão centrado no quadrado. `background: null` deixa o PNG com alfa —
 * a placa escura do escudo já dá contraste em fundo claro ou escuro.
 */
function tile(size, { background = null, inset = 1 } = {}) {
  const drawn = size * inset;
  const scale = drawn / 64;
  const offset = (size - drawn) / 2;
  const ground = background ? `<rect width="${size}" height="${size}" fill="${background}"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${ground}
  <g transform="translate(${offset} ${offset}) scale(${scale})">${crest()}
  </g>
</svg>`;
}

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

const targets = [
  // iOS compõe o ícone da tela de início sobre fundo próprio: precisa ser opaco
  // e com margem, senão o escudo encosta na borda do quadrado arredondado.
  { out: "src/app/apple-icon.png", size: 180, background: GROUND, inset: 0.76 },
  // Asset solto para README, portfólio e apresentação: fundo transparente.
  { out: "docs/brasao-guilda.png", size: 1024 },
];

for (const { out, size, ...opts } of targets) {
  const png = await sharp(Buffer.from(tile(size, opts))).png().toBuffer();
  await writeFile(path.join(root, out), png);
  console.log(`✔ ${out} (${size}×${size}, ${(png.length / 1024).toFixed(1)} kB)`);
}
