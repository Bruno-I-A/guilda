import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "vitest";

/**
 * Toda escrita em período e toda observação nova precisam passar pela porta
 * única, que chama o sync do Desafio do dado. Um caminho esquecido deixaria
 * desafio sem desfecho e XP errado em silêncio — foi assim com o Fluxo
 * Societário, que tinha cinco portas e uma ficou sem a regra.
 */
const SRC = path.resolve(process.cwd(), "src");
const PORTA = path.join(SRC, "lib", "closings", "period-writes.ts");
const ESCRITAS = [
  /\.(insert|update|delete)\(\s*schema\.accountingClosings\s*\)/,
  /\.insert\(\s*schema\.closingObservations\s*\)/,
];

function arquivos(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entrada) => {
    const caminho = path.join(dir, entrada.name);
    if (entrada.isDirectory()) return arquivos(caminho);
    return /\.tsx?$/.test(entrada.name) && !/\.test\.tsx?$/.test(entrada.name)
      ? [caminho]
      : [];
  });
}

test("só a porta única grava períodos e cria observações", () => {
  const foraDaPorta = arquivos(SRC)
    .filter((arquivo) => arquivo !== PORTA)
    .filter((arquivo) => {
      const codigo = readFileSync(arquivo, "utf8");
      return ESCRITAS.some((escrita) => escrita.test(codigo));
    })
    .map((arquivo) => path.relative(SRC, arquivo).replaceAll("\\", "/"));
  expect(foraDaPorta).toEqual([]);
});
