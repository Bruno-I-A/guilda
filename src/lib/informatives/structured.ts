import {
  informativeDraftPayloadSchema,
  type InformativeDraftPayload,
} from "@/lib/ai/informative-schema";
import type { TaxRegime } from "@/lib/clients-ui";

export const STRUCTURED_INFORMATIVE_MODEL = "structured-panel-v1";

export interface StructuredMissionInput {
  clanId: string;
  description: string;
}

export interface StructuredInformativeCompany {
  legalName: string;
  normalizedCnpj: string;
  taxRegime: TaxRegime;
  clientId: string | null;
  createClient: boolean;
  cnaeCode: string | null;
  cnaeDescription: string | null;
  secondaryCnaes: { code: string; description: string }[] | null;
  openedAt: string | null;
}

interface StructuredClan {
  id: string;
  name: string;
}

function missionTitle(description: string): string {
  const firstLine = description
    .split(/\r?\n/, 1)[0]
    .replace(/\s+/g, " ")
    .trim();
  return firstLine.slice(0, 200);
}

/**
 * Monta a mesma prévia persistida pelo fluxo antigo, mas a partir de campos
 * estruturados. Não chama modelo de linguagem e não tenta inferir destinos.
 */
export function buildStructuredInformativePayload(input: {
  clans: readonly StructuredClan[];
  missions: readonly StructuredMissionInput[];
  company?: StructuredInformativeCompany;
}): InformativeDraftPayload {
  const clansById = new Map(input.clans.map((clan) => [clan.id, clan]));
  const tasks = input.missions.map((mission) => {
    const clan = clansById.get(mission.clanId);
    if (!clan) throw new Error("Clã ativo não encontrado.");
    const description = mission.description.trim();
    if (!description) throw new Error("Descrição da missão ausente.");

    return {
      category: "general" as const,
      title: missionTitle(description),
      description,
      priority: 2,
      difficulty: 1,
      dueDate: null,
      closingYear: null,
      sourceSection: description,
      sector: clan.name,
      suggestions: [],
      assignmentType: "clan" as const,
      assigneeId: null,
      assigneeName: null,
      clanId: clan.id,
      clanName: clan.name,
    };
  });
  const company = input.company;

  return informativeDraftPayloadSchema.parse({
    kind: company ? "new_client" : "general_task",
    sourceFormat: company ? "informative" : "business_mission",
    company: {
      systemCode: null,
      legalName: company?.legalName ?? null,
      cnpj: company?.normalizedCnpj ?? null,
      taxRegime: company?.taxRegime ?? null,
      city: null,
      contact: null,
      summary: company
        ? `Solicitação referente a ${company.legalName}.`
        : "Solicitação de missões por clã.",
      normalizedCnpj: company?.normalizedCnpj ?? null,
      clientId: company?.clientId ?? null,
      createClient: company?.createClient ?? false,
      cnaeCode: company?.cnaeCode ?? null,
      cnaeDescription: company?.cnaeDescription ?? null,
      secondaryCnaes: company?.secondaryCnaes ?? null,
      openedAt: company?.openedAt ?? null,
      pendingFiscalNote: null,
      suggestedFiscalOwnerId: null,
    },
    tasks,
    ignoredNotes: [],
    commitments: [],
    observations: [],
    unresolvedAssignees: [],
    warnings:
      company && !company.createClient && company.clientId
        ? [`Este CNPJ já está cadastrado como “${company.legalName}” — nenhuma empresa nova será criada.`]
        : [],
  });
}

export function structuredInformativeSourceText(
  missions: readonly StructuredMissionInput[],
  clans: readonly StructuredClan[],
): string {
  const clansById = new Map(clans.map((clan) => [clan.id, clan.name]));
  return [
    "MISSÕES ESTRUTURADAS",
    ...missions.map(
      (mission) =>
        `${clansById.get(mission.clanId) ?? "Clã não localizado"} — ${mission.description.trim()}`,
    ),
  ].join("\n");
}
