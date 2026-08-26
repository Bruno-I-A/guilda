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

/** Título do aviso no mural para distinguir uma baixa dos demais informativos. */
export function companyFlowInformativeNoticeTitle(
  kind: CompanyFlowKind | null | undefined,
  companyName: string,
): string {
  return kind === "closure"
    ? `Informativo de baixa: ${companyName}`
    : kind === "amendment"
      ? `Informativo de alteração: ${companyName}`
      : `Informativo: ${companyName}`;
}

export function accountantChangeNoticeTitle(companyName: string): string {
  return `Desligamento de cliente: ${companyName} — troca de contabilidade`;
}

export function isAccountantChangeInformative(sourceText: string): boolean {
  return /^INFORMATIVO DE BAIXA DE CLIENTE POR DESLIGAMENTO\s*$/im.test(sourceText);
}

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

export interface AmendmentChangeSummary {
  label: string;
  previous: string | null;
  next: string;
}

/** Alterações que exigem refletir os dados em Alvará/IE/cadastros externos. */
export function amendmentRequiresExternalRegistrationTask(
  flow: Pick<
    FlowInformativeInput,
    | "kind"
    | "existingClientName"
    | "requestedLegalName"
    | "approvedLegalName"
    | "requestedActivities"
    | "removedActivities"
    | "approvedActivities"
    | "address"
    | "approvedAddress"
  >,
): boolean {
  if (flow.kind !== "amendment") return false;
  const legalName = (flow.approvedLegalName ?? flow.requestedLegalName)?.trim();
  const changedLegalName = Boolean(
    legalName && legalName !== flow.existingClientName?.trim(),
  );
  const changedActivities =
    flow.requestedActivities.some((activity) => activity.description.trim()) ||
    flow.removedActivities.some((activity) => activity.description.trim()) ||
    flow.approvedActivities.some((activity) => activity.description.trim());
  const changedAddress = Boolean(
    (flow.approvedAddress ?? flow.address)?.trim(),
  );
  return changedLegalName || changedActivities || changedAddress;
}

/** Campos efetivamente pedidos em uma Alteração, prontos para revisão visual. */
export function companyFlowAmendmentChanges(
  flow: FlowInformativeInput,
): AmendmentChangeSummary[] {
  if (flow.kind !== "amendment") return [];

  const changes: AmendmentChangeSummary[] = [];
  const add = (label: string, next: string | null | undefined, previous?: string | null) => {
    const cleanNext = next?.trim();
    if (!cleanNext || cleanNext === previous?.trim()) return;
    changes.push({ label, previous: previous?.trim() || null, next: cleanNext });
  };
  const descriptions = (items: readonly FlowActivity[]) =>
    items.map((item) => item.description.trim()).filter(Boolean).join("; ");
  const qsa = (flow.approvedQsa.length > 0 ? flow.approvedQsa : flow.qsa)
    .map((member) => [
      member.changeType === "entered"
        ? "Entrada"
        : member.changeType === "left"
          ? "Saída"
          : member.changeType === "updated"
            ? "Atualização"
            : null,
      member.name,
      member.qualification,
      member.participation,
    ].filter(Boolean).join(" — "))
    .filter(Boolean)
    .join("; ");

  add(
    "Razão social",
    flow.approvedLegalName ?? flow.requestedLegalName,
    flow.existingClientName,
  );
  add(
    "Atividades adicionadas",
    descriptions(flow.approvedActivities.length > 0
      ? flow.approvedActivities
      : flow.requestedActivities),
  );
  add("Atividades retiradas", descriptions(flow.removedActivities));

  const taxRegime = flow.approvedTaxRegime ?? flow.taxRegime;
  add(
    "Regime tributário",
    taxRegime ? TAX_REGIME_LABELS[taxRegime] : null,
    flow.existingClientTaxRegime
      ? TAX_REGIME_LABELS[flow.existingClientTaxRegime]
      : null,
  );
  add("Endereço", flow.approvedAddress ?? flow.address);
  add("IPTU", flow.iptu);
  add(
    "Capital social",
    flow.socialCapital ? formatBRLCurrency(flow.socialCapital) : null,
  );
  add("QSA", qsa);
  add("Contato", flow.contactName);
  add("Celular", flow.contactPhone);
  add("E-mail", flow.contactEmail);

  return changes;
}

export function companyFlowAmendmentNoticeBody(
  flow: FlowInformativeInput,
  taskCount: number,
): string {
  const company = flow.existingClientName ?? flow.requestedLegalName ?? "Empresa não informada";
  const changes = companyFlowAmendmentChanges(flow);
  return [
    "ALTERAÇÃO CADASTRAL",
    `Empresa: ${company}`,
    "",
    "O que foi alterado:",
    ...(changes.length > 0
      ? changes.map((change) =>
          change.previous
            ? `• ${change.label}: ${change.previous} → ${change.next}`
            : `• ${change.label}: ${change.next}`)
      : ["• Consulte as observações da solicitação."]),
    flow.requestDetails ? "" : null,
    flow.requestDetails ? "Observações da solicitação:" : null,
    flow.requestDetails,
    "",
    taskCount === 1
      ? "1 missão foi criada a partir desta alteração."
      : `${taskCount} missões foram criadas a partir desta alteração.`,
  ].filter((line): line is string => line !== null).join("\n");
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
  const requiresExternalRegistrationTask =
    amendmentRequiresExternalRegistrationTask(flow);

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
      "SOCIETÁRIO – Baixar o Alvará.",
      "CONTABIL – Rafa/Bruno – Finalizar lançamentos até a data da baixa",
      "FISCAL – Fabi/Jessica – Finalizar todos os informativos da empresa até a data da baixa",
      "RH – Carol/Jenifer – Baixar o pró-labore (efetuado)",
      "SUCESSO DO CLIENTE – Separar toda a documentação, confeccionar o Protocolo de entrega, combinar a entrega com a cliente e cobrar a baixa.",
      "SUCESSO DO CLIENTE – Retirar empresa do E-Auditoria.",
      "SUCESSO DO CLIENTE – Retirar empresa do Onvio.",
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
      ? requiresExternalRegistrationTask
        ? "Societário - Atualizar alvará, Inscrição Estadual e demais cadastros externos aplicáveis à alteração."
        : "Sem missão operacional adicional para esta alteração."
      : "Fiscal - ...",
    flow.kind === "amendment" ? null : "Contabilidade - ...",
    flow.kind === "amendment" ? null : "RH - ...",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export interface AccountantChangeInformativeInput {
  companyName: string;
  cnpj: string | null;
  taxRegime: TaxRegime;
  address: string | null;
  responsibilityUntil: string;
  observations: string | null;
  /** Linhas extras no formato "SETOR – ação", incluídas no bloco AÇÕES. */
  additionalActions?: string | null;
}

/** Modelo direto de desligamento — não passa pelo Fluxo Societário. */
export function accountantChangeInformativeText(input: AccountantChangeInformativeInput): string {
  const responsibilityUntil = formatFlowDate(input.responsibilityUntil);
  const competence = `${input.responsibilityUntil.slice(5, 7)}/${input.responsibilityUntil.slice(0, 4)}`;
  return [
    "INFORMATIVO DE BAIXA DE CLIENTE POR DESLIGAMENTO",
    "BAIXA DE CLIENTE – código (681)",
    `RAZÃO SOCIAL – ${input.companyName}`,
    `CNPJ/CPF/CEI – ${input.cnpj ? formatCnpj(input.cnpj) : "NÃO INFORMADO"}`,
    `ENDEREÇO – ${input.address?.trim() || "NÃO INFORMADO"}`,
    `ENQUADRAMENTO – ${TAX_REGIME_LABELS[input.taxRegime].toUpperCase()}`,
    "",
    `NOSSA RESPONSABILIDADE – ATÉ ${responsibilityUntil}`,
    "",
    "OBSERVAÇÕES:",
    input.observations?.trim() || "—",
    "",
    "AÇÕES",
    `CONTABILIDADE – Encerramento até ${responsibilityUntil} para entrega do balancete à nova contabilidade.`,
    `FISCAL – Gerar até competência ${competence}.`,
    `RH – Gerar até competência ${competence}.`,
    "SUCESSO DO CLIENTE – Encaminhar para o e-mail do cliente a documentação que servirá como protocolo de entrega.",
    ...((input.additionalActions ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)),
  ].join("\n");
}

function formatFlowDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}
