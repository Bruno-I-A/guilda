import { formatBRLCurrency } from "@/lib/currency";
import { TAX_REGIME_LABELS, type TaxRegime } from "@/lib/clients-ui";
import { formatCnpj } from "./cnpj";

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
  changeType?: "entered" | "left" | "updated" | null;
}

/** Dados seguros para transformar o retorno do Societário em um rascunho. */
export interface FlowInformativeInput {
  kind: CompanyFlowKind;
  existingClientName: string | null;
  existingClientCnpj: string | null;
  existingClientTaxRegime: TaxRegime | null;
  requestedLegalName: string | null;
  requestedActivities: readonly FlowActivity[];
  removedActivities: readonly FlowActivity[];
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

/** Dados de cadastro que uma Alteração concluída deve refletir na empresa. */
export function amendmentClientRegistrationUpdate(input: Pick<
  FlowInformativeInput,
  "kind" | "requestedLegalName" | "taxRegime"
>): { name?: string; taxRegime?: TaxRegime } | null {
  if (input.kind !== "amendment") return null;
  const name = input.requestedLegalName?.trim();
  if (!name && !input.taxRegime) return null;
  return {
    ...(name ? { name } : {}),
    ...(input.taxRegime ? { taxRegime: input.taxRegime } : {}),
  };
}

/**
 * Texto inicial do Informativos. Nunca inclui a credencial Gov.br: ela só é
 * necessária ao processamento societário e não deve circular pelo escritório.
 */
export function companyFlowInformativeText(flow: FlowInformativeInput): string {
  const company = flow.kind === "opening"
    ? flow.approvedLegalName ?? flow.requestedLegalName ?? flow.existingClientName ?? "Empresa não informada"
    : flow.existingClientName ?? flow.approvedLegalName ?? flow.requestedLegalName ?? "Empresa não informada";
  const kind = COMPANY_FLOW_KIND_LABELS[flow.kind].toUpperCase();
  const requestedActivities = flow.requestedActivities
    .map((item) => item.description)
    .filter(Boolean)
    .join("; ");
  const approvedActivities = flow.approvedActivities
    .map((item) => item.description)
    .filter(Boolean)
    .join("; ");
  const removedActivities = flow.removedActivities
    .map((item) => item.description)
    .filter(Boolean)
    .join("; ");
  const qsa = (flow.approvedQsa.length > 0 ? flow.approvedQsa : flow.qsa)
    .map((member) => [
      member.changeType === "entered" ? "Entrada" : member.changeType === "left" ? "Saída" : member.changeType === "updated" ? "Atualização" : null,
      member.name,
      member.qualification,
      member.participation,
    ].filter(Boolean).join(" — "))
    .filter(Boolean)
    .join("; ");
  const taxRegime = flow.approvedTaxRegime ?? flow.taxRegime;
  const address = flow.approvedAddress ?? flow.address;

  if (flow.kind === "closure") {
    const closureTaxRegime = flow.existingClientTaxRegime ?? taxRegime;
    const closureCnpj = flow.existingClientCnpj ?? flow.resultCnpj;
    return [
      "INFORMATIVO DE BAIXA DE CLIENTE",
      "BAIXA DE CLIENTE – código (487)",
      `RAZÃO SOCIAL – ${company}`,
      `CNPJ/CPF/CEI – ${closureCnpj ? formatCnpj(closureCnpj) : "NÃO INFORMADO"}`,
      `ENDEREÇO – ${address ?? "NÃO INFORMADO"}`,
      `ENQUADRAMENTO – ${closureTaxRegime ? TAX_REGIME_LABELS[closureTaxRegime].toUpperCase() : "NÃO INFORMADO"}`,
      "",
      "OBSERVAÇÕES:",
      flow.requestDetails || "—",
      "",
      "AÇÕES",
      "CONTABIL – Rafa/Bruno – Finalizar lançamentos até a data da baixa",
      "FISCAL – Fabi/Jessica – Finalizar todos os informativos da empresa até a data da baixa",
      "RH – Carol/Jenifer – Baixar o pró-labore (efetuado)",
      "ATENDIMENTO – Jessica",
      "ATENDIMENTO – Separar toda a documentação, confeccionar o Protocolo de entrega, combinar a entrega com a cliente e cobrar a baixa.",
      "E-AUDITORIA – Fabi – Retirar do sistema",
      "SERVIDOR – Bruno – Recortar a pasta do cliente e mover para #BAIXADAS, dentro da pasta Geral dos clientes.",
      "ONVIO – Fabi – Retirar cliente do ONVIO também.",
    ].join("\n");
  }

  return [
    `INFORMATIVO — ${kind}`,
    "",
    `Empresa: ${company}`,
    flow.resultCnpj ? `CNPJ: ${flow.resultCnpj}` : null,
    flow.kind === "amendment" && flow.requestedLegalName ? `Nova razão social: ${flow.requestedLegalName}` : null,
    approvedActivities ? `Atividades aprovadas: ${approvedActivities}` : null,
    !approvedActivities && requestedActivities ? `${flow.kind === "amendment" ? "Atividades a incluir" : "Atividades solicitadas"}: ${requestedActivities}` : null,
    removedActivities ? `Atividades a retirar: ${removedActivities}` : null,
    taxRegime ? `${flow.kind === "amendment" ? "Novo regime tributário" : "Regime tributário"}: ${TAX_REGIME_LABELS[taxRegime]}` : null,
    flow.iptu ? `IPTU: ${flow.iptu}` : null,
    flow.socialCapital ? `${flow.kind === "amendment" ? "Novo capital social" : "Capital social"}: ${formatBRLCurrency(flow.socialCapital)}` : null,
    flow.roomSize ? `Tamanho da sala: ${flow.roomSize}` : null,
    address ? `${flow.kind === "amendment" ? "Novo endereço" : "Endereço"}: ${address}` : null,
    flow.clientResponsible ? `Responsável: ${flow.clientResponsible}` : null,
    qsa ? `${flow.approvedQsa.length > 0 ? "QSA atualizado" : "QSA"}: ${qsa}` : null,
    [flow.contactName, flow.contactPhone, flow.contactEmail].filter(Boolean).length > 0
      ? `Contato: ${[flow.contactName, flow.contactPhone, flow.contactEmail].filter(Boolean).join(" · ")}`
      : null,
    flow.requestDetails ? `Solicitação: ${flow.requestDetails}` : null,
    flow.processingNotes ? `Retorno do Societário: ${flow.processingNotes}` : null,
    "",
    "AÇÕES",
    flow.kind === "amendment"
      ? "Societário - Atualizar alvará, Inscrição Estadual e demais cadastros externos aplicáveis à alteração."
      : "Fiscal - ...",
    flow.kind === "amendment" ? null : "Contabilidade - ...",
    flow.kind === "amendment" ? null : "RH - ...",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}
