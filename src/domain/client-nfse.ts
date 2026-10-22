import { validateTaxDocument } from "./cnpj";
import { amountToCents, type NfseTakerAddress } from "./nfse";

/**
 * Notas dos clientes: a nota padrão vira, a cada mês, uma nota do mês com
 * valor e descrição resolvidos. Funções puras; o banco e a tela usam as mesmas.
 */

export const CLIENT_NFSE_REFERENCES = ["previous", "current"] as const;
/** A que mês a nota se refere: ao anterior ao da emissão ou ao próprio. */
export type ClientNfseReference = (typeof CLIENT_NFSE_REFERENCES)[number];

export interface Period {
  year: number;
  month: number;
}

export function clientNfseReferencePeriod(period: Period, reference: ClientNfseReference): Period {
  if (reference === "current") return period;
  return period.month === 1 ? { year: period.year - 1, month: 12 } : { year: period.year, month: period.month - 1 };
}

/**
 * Troca os marcadores da descrição: {mes} e {competencia} viram MM/AAAA (o
 * mesmo marcador dos Honorários vale aqui) e {ano} vira AAAA.
 */
export function renderClientNfseDescription(text: string, reference: Period): string {
  const monthYear = `${String(reference.month).padStart(2, "0")}/${reference.year}`;
  return text
    .replaceAll("{mes}", monthYear)
    .replaceAll("{competencia}", monthYear)
    .replaceAll("{ano}", String(reference.year))
    .trim();
}

/** A descrição que a nota do mês recebe ao abrir o mês. */
export function clientNfseMonthDescription(text: string, period: Period, reference: ClientNfseReference): string {
  return renderClientNfseDescription(text, clientNfseReferencePeriod(period, reference));
}

export interface ClientNfseCandidate {
  itemId: string;
  issuerId: string;
  issuerName: string;
  takerName: string;
  /** CPF (11) ou CNPJ (14) do tomador. */
  takerDocument: string;
  /** Decimal canônico do banco ("850.00"). */
  amount: string;
  description: string;
  address: NfseTakerAddress | null;
  /** O modelo fiscal do emissor leva IBS/CBS: o Sistema Nacional exige o endereço (E0234). */
  requireAddress: boolean;
  /** Já há nota na fila ou emitida para este item. */
  hasActiveInvoice: boolean;
  /** O emissor não pode emitir agora (certificado, cadastro): a mensagem diz o porquê. */
  issuerProblem: string | null;
}

export type ClientNfseExclusionReason =
  | "issuer_not_ready"
  | "invalid_document"
  | "zero_amount"
  | "missing_description"
  | "missing_address"
  | "already_active";

export const CLIENT_NFSE_EXCLUSION_LABELS: Record<ClientNfseExclusionReason, string> = {
  issuer_not_ready: "Empresa sem condição de emitir",
  invalid_document: "CPF/CNPJ do tomador inválido",
  zero_amount: "Valor zerado",
  missing_description: "Sem descrição",
  missing_address: "Endereço do tomador incompleto (rua, bairro, CEP e cidade)",
  already_active: "Nota já emitida ou na fila",
};

export interface ClientNfseBatchItem {
  itemId: string;
  issuerId: string;
  issuerName: string;
  takerName: string;
  takerDocument: string;
  description: string;
  amountCents: number;
  address: NfseTakerAddress | null;
}

export interface ClientNfseBatchExclusion {
  itemId: string;
  issuerName: string;
  takerName: string;
  reason: ClientNfseExclusionReason;
  /** Detalhe do motivo quando existe (o problema do emissor). */
  detail: string | null;
}

export interface ClientNfseBatch {
  items: ClientNfseBatchItem[];
  excluded: ClientNfseBatchExclusion[];
  totalCents: number;
}

/** Quem entra no lote do mês e por que o resto fica de fora. */
export function selectClientNfseBatch(candidates: readonly ClientNfseCandidate[]): ClientNfseBatch {
  const items: ClientNfseBatchItem[] = [];
  const excluded: ClientNfseBatchExclusion[] = [];
  for (const candidate of candidates) {
    const amountCents = amountToCents(candidate.amount);
    const reason: ClientNfseExclusionReason | null = candidate.hasActiveInvoice
      ? "already_active"
      : candidate.issuerProblem
        ? "issuer_not_ready"
        : !validateTaxDocument(candidate.takerDocument)
          ? "invalid_document"
          : amountCents === 0
            ? "zero_amount"
            : !candidate.description.trim()
              ? "missing_description"
              : candidate.requireAddress && !candidate.address
                ? "missing_address"
                : null;
    if (reason) {
      excluded.push({
        itemId: candidate.itemId,
        issuerName: candidate.issuerName,
        takerName: candidate.takerName,
        reason,
        detail: reason === "issuer_not_ready" ? candidate.issuerProblem : null,
      });
      continue;
    }
    items.push({
      itemId: candidate.itemId,
      issuerId: candidate.issuerId,
      issuerName: candidate.issuerName,
      takerName: candidate.takerName,
      takerDocument: candidate.takerDocument,
      description: candidate.description.trim(),
      amountCents,
      address: candidate.address,
    });
  }
  return { items, excluded, totalCents: items.reduce((sum, item) => sum + item.amountCents, 0) };
}
