import type { AdnBatch } from "./adn-client";
import { readAdnDocument } from "./adn-documents";

export interface XmlRoutineClient {
  clientId: string;
  cnpj: string;
  lastNsu: number;
}

export interface IssuedToStore {
  accessKey: string;
  nsu: number;
  nfseNumber: string | null;
  issuedAt: Date;
  competence: string | null;
  xml: string;
}

export interface CancellationToStore {
  accessKey: string;
  nsu: number;
  cancelledAt: Date | null;
  xml: string;
}

/**
 * Um lote lido de uma empresa. O NSU só avança junto com o que foi gravado.
 * Nota e cancelamento dela podem vir no mesmo lote: quem grava aplica as
 * notas antes dos cancelamentos.
 */
export interface ClientProgress {
  clientId: string;
  issued: IssuedToStore[];
  cancellations: CancellationToStore[];
  lastNsu: number;
  finished: boolean;
}

export interface XmlRoutineDeps {
  fetchBatch(client: XmlRoutineClient, fromNsu: number): Promise<AdnBatch>;
  saveProgress(progress: ClientProgress): Promise<void>;
  saveError(clientId: string, message: string): Promise<void>;
  /** "Guardar notas a partir de": nota emitida antes fica de fora. */
  keepSince: Date | null;
  /** Lotes por empresa numa rodada; o resto fica para a próxima (padrão 400 = 20 mil documentos). */
  maxBatchesPerClient?: number;
}

export interface XmlRoutineResult {
  clientId: string;
  ok: boolean;
  message?: string;
}

const DEFAULT_MAX_BATCHES = 400;
const MAX_ERROR_MESSAGE = 500;
// Acrescentado à mensagem do resultado quando nem o erro da empresa pôde ser
// gravado (banco fora do ar): quem chamou a rodada fica sabendo.
const ERROR_NOT_SAVED = " (e o erro não foi gravado)";

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

async function syncClient(client: XmlRoutineClient, deps: XmlRoutineDeps): Promise<void> {
  let lastNsu = client.lastNsu;
  for (let round = 0; round < (deps.maxBatchesPerClient ?? DEFAULT_MAX_BATCHES); round++) {
    const batch = await deps.fetchBatch(client, lastNsu + 1);
    // Lote sem documentos é o fim, mesmo que não venha marcado: Math.max de
    // lista vazia daria -Infinity.
    if (batch.done || batch.documents.length === 0) {
      await deps.saveProgress({ clientId: client.clientId, issued: [], cancellations: [], lastNsu, finished: true });
      return;
    }
    const highest = Math.max(...batch.documents.map((doc) => doc.nsu));
    if (highest <= lastNsu) {
      throw new Error(`O Sistema Nacional devolveu o NSU ${highest} de novo; leitura interrompida.`);
    }
    const issued: IssuedToStore[] = [];
    const cancellations: CancellationToStore[] = [];
    for (const doc of batch.documents) {
      const reading = readAdnDocument(doc.xml, client.cnpj);
      if (reading.kind === "issued" && (!deps.keepSince || reading.issuedAt >= deps.keepSince)) {
        issued.push({
          accessKey: reading.accessKey,
          nsu: doc.nsu,
          nfseNumber: reading.nfseNumber,
          issuedAt: reading.issuedAt,
          competence: reading.competence,
          xml: doc.xml,
        });
      } else if (reading.kind === "cancellation") {
        cancellations.push({
          accessKey: reading.accessKey,
          nsu: doc.nsu,
          cancelledAt: reading.cancelledAt,
          xml: doc.xml,
        });
      }
    }
    lastNsu = highest;
    await deps.saveProgress({ clientId: client.clientId, issued, cancellations, lastNsu, finished: false });
  }
}

/** Uma empresa por vez (poucos pedidos ao Sistema Nacional); falha de uma não para as outras. */
export async function runXmlRoutine(
  clients: readonly XmlRoutineClient[],
  deps: XmlRoutineDeps,
): Promise<XmlRoutineResult[]> {
  const results: XmlRoutineResult[] = [];
  for (const client of clients) {
    try {
      await syncClient(client, deps);
      results.push({ clientId: client.clientId, ok: true });
    } catch (error) {
      const message = clip(error instanceof Error ? error.message : "Falha desconhecida.", MAX_ERROR_MESSAGE);
      try {
        await deps.saveError(client.clientId, message);
        results.push({ clientId: client.clientId, ok: false, message });
      } catch {
        // O banco caiu junto com a leitura: a rodada segue para a próxima
        // empresa, e o resultado avisa que o erro não ficou registrado.
        results.push({ clientId: client.clientId, ok: false, message: message + ERROR_NOT_SAVED });
      }
    }
  }
  return results;
}
