import { companyFlowBillingAction } from "@/domain/company-flow";

export interface ClanMissionPreset {
  clanSlug: string;
  descriptions: string[];
}

export const OPENING_MISSION_PRESETS: readonly ClanMissionPreset[] = [
  {
    clanSlug: "contabilidade",
    descriptions: [
      "Configurar a rotina contábil da nova empresa.\nConfirmar o tratamento da distribuição de lucros e se há alguma necessidade adicional.",
    ],
  },
  {
    clanSlug: "fiscal",
    descriptions: [
      "Configurar a emissão de notas fiscais.\nConfirmar o regime tributário, o sistema de emissão usado pelo cliente e se ele precisa de auxílio na configuração inicial.",
    ],
  },
  {
    clanSlug: "rh",
    descriptions: [
      "Definir pró-labore e admissões.\nConfirmar o valor do pró-labore e se há funcionários a registrar ou transferir de outra empresa.",
    ],
  },
  {
    clanSlug: "financeiro",
    descriptions: [
      "Confirmar valores da abertura e honorários mensais.\nRegistrar os valores, o dia de vencimento e a primeira competência acordados com o cliente.",
    ],
  },
  {
    clanSlug: "sucesso-do-cliente",
    descriptions: [
      "Enviar boas-vindas ao cliente.\nEncaminhar a mensagem de boas-vindas e convidar o cliente a acompanhar os canais de informativos no WhatsApp, Instagram e Facebook.",
      "Agendar o certificado digital.\nOrientar o cliente sobre a importância do certificado e combinar sua emissão, se necessária.",
      "Incluir o cliente no ONVIO.\nConferir os dados e habilitar o acesso ao sistema.",
      "Arquivar a documentação física.\nGuardar os documentos do processo na pasta suspensa correspondente no armário, se houver documentos físicos.",
      "Oferecer conta digital e Open Finance.\nApresentar os serviços ao cliente e registrar se há interesse.",
      "Incluir o cliente no VERI.\nConferir os dados e habilitar o acesso ao sistema.",
      "Organizar a documentação no servidor.\nSalvar os arquivos do cliente na pasta correspondente, com a estrutura de pastas da equipe.",
    ],
  },
];

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

  if (input.kind === "opening") {
    presets.push(...OPENING_MISSION_PRESETS.map((preset) => ({
      clanSlug: preset.clanSlug,
      descriptions: [...preset.descriptions],
    })));
  } else if (input.kind === "closure") {
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
