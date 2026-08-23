import { formatBRLCurrency } from "@/lib/currency";
import { TAX_REGIME_LABELS, type TaxRegime } from "@/lib/clients-ui";

export const COMPANY_FLOW_KINDS = ["opening", "amendment", "closure"] as const;
export type CompanyFlowKind = (typeof COMPANY_FLOW_KINDS)[number];

export const COMPANY_FLOW_STATUSES = [
  "sent_to_corporate",
  "in_progress",
  "awaiting_owner",
  "informative_drafting",
  "completed",
  "cancelled",
] as const;
export type CompanyFlowStatus = (typeof COMPANY_FLOW_STATUSES)[number];

export const COMPANY_FLOW_SOURCES = [
  "written",
  "whatsapp",
  "phone",
  "other",
] as const;
export type CompanyFlowSource = (typeof COMPANY_FLOW_SOURCES)[number];

export const COMPANY_FLOW_KIND_LABELS: Record<CompanyFlowKind, string> = {
  opening: "Abertura",
  amendment: "Alteração",
  closure: "Baixa",
};

export const COMPANY_FLOW_STATUS_LABELS: Record<CompanyFlowStatus, string> = {
  sent_to_corporate: "Aguardando Societário",
  in_progress: "Em processamento",
  awaiting_owner: "Devolvido ao dono",
  informative_drafting: "Informativo em preparação",
  completed: "Concluído",
  cancelled: "Cancelado",
};

/**
 * O formulário do Informativo continua mostrando o resumo completo do Fluxo
 * para revisão humana. A IA, porém, só precisa classificar as providências
 * que vêm depois deste marcador — os dados societários já estão no banco.
 */
export function companyFlowActionsText(sourceText: string): string | null {
  const marker = /(?:^|\n)\s*A(?:Ç|C)(?:Õ|O)ES\s*:?\s*(?:\n|$)/i.exec(sourceText);
  if (!marker) return null;
  const start = (marker.index ?? 0) + marker[0].length;
  const actions = sourceText.slice(start).trim();
  return actions.length > 0 ? actions : null;
}

export interface FlowActivity {
  code?: string | null;
  description: string;
}

export interface FlowQsaMember {
  name: string;
  document?: string | null;
  qualification?: string | null;
  participation?: string | null;
}

/** Dados seguros para transformar o retorno do Societário em um rascunho. */
export interface FlowInformativeInput {
  kind: CompanyFlowKind;
  existingClientName: string | null;
  requestedLegalName: string | null;
  requestedActivities: readonly FlowActivity[];
  taxRegime: TaxRegime | null;
  iptu: string | null;
  socialCapital: string | null;
  roomSize: string | null;
  address: string | null;
  clientResponsible: string | null;
  qsa: readonly FlowQsaMember[];
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  requestDetails: string | null;
  resultCnpj: string | null;
  approvedLegalName: string | null;
  approvedActivities: readonly FlowActivity[];
  approvedTaxRegime: TaxRegime | null;
  approvedAddress: string | null;
  approvedQsa: readonly FlowQsaMember[];
  processingNotes: string | null;
}

/**
 * Texto inicial do Informativos. Nunca inclui a credencial Gov.br: ela só é
 * necessária ao processamento societário e não deve circular pelo escritório.
 */
export function companyFlowInformativeText(flow: FlowInformativeInput): string {
  const company = flow.approvedLegalName ?? flow.requestedLegalName ?? flow.existingClientName ?? "Empresa não informada";
  const kind = COMPANY_FLOW_KIND_LABELS[flow.kind].toUpperCase();
  const requestedActivities = flow.requestedActivities
    .map((item) => item.description)
    .filter(Boolean)
    .join("; ");
  const approvedActivities = flow.approvedActivities
    .map((item) => item.description)
    .filter(Boolean)
    .join("; ");
  const qsa = (flow.approvedQsa.length > 0 ? flow.approvedQsa : flow.qsa)
    .map((member) => [member.name, member.qualification, member.participation].filter(Boolean).join(" — "))
    .filter(Boolean)
    .join("; ");
  const taxRegime = flow.approvedTaxRegime ?? flow.taxRegime;
  const address = flow.approvedAddress ?? flow.address;

  return [
    `INFORMATIVO — ${kind}`,
    "",
    `Empresa: ${company}`,
    flow.resultCnpj ? `CNPJ: ${flow.resultCnpj}` : null,
    approvedActivities ? `Atividades aprovadas: ${approvedActivities}` : null,
    !approvedActivities && requestedActivities ? `Atividades solicitadas: ${requestedActivities}` : null,
    taxRegime ? `Regime tributário: ${TAX_REGIME_LABELS[taxRegime]}` : null,
    flow.iptu ? `IPTU: ${flow.iptu}` : null,
    flow.socialCapital ? `Capital social: ${formatBRLCurrency(flow.socialCapital)}` : null,
    flow.roomSize ? `Tamanho da sala: ${flow.roomSize}` : null,
    address ? `Endereço: ${address}` : null,
    flow.clientResponsible ? `Responsável: ${flow.clientResponsible}` : null,
    qsa ? `${flow.approvedQsa.length > 0 ? "QSA atualizado" : "QSA"}: ${qsa}` : null,
    [flow.contactName, flow.contactPhone, flow.contactEmail].filter(Boolean).length > 0
      ? `Contato: ${[flow.contactName, flow.contactPhone, flow.contactEmail].filter(Boolean).join(" · ")}`
      : null,
    flow.requestDetails ? `Solicitação: ${flow.requestDetails}` : null,
    flow.processingNotes ? `Retorno do Societário: ${flow.processingNotes}` : null,
    "",
    "AÇÕES",
    "Fiscal - ...",
    "Contabilidade - ...",
    "RH - ...",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}
