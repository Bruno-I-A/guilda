import { createHash, timingSafeEqual } from "node:crypto";

import { strToU8, zipSync } from "fflate";

export interface DanfseRequestItem {
  accessKey: string;
  fileName: string;
}

export const MAX_DANFSE_ITEMS = 200;
export const MIN_SERVICE_TOKEN_LENGTH = 32;

const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.pdf$/;

/** Valida o corpo do pedido de PDFs vindo do app pela rede interna. */
export function parseDanfseRequest(body: unknown): DanfseRequestItem[] | null {
  const items = body && typeof body === "object" ? (body as { items?: unknown }).items : undefined;
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_DANFSE_ITEMS) return null;
  const parsed: DanfseRequestItem[] = [];
  const names = new Set<string>();
  for (const item of items) {
    const accessKey = (item as { accessKey?: unknown })?.accessKey;
    const fileName = (item as { fileName?: unknown })?.fileName;
    if (typeof accessKey !== "string" || !/^\d{50}$/.test(accessKey)) return null;
    if (typeof fileName !== "string" || !FILE_NAME.test(fileName) || names.has(fileName)) return null;
    names.add(fileName);
    parsed.push({ accessKey, fileName });
  }
  return parsed;
}

/** Busca os PDFs (4 por vez) e devolve o .zip; nada é gravado. */
export async function buildDanfseZip(
  items: readonly DanfseRequestItem[],
  fetchPdf: (accessKey: string) => Promise<Buffer>,
  concurrency = 4,
): Promise<{ zip: Uint8Array; failures: { fileName: string; message: string }[] }> {
  const files: Record<string, Uint8Array> = {};
  const failures: { fileName: string; message: string }[] = [];
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const item = items[next++];
      try {
        files[item.fileName] = new Uint8Array(await fetchPdf(item.accessKey));
      } catch (error) {
        failures.push({ fileName: item.fileName, message: error instanceof Error ? error.message : "Falha desconhecida." });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  if (failures.length > 0) {
    const lines = failures.map((failure) => `${failure.fileName}: ${failure.message}`);
    files["LEIA-ME.txt"] = strToU8(
      `Estes PDFs não vieram do Sistema Nacional. Consulte as notas no Portal Nacional:\n\n${lines.join("\n")}\n`,
    );
  }
  return { zip: zipSync(files, { level: 0 }), failures };
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Bearer exato, comparado em tempo constante. Token curto nunca vale. */
export function tokenMatches(expected: string, authorization: string | undefined): boolean {
  if (expected.length < MIN_SERVICE_TOKEN_LENGTH || !authorization?.startsWith("Bearer ")) return false;
  return timingSafeEqual(digest(expected), digest(authorization.slice("Bearer ".length)));
}
