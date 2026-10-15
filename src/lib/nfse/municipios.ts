import { normalizeCityKey } from "@/domain/nfse";

import data from "./municipios-ibge.json";

const MUNICIPIOS = data.municipios as Record<string, Record<string, string>>;

/**
 * Código IBGE do município pelo nome e pela UF, na tabela oficial do Sistema
 * Nacional (Anexo A). O cadastro das empresas guarda o nome da cidade, como a
 * Receita devolve na consulta de CNPJ; a nota precisa do código.
 */
export function ibgeCityCode(state: string, city: string): string | null {
  return MUNICIPIOS[state.trim().toUpperCase()]?.[normalizeCityKey(city)] ?? null;
}
