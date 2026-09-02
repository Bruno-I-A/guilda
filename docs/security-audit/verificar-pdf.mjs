/**
 * Conferência do PDF gerado: existência, tamanho e número de páginas.
 * Uso: node docs/security-audit/verificar-pdf.mjs
 */
import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PDF = join(dirname(fileURLToPath(import.meta.url)), "relatorio-auditoria-seguranca.pdf");

const info = await stat(PDF);
const bytes = await readFile(PDF);
const texto = bytes.toString("latin1");

// O objeto raiz da árvore de páginas declara /Count com o total.
const contagens = [...texto.matchAll(/\/Type\s*\/Pages[\s\S]{0,400}?\/Count\s+(\d+)/g)].map((m) =>
  Number(m[1]),
);
const objetosPagina = (texto.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
const paginas = contagens.length ? Math.max(...contagens) : objetosPagina;

console.log(`arquivo ......... ${PDF}`);
console.log(`tamanho ......... ${(info.size / 1024).toFixed(1)} KB`);
console.log(`páginas (/Count)  ${paginas}`);
console.log(`objetos /Type/Page ${objetosPagina}`);
console.log(`cabeçalho ....... ${texto.slice(0, 8)}`);
if (paginas !== objetosPagina) {
  console.warn("AVISO: /Count diverge da contagem de objetos de página.");
}
