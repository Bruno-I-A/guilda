/**
 * Código da empresa no sistema contábil Domínio. É um número; a importação de
 * XML de lá encontra a empresa pela pasta "<código>-<nome>".
 */

export const DOMINIO_CODE_MAX_LENGTH = 10;

/**
 * "  0012 " → "12"; "" → null (sem código). Zeros à esquerda saem para que
 * "12" e "012" não virem duas empresas com o mesmo código. Devolve
 * `undefined` quando o texto não é um código válido.
 */
export function normalizeDominioCode(value: string | number | null | undefined): string | null | undefined {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text === "") return null;
  if (!/^\d+$/.test(text)) return undefined;
  const code = text.replace(/^0+(?=\d)/, "");
  return code.length <= DOMINIO_CODE_MAX_LENGTH ? code : undefined;
}

export interface DominioCodeRow {
  rowNumber: number;
  code: string;
  cnpj: string;
}

function headerKey(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

/**
 * Lê a lista de empresas exportada da Domínio: acha o cabeçalho com "Código"
 * e "CNPJ" (ou "Inscrição") nas primeiras linhas e devolve um par por linha.
 * CNPJ que virou número na planilha perde os zeros à esquerda: volta com 14.
 */
export function parseDominioCodeSheet(sheet: readonly (readonly unknown[])[]): {
  rows: DominioCodeRow[];
  rejected: { rowNumber: number; message: string }[];
  error: string | null;
} {
  let header = -1;
  let codeCol = -1;
  let cnpjCol = -1;
  for (let i = 0; i < Math.min(sheet.length, 15) && header < 0; i++) {
    const keys = sheet[i].map(headerKey);
    const code = keys.findIndex((key) => key === "codigo" || key === "cod" || key === "codigoempresa" || key === "codempresa");
    const cnpj = keys.findIndex((key) => key.includes("cnpj") || key.startsWith("inscricao"));
    if (code >= 0 && cnpj >= 0) [header, codeCol, cnpjCol] = [i, code, cnpj];
  }
  if (header < 0) {
    return { rows: [], rejected: [], error: "Não achei as colunas \"Código\" e \"CNPJ\" no cabeçalho da planilha." };
  }
  const rows: DominioCodeRow[] = [];
  const rejected: { rowNumber: number; message: string }[] = [];
  for (let i = header + 1; i < sheet.length; i++) {
    const rowNumber = i + 1;
    const rawCode = sheet[i][codeCol];
    const rawCnpj = sheet[i][cnpjCol];
    if ((rawCode ?? "") === "" && (rawCnpj ?? "") === "") continue;
    const code = normalizeDominioCode(typeof rawCode === "number" ? String(Math.trunc(rawCode)) : String(rawCode ?? ""));
    const digits = String(rawCnpj ?? "").replace(/\D/g, "");
    const cnpj = typeof rawCnpj === "number" && digits.length > 11 && digits.length < 14 ? digits.padStart(14, "0") : digits;
    if (!code) {
      rejected.push({ rowNumber, message: "código vazio ou que não é número" });
    } else if (cnpj.length !== 14) {
      rejected.push({ rowNumber, message: cnpj.length === 11 ? "CPF, não CNPJ" : "sem CNPJ" });
    } else {
      rows.push({ rowNumber, code, cnpj });
    }
  }
  return { rows, rejected, error: null };
}

export interface DominioCodeClient {
  id: string;
  name: string;
  cnpj: string | null;
  dominioCode: string | null;
}

export interface DominioCodePlan {
  updates: { clientId: string; name: string; from: string | null; to: string }[];
  unchanged: number;
  notFound: DominioCodeRow[];
  conflicts: { rowNumber: number; name: string; code: string; message: string }[];
}

/**
 * O que a importação muda, casando pelo CNPJ. O código é único na
 * organização: linha que daria a uma empresa o código que outra mantém, ou o
 * mesmo código a duas empresas, vira conflito e não é gravada.
 */
export function planDominioCodes(clients: readonly DominioCodeClient[], rows: readonly DominioCodeRow[]): DominioCodePlan {
  const byCnpj = new Map<string, DominioCodeClient[]>();
  for (const client of clients) {
    if (client.cnpj) byCnpj.set(client.cnpj, [...(byCnpj.get(client.cnpj) ?? []), client]);
  }
  const notFound: DominioCodeRow[] = [];
  const conflicts: DominioCodePlan["conflicts"] = [];
  const wanted = new Map<string, { client: DominioCodeClient; row: DominioCodeRow }>();
  for (const row of rows) {
    const found = byCnpj.get(row.cnpj);
    if (!found) {
      notFound.push(row);
      continue;
    }
    for (const client of found) wanted.set(client.id, { client, row });
  }

  // O mesmo código pedido para duas empresas: nenhuma das duas leva.
  const askedBy = new Map<string, string[]>();
  for (const [clientId, { row }] of wanted) askedBy.set(row.code, [...(askedBy.get(row.code) ?? []), clientId]);
  for (const [code, ids] of askedBy) {
    if (ids.length < 2) continue;
    for (const id of ids) {
      const { client, row } = wanted.get(id)!;
      conflicts.push({ rowNumber: row.rowNumber, name: client.name, code, message: "o mesmo código aparece para outra empresa na planilha" });
      wanted.delete(id);
    }
  }

  // Código que outra empresa continua usando. Recusar uma troca pode prender
  // outra, então repete até estabilizar.
  for (let changed = true; changed; ) {
    changed = false;
    const finalCode = new Map(clients.map((client) => [client.id, wanted.get(client.id)?.row.code ?? client.dominioCode]));
    for (const [id, { client, row }] of wanted) {
      const holder = clients.find((other) => other.id !== id && finalCode.get(other.id) === row.code);
      if (holder) {
        conflicts.push({ rowNumber: row.rowNumber, name: client.name, code: row.code, message: `o código já é de ${holder.name}` });
        wanted.delete(id);
        changed = true;
        break;
      }
    }
  }

  const updates: DominioCodePlan["updates"] = [];
  let unchanged = 0;
  for (const { client, row } of wanted.values()) {
    if (client.dominioCode === row.code) unchanged++;
    else updates.push({ clientId: client.id, name: client.name, from: client.dominioCode, to: row.code });
  }
  updates.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  conflicts.sort((a, b) => a.rowNumber - b.rowNumber);
  return { updates, unchanged, notFound, conflicts };
}
