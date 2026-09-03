import { companyFlowBillingAction } from "@/domain/company-flow";

export interface ClanMissionPreset {
  clanSlug: string;
  descriptions: string[];
}

export const DIRECT_CLOSURE_MISSION_PRESETS: readonly ClanMissionPreset[] = [
  { clanSlug: "societario", descriptions: ["Baixar o Alvará."] },
  {
    clanSlug: "contabilidade",
    descriptions: ["Finalizar lançamentos até a data da baixa."],
  },
  {
    clanSlug: "fiscal",
    descriptions: ["Finalizar todos os informativos da empresa até a data da baixa."],
  },
  {
    clanSlug: "rh",
    descriptions: ["Baixar folha e pró-labore ou confirmar que já foram baixados."],
  },
  {
    clanSlug: "sucesso-do-cliente",
    descriptions: [
      "Separar a documentação, confeccionar o Protocolo de entrega, combinar a entrega e cobrar a baixa.",
      "Retirar a empresa do E-Auditoria.",
      "Retirar a empresa do Onvio.",
    ],
  },
];

function formatDate(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : null;
}

export function accountantChangeMissionPresets(
  responsibilityUntil: string,
): ClanMissionPreset[] {
  const formattedDate = formatDate(responsibilityUntil);
  const competence = formattedDate
    ? responsibilityUntil.slice(5, 7) + "/" + responsibilityUntil.slice(0, 4)
    : "informada acima";
  const deadline = formattedDate ?? "a data de responsabilidade informada acima";

  return [
    {
      clanSlug: "contabilidade",
      descriptions: [
        `Encerrar a contabilidade até ${deadline} para entregar o balancete à nova contabilidade.`,
      ],
    },
    { clanSlug: "fiscal", descriptions: [`Gerar até a competência ${competence}.`] },
    { clanSlug: "rh", descriptions: [`Gerar até a competência ${competence}.`] },
    {
      clanSlug: "sucesso-do-cliente",
      descriptions: [
        "Encaminhar ao e-mail do cliente a documentação que servirá como protocolo de entrega.",
      ],
    },
  ];
}

export function companyFlowMissionPresets(input: {
  kind: "opening" | "amendment" | "closure";
  amendmentRequiresExternalRegistration: boolean;
  rhVerificationConfirmed: boolean;
  billingAmount: string | null;
  billingDescription: string | null;
}): ClanMissionPreset[] {
  const presets: ClanMissionPreset[] = [];

  if (input.kind === "closure") {
    presets.push(...DIRECT_CLOSURE_MISSION_PRESETS.map((preset) => ({
      clanSlug: preset.clanSlug,
      descriptions:
        preset.clanSlug === "rh" && input.rhVerificationConfirmed
          ? []
          : [...preset.descriptions],
    })).filter((preset) => preset.descriptions.length > 0));
  } else if (
    input.kind === "amendment" &&
    input.amendmentRequiresExternalRegistration
  ) {
    presets.push({
      clanSlug: "societario",
      descriptions: [
        "Atualizar Alvará, Inscrição Estadual e demais cadastros externos aplicáveis à alteração.",
      ],
    });
  }

  const billing = companyFlowBillingAction(input);
  if (billing) {
    presets.push({ clanSlug: "financeiro", descriptions: [billing.description] });
  }

  return presets;
}
