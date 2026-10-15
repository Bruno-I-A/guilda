import { normalizeCityKey } from "@/domain/nfse";

import data from "./municipios-ibge.json";

const UFS = data.ufs as Record<string, string>;
const MUNICIPIOS = data.municipios as Record<string, string>;

let byName: Map<string, string> | null = null;

function nameIndex(): Map<string, string> {
  if (!byName) {
    byName = new Map();
    for (const [code, name] of Object.entries(MUNICIPIOS)) {
      byName.set(`${UFS[code.slice(0, 2)]}:${normalizeCityKey(name)}`, code);
    }
  }
  return byName;
}

/**
 * Código IBGE do município pelo nome e pela UF, na tabela oficial do Sistema
 * Nacional (Anexo A). O cadastro das empresas guarda o nome da cidade, como a
 * Receita devolve na consulta de CNPJ; a nota precisa do código.
 */
export function ibgeCityCode(state: string, city: string): string | null {
  return nameIndex().get(`${state.trim().toUpperCase()}:${normalizeCityKey(city)}`) ?? null;
}

/** O caminho inverso, para o PDF: a nota traz só o código do município. */
export function ibgeCity(code: string): { name: string; state: string } | null {
  const name = MUNICIPIOS[code];
  return name ? { name, state: UFS[code.slice(0, 2)] } : null;
}
