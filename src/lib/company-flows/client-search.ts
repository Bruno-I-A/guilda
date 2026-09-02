export interface SearchableCompanyFlowClient {
  id: string;
  name: string;
  cnpj: string | null;
}

function normalizeSearchValue(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

export function searchCompanyFlowClients<T extends SearchableCompanyFlowClient>(
  clients: readonly T[],
  query: string,
  limit = 12,
): T[] {
  const normalizedQuery = normalizeSearchValue(query.trim());
  const queryDigits = query.replace(/\D/g, "");

  return clients
    .filter((client) => {
      if (!normalizedQuery) return true;
      if (normalizeSearchValue(client.name).includes(normalizedQuery)) return true;
      return Boolean(
        queryDigits && client.cnpj?.replace(/\D/g, "").includes(queryDigits),
      );
    })
    .slice(0, limit);
}
