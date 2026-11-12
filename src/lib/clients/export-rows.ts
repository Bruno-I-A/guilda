import type { Client } from "@/db/schema";
import { formatCnpj } from "@/domain/cnpj";
import { TAX_REGIME_LABELS } from "@/lib/clients-ui";

/**
 * Linhas da planilha de empresas (funções puras), para cadastrar a carteira em
 * outro sistema. Uma linha por empresa, uma coluna por dado — o endereço vem
 * quebrado em campos porque é assim que os outros sistemas importam.
 *
 * Dos sócios sai só nome e qualificação: o documento do QSA é dado pessoal e
 * não é preciso para cadastrar a empresa.
 */

export type ExportClient = Pick<
  Client,
  | "name"
  | "tradeName"
  | "cnpj"
  | "taxRegime"
  | "active"
  | "cadastralSituation"
  | "openedAt"
  | "legalNature"
  | "companySize"
  | "shareCapital"
  | "headquartersType"
  | "cnaeCode"
  | "cnaeDescription"
  | "secondaryCnaes"
  | "address"
  | "operationalEmail"
  | "operationalPhone"
  | "revenueEmail"
  | "revenuePhones"
  | "qsa"
  | "dominioCode"
  | "createdAt"
> & {
  /** Responsável fiscal pela carteira, quando há. */
  fiscalOwnerName: string | null;
};

export type ExportCell = string | number | null;

export const CLIENT_EXPORT_COLUMNS = [
  { header: "Razão social", width: 42 },
  { header: "Nome fantasia", width: 28 },
  { header: "CNPJ / CPF", width: 20 },
  { header: "Regime", width: 18 },
  { header: "Situação na Guilda", width: 12 },
  { header: "Situação cadastral", width: 16 },
  { header: "Data de abertura", width: 14 },
  { header: "Natureza jurídica", width: 32 },
  { header: "Porte", width: 18 },
  { header: "Capital social", width: 16 },
  { header: "Matriz / filial", width: 12 },
  { header: "CNAE principal", width: 12 },
  { header: "Descrição do CNAE", width: 40 },
  { header: "CNAEs secundários", width: 50 },
  { header: "Logradouro", width: 32 },
  { header: "Número", width: 10 },
  { header: "Complemento", width: 18 },
  { header: "Bairro", width: 20 },
  { header: "Cidade", width: 20 },
  { header: "UF", width: 5 },
  { header: "CEP", width: 11 },
  { header: "E-mail de contato", width: 30 },
  { header: "Telefone de contato", width: 18 },
  { header: "E-mail na Receita", width: 30 },
  { header: "Telefones na Receita", width: 24 },
  { header: "Sócios", width: 50 },
  { header: "Código na Domínio", width: 12 },
  { header: "Responsável fiscal", width: 22 },
  { header: "Cadastrada na Guilda em", width: 14 },
] as const;

/** Índice da coluna de capital social, que sai como número com formato de moeda. */
export const SHARE_CAPITAL_COLUMN = CLIENT_EXPORT_COLUMNS.findIndex(
  (column) => column.header === "Capital social",
);

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** "AAAA-MM-DD" → "DD/MM/AAAA"; o resto passa como veio. */
export function brazilianDate(value: string | null | undefined): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  return match ? `${match[3]}/${match[2]}/${match[1]}` : text(value);
}

function zipCode(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length === 8 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : text(value);
}

function money(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function joined(values: readonly string[]): string | null {
  const kept = values.map((value) => value.trim()).filter(Boolean);
  return kept.length ? kept.join("; ") : null;
}

/** A data de cadastro no fuso da operação, para não virar o dia seguinte de madrugada. */
function registeredAt(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return brazilianDate(parts) ?? "";
}

export function clientExportRow(client: ExportClient): ExportCell[] {
  const address = client.address;
  return [
    client.name,
    text(client.tradeName),
    client.cnpj ? formatCnpj(client.cnpj) : null,
    TAX_REGIME_LABELS[client.taxRegime],
    client.active ? "Ativa" : "Inativa",
    text(client.cadastralSituation),
    brazilianDate(client.openedAt),
    text(client.legalNature),
    text(client.companySize),
    money(client.shareCapital),
    text(client.headquartersType),
    text(client.cnaeCode),
    text(client.cnaeDescription),
    joined((client.secondaryCnaes ?? []).map((cnae) => `${cnae.code} - ${cnae.description}`)),
    text(address?.street),
    text(address?.number),
    text(address?.complement),
    text(address?.district),
    text(address?.city),
    text(address?.state)?.toUpperCase() ?? null,
    zipCode(address?.zipCode),
    text(client.operationalEmail),
    text(client.operationalPhone),
    text(client.revenueEmail),
    joined(client.revenuePhones ?? []),
    joined(
      (client.qsa ?? []).map((partner) =>
        partner.qualification ? `${partner.name} (${partner.qualification})` : partner.name,
      ),
    ),
    text(client.dominioCode),
    text(client.fiscalOwnerName),
    registeredAt(client.createdAt),
  ];
}

export function clientExportRows(clients: readonly ExportClient[]): ExportCell[][] {
  return clients.map(clientExportRow);
}
