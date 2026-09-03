import { describe, expect, test } from "vitest";

import {
  amendmentClientRegistrationUpdate,
  amendmentRequiresExternalRegistrationTask,
  accountantChangeInformativeText,
  accountantChangeNoticeTitle,
  companyFlowAmendmentChanges,
  companyFlowAmendmentNoticeBody,
  companyFlowBillingAction,
  companyFlowActionsText,
  companyFlowDisplayName,
  companyFlowInformativeTaskTitle,
  companyFlowTaskTitle,
  COMPANY_FLOW_TASK_DIFFICULTY,
  companyFlowInformativeText,
  companyFlowInformativeNoticeTitle,
  companyFlowRhVerificationState,
  directCompanyInformativeText,
  parseQsaParticipation,
  qsaDistributionIsComplete,
  qsaFinalParticipationTotal,
  qsaMemberCapitalValue,
} from "./company-flow";

describe("Fluxo Societário", () => {
  test("trava somente baixas novas enquanto o RH ainda não concluiu a verificação", () => {
    expect(companyFlowRhVerificationState({
      kind: "closure",
      taskId: "task-rh",
      taskStatus: "pending",
    })).toBe("pending");
    expect(companyFlowRhVerificationState({
      kind: "closure",
      taskId: "task-rh",
      taskStatus: "completed",
    })).toBe("confirmed");
    expect(companyFlowRhVerificationState({
      kind: "closure",
      taskId: null,
      taskStatus: null,
    })).toBe("not_required");
    expect(companyFlowRhVerificationState({
      kind: "amendment",
      taskId: "task-rh",
      taskStatus: "pending",
    })).toBe("not_required");
  });

  test("leva os dados aprovados ao informativo sem vazar credencial", () => {
    const text = companyFlowInformativeText({
      kind: "opening",
      existingClientName: null,
      existingClientCnpj: null,
      existingClientTaxRegime: null,
      requestedLegalName: "NOME PRETENDIDO LTDA",
      requestedActivities: [{ description: "Comércio" }],
      removedActivities: [],
      taxRegime: "simples",
      iptu: "123456",
      socialCapital: "30000.00",
      roomSize: "45 m²",
      address: "Rua Exemplo, 100, Porto Alegre/RS",
      clientResponsible: "Maria",
      qsa: [{ name: "Maria", qualification: "Sócia", participation: "100%" }],
      contactName: "Maria",
      contactPhone: "51999999999",
      contactEmail: "maria@example.com",
      requestDetails: "Abrir empresa para comércio.",
      resultCnpj: "12345678000199",
      approvedLegalName: "NOME APROVADO LTDA",
      approvedActivities: [{ description: "Comércio varejista" }],
      approvedTaxRegime: null,
      approvedAddress: null,
      approvedQsa: [],
      processingNotes: "Deferido pela Junta.",
    });

    expect(text).toContain("INFORMATIVO — ABERTURA");
    expect(text).toContain("NOME APROVADO LTDA");
    expect(text).toContain("CNPJ: 12345678000199");
    expect(text).toContain("Atividades aprovadas: Comércio varejista");
    expect(text).toContain("Regime tributário: Simples Nacional");
    expect(text).toContain("IPTU: 123456");
    expect(text).toContain("Capital social: R$");
    expect(text).toContain("Tamanho da sala: 45 m²");
    expect(text).toContain("Endereço: Rua Exemplo, 100, Porto Alegre/RS");
    expect(text).not.toContain("Gov.br");
    expect(text).toContain("Fiscal - ...");
  });

  test("leva a solicitação completa de alteração ao informativo e cria ação para o Societário", () => {
    const text = companyFlowInformativeText({
      kind: "amendment",
      existingClientName: "EMPRESA ATUAL LTDA",
      existingClientCnpj: "12345678000195",
      existingClientTaxRegime: "simples",
      requestedLegalName: "EMPRESA RENOMEADA LTDA",
      requestedActivities: [{ description: "Comércio eletrônico" }],
      removedActivities: [{ description: "Comércio atacadista" }],
      taxRegime: "presumido",
      iptu: "123.456.789",
      socialCapital: "50000.00",
      roomSize: null,
      address: "Rua Nova, 200, São Paulo/SP",
      clientResponsible: null,
      qsa: [{
        name: "Ana",
        changeType: "entered",
        qualification: "Sócia administradora",
        previousParticipation: "0%",
        participation: "100%",
        quotaTransferDetails: "aumento de capital",
      }],
      contactName: null,
      contactPhone: null,
      contactEmail: null,
      requestDetails: "Alterar endereço e quadro societário.",
      resultCnpj: null,
      approvedLegalName: null,
      approvedActivities: [],
      approvedTaxRegime: null,
      approvedAddress: null,
      approvedQsa: [],
      processingNotes: "Alteração deferida pela Junta.",
    });

    expect(text).toContain("Empresa: EMPRESA ATUAL LTDA");
    expect(text).toContain("Nova razão social: EMPRESA RENOMEADA LTDA");
    expect(text).toContain("Atividades a incluir: Comércio eletrônico");
    expect(text).toContain("Atividades a retirar: Comércio atacadista");
    expect(text).toContain("Novo regime tributário: Lucro Presumido");
    expect(text).toContain("Novo endereço: Rua Nova, 200, São Paulo/SP");
    expect(text).toContain("Composição societária final: Entrada — Ana — Sócia administradora — Participação: 0% → 100% — Capital final: R$");
    expect(text).toContain("Movimentação de quotas: aumento de capital");
    expect(text).toContain("Societário - Atualizar alvará, Inscrição Estadual");
    expect(text).not.toContain("CNPJ:");
  });

  test("só cria atualização de Alvará para razão social, atividades ou endereço", () => {
    const base = {
      kind: "amendment" as const,
      existingClientName: "EMPRESA ATUAL LTDA",
      requestedLegalName: null,
      approvedLegalName: null,
      requestedActivities: [],
      removedActivities: [],
      approvedActivities: [],
      address: null,
      approvedAddress: null,
    };

    expect(amendmentRequiresExternalRegistrationTask(base)).toBe(false);
    expect(amendmentRequiresExternalRegistrationTask({
      ...base,
      requestedLegalName: "EMPRESA NOVA LTDA",
    })).toBe(true);
    expect(amendmentRequiresExternalRegistrationTask({
      ...base,
      requestedActivities: [{ description: "Comércio varejista" }],
    })).toBe(true);
    expect(amendmentRequiresExternalRegistrationTask({
      ...base,
      removedActivities: [{ description: "Serviços administrativos" }],
    })).toBe(true);
    expect(amendmentRequiresExternalRegistrationTask({
      ...base,
      address: "Rua Nova, 100",
    })).toBe(true);

    const taxOnlyText = companyFlowInformativeText({
      kind: "amendment",
      existingClientName: "EMPRESA ATUAL LTDA",
      existingClientCnpj: null,
      existingClientTaxRegime: "simples",
      requestedLegalName: null,
      requestedActivities: [],
      removedActivities: [],
      taxRegime: "real",
      iptu: null,
      socialCapital: null,
      roomSize: null,
      address: null,
      clientResponsible: null,
      qsa: [],
      contactName: null,
      contactPhone: null,
      contactEmail: null,
      requestDetails: "Alterar somente o regime tributário.",
      resultCnpj: null,
      approvedLegalName: null,
      approvedActivities: [],
      approvedTaxRegime: null,
      approvedAddress: null,
      approvedQsa: [],
      processingNotes: "Alteração concluída.",
    });
    expect(taxOnlyText).toContain("Sem missão operacional adicional");
    expect(taxOnlyText).not.toContain("Atualizar alvará");
  });

  test("resume a alteração mostrando os valores anteriores e os novos", () => {
    const changes = companyFlowAmendmentChanges({
      kind: "amendment",
      existingClientName: "EMPRESA ATUAL LTDA",
      existingClientCnpj: "12345678000195",
      existingClientTaxRegime: "simples",
      requestedLegalName: "EMPRESA RENOMEADA LTDA",
      requestedActivities: [{ description: "Comércio eletrônico" }],
      removedActivities: [{ description: "Comércio atacadista" }],
      taxRegime: "real",
      iptu: "123.456",
      socialCapital: "50000.00",
      roomSize: null,
      address: "Rua Nova, 200",
      clientResponsible: null,
      qsa: [{ name: "Ana", changeType: "entered", participation: "50%" }],
      contactName: null,
      contactPhone: "51999999999",
      contactEmail: "ana@example.com",
      requestDetails: null,
      resultCnpj: null,
      approvedLegalName: null,
      approvedActivities: [],
      approvedTaxRegime: null,
      approvedAddress: null,
      approvedQsa: [],
      processingNotes: null,
    });

    expect(changes).toEqual(expect.arrayContaining([
      {
        label: "Razão social",
        previous: "EMPRESA ATUAL LTDA",
        next: "EMPRESA RENOMEADA LTDA",
      },
      {
        label: "Regime tributário",
        previous: "Simples Nacional",
        next: "Lucro Real",
      },
      { label: "Endereço", previous: null, next: "Rua Nova, 200" },
      {
        label: "Composição societária final",
        previous: null,
        next: expect.stringContaining("Entrada — Ana — Participação final: 50% — Capital final: R$"),
      },
    ]));

    const body = companyFlowAmendmentNoticeBody({
      kind: "amendment",
      existingClientName: "EMPRESA ATUAL LTDA",
      existingClientCnpj: null,
      existingClientTaxRegime: "simples",
      requestedLegalName: "EMPRESA RENOMEADA LTDA",
      requestedActivities: [],
      removedActivities: [],
      taxRegime: "real",
      iptu: null,
      socialCapital: null,
      roomSize: null,
      address: null,
      clientResponsible: null,
      qsa: [],
      contactName: null,
      contactPhone: null,
      contactEmail: null,
      requestDetails: "Alteração aprovada.",
      resultCnpj: null,
      approvedLegalName: null,
      approvedActivities: [],
      approvedTaxRegime: null,
      approvedAddress: null,
      approvedQsa: [],
      processingNotes: null,
    }, 1);
    expect(body).toContain("ALTERAÇÃO CADASTRAL");
    expect(body).toContain("Razão social: EMPRESA ATUAL LTDA → EMPRESA RENOMEADA LTDA");
    expect(body).toContain("Regime tributário: Simples Nacional → Lucro Real");
    expect(body).toContain("1 missão foi criada a partir desta alteração.");
  });

  test("confere a composição final do QSA e calcula o capital de cada sócio", () => {
    const qsa = [
      { participation: "60,5%" },
      { participation: "39.5" },
      { participation: "0%" },
    ];

    expect(parseQsaParticipation("60,5%")).toBe(60.5);
    expect(qsaFinalParticipationTotal(qsa)).toBe(100);
    expect(qsaDistributionIsComplete(qsa)).toBe(true);
    expect(qsaDistributionIsComplete([{ participation: "99,9%" }])).toBe(false);
    expect(qsaMemberCapitalValue("50000.00", "60,5%")).toBe("30250.00");
  });

  test("prepara a baixa no modelo operacional padrão", () => {
    const text = companyFlowInformativeText({
      kind: "closure",
      existingClientName: "MARA G BORSATTI & CIA LTDA",
      existingClientCnpj: "12543850000115",
      existingClientTaxRegime: "simples",
      requestedLegalName: null,
      requestedActivities: [],
      removedActivities: [],
      taxRegime: null,
      iptu: null,
      socialCapital: null,
      roomSize: null,
      address: null,
      clientResponsible: null,
      qsa: [],
      contactName: null,
      contactPhone: null,
      contactEmail: null,
      requestDetails: "EMPRESA BAIXADA 30/06/2026\nCOBRANÇA – RECIBO",
      resultCnpj: null,
      approvedLegalName: null,
      approvedActivities: [],
      approvedTaxRegime: null,
      approvedAddress: null,
      approvedQsa: [],
      processingNotes: "Baixa concluída pelo Societário.",
      rhVerificationConfirmed: true,
    });

    expect(text).toContain("INFORMATIVO DE BAIXA DE CLIENTE");
    expect(text).toContain("BAIXA DE CLIENTE – código (487)");
    expect(text).toContain("CNPJ/CPF/CEI – 12.543.850/0001-15");
    expect(text).toContain("ENQUADRAMENTO – SIMPLES NACIONAL");
    expect(text).toContain("OBSERVAÇÕES:\nEMPRESA BAIXADA 30/06/2026");
    expect(text).toContain("SOCIETÁRIO – Baixar o Alvará.");
    expect(text).toContain("CONTABIL – Rafa/Bruno – Finalizar lançamentos até a data da baixa");
    expect(text).toContain("VALIDAÇÃO PRÉVIA – Folha e pró-labore confirmados pelo RH antes da baixa.");
    expect(text).not.toContain("RH – Carol/Jenifer – Baixar o pró-labore.");
    expect(text).not.toContain("(efetuado)");
    expect(text).toContain("SUCESSO DO CLIENTE – Separar toda a documentação");
    expect(text).not.toContain("ATENDIMENTO – Jessica");
    expect(text).toContain("SUCESSO DO CLIENTE – Retirar empresa do E-Auditoria.");
    expect(text).toContain("SUCESSO DO CLIENTE – Retirar empresa do Onvio.");
    expect(text).not.toContain("SERVIDOR");
  });

  test("mantém a missão de RH apenas para baixas legadas sem verificação preventiva", () => {
    const text = companyFlowInformativeText({
      kind: "closure",
      existingClientName: "EMPRESA LEGADA LTDA",
      existingClientCnpj: null,
      existingClientTaxRegime: "simples",
      requestedLegalName: null,
      requestedActivities: [],
      removedActivities: [],
      taxRegime: null,
      iptu: null,
      socialCapital: null,
      roomSize: null,
      address: null,
      clientResponsible: null,
      qsa: [],
      contactName: null,
      contactPhone: null,
      contactEmail: null,
      requestDetails: null,
      resultCnpj: null,
      approvedLegalName: null,
      approvedActivities: [],
      approvedTaxRegime: null,
      approvedAddress: null,
      approvedQsa: [],
      processingNotes: null,
    });

    expect(text).toContain("RH – Carol/Jenifer – Baixar o pró-labore.");
    expect(text).not.toContain("VALIDAÇÃO PRÉVIA");
  });

  test("prepara a cobrança de alteração e baixa para o Financeiro", () => {
    expect(companyFlowBillingAction({
      kind: "amendment",
      billingAmount: "850.00",
      billingDescription: "Alteração contratual e taxas.",
    })).toEqual({
      title: "Realizar cobrança de R$ 850,00",
      description:
        "Realizar a cobrança de R$ 850,00.\n\nDescrição informada no Fluxo: Alteração contratual e taxas.",
      sourceSection:
        "FINANCEIRO – Cobrar R$ 850,00 – Alteração contratual e taxas.",
    });
    expect(companyFlowBillingAction({
      kind: "opening",
      billingAmount: "850.00",
      billingDescription: "Abertura.",
    })).toBeNull();
    expect(companyFlowBillingAction({
      kind: "closure",
      billingAmount: null,
      billingDescription: null,
    })).toBeNull();

    const text = companyFlowInformativeText({
      kind: "closure",
      existingClientName: "EMPRESA BAIXADA LTDA",
      existingClientCnpj: null,
      existingClientTaxRegime: "simples",
      requestedLegalName: null,
      requestedActivities: [],
      removedActivities: [],
      taxRegime: null,
      iptu: null,
      socialCapital: null,
      roomSize: null,
      address: null,
      clientResponsible: null,
      qsa: [],
      contactName: null,
      contactPhone: null,
      contactEmail: null,
      requestDetails: "Baixa concluída.",
      billingAmount: "850.00",
      billingDescription: "Baixa empresarial e taxas.",
      resultCnpj: null,
      approvedLegalName: null,
      approvedActivities: [],
      approvedTaxRegime: null,
      approvedAddress: null,
      approvedQsa: [],
      processingNotes: null,
    });
    expect(text).toContain("COBRANÇA DO SERVIÇO – R$ 850,00");
    expect(text).toContain("DESCRIÇÃO – Baixa empresarial e taxas.");
    expect(companyFlowActionsText(text)).not.toContain("FINANCEIRO");
  });

  test("prepara o desligamento por alteração de contador com as missões próprias", () => {
    const text = accountantChangeInformativeText({
      companyName: "SUELEN TALIAN SIMÕES",
      cnpj: "33843378000106",
      taxRegime: "simples",
      address: "GETULIO VARGAS",
      responsibilityUntil: "2026-03-31",
      observations: "Empresa solicitou desligamento com aviso prévio.",
      additionalActions:
        "FISCAL – Regularizar pendência específica.\nSucesso do Cliente – Confirmar recebimento dos documentos.",
    });

    expect(text).toContain("INFORMATIVO DE BAIXA DE CLIENTE POR DESLIGAMENTO");
    expect(text).toContain("BAIXA DE CLIENTE – código (681)");
    expect(text).toContain("NOSSA RESPONSABILIDADE – ATÉ 31/03/2026");
    expect(text).toContain("CONTABILIDADE – Encerramento até 31/03/2026");
    expect(text).toContain("FISCAL – Gerar até competência 03/2026.");
    expect(text).toContain("RH – Gerar até competência 03/2026.");
    expect(text).toContain("SUCESSO DO CLIENTE – Encaminhar para o e-mail do cliente");
    expect(text).toContain("FISCAL – Regularizar pendência específica.");
    expect(text).toContain("Sucesso do Cliente – Confirmar recebimento dos documentos.");
    expect(text).not.toContain("SOCIETÁRIO – Baixar o Alvará.");
  });

  test("usa somente as missões estruturadas quando elas substituem as sugestões", () => {
    const text = accountantChangeInformativeText({
      companyName: "EMPRESA TESTE LTDA",
      cnpj: "11222333000181",
      taxRegime: "simples",
      address: null,
      responsibilityUntil: "2026-09-30",
      observations: null,
      actions: "MISSÕES ESTRUTURADAS\nFiscal — Entregar obrigação final.",
    });

    expect(text).toContain("AÇÕES\nMISSÕES ESTRUTURADAS");
    expect(text).toContain("Fiscal — Entregar obrigação final.");
    expect(text).not.toContain("CONTABILIDADE – Encerramento até");
  });

  test("envia à IA somente o bloco de ações do Fluxo", () => {
    const actions = companyFlowActionsText(
      "Empresa: Dado cadastral\nCNPJ: 00.000.000/0000-00\n\nAÇÕES\nFiscal - Camila - parametrizar\nRH - Bruno - cadastrar",
    );

    expect(actions).toBe("Fiscal - Camila - parametrizar\nRH - Bruno - cadastrar");
    expect(companyFlowActionsText("ACOES:\nFiscal - fazer algo")).toBe("Fiscal - fazer algo");
    expect(companyFlowActionsText("Empresa: sem marcador")).toBeNull();
  });

  test("identifica no mural o informativo de baixa", () => {
    expect(companyFlowInformativeNoticeTitle("closure", "ALDUIR")).toBe(
      "Informativo de baixa: ALDUIR",
    );
    expect(companyFlowInformativeNoticeTitle("amendment", "ALDUIR")).toBe(
      "Informativo de alteração: ALDUIR",
    );
  });

  test("identifica no mural o desligamento por troca de contabilidade", () => {
    expect(accountantChangeNoticeTitle("ADONIRAN")).toBe(
      "Desligamento de cliente: ADONIRAN — troca de contabilidade",
    );
  });

  test("monta atalhos diretos de alteração e baixa sem criar fluxo", () => {
    const amendment = directCompanyInformativeText({
      kind: "amendment",
      companyName: "EMPRESA TESTE LTDA",
      cnpj: "11222333000181",
      taxRegime: "simples",
      details: "Mudança de endereço",
      actions: "Fiscal – Atualizar cadastro",
    });
    expect(amendment).toContain("INFORMATIVO DE ALTERAÇÃO DE EMPRESA");
    expect(amendment).toContain("OBSERVAÇÕES:\nO que foi alterado: Mudança de endereço");
    expect(amendment).toContain("AÇÕES\nFiscal – Atualizar cadastro");

    const closure = directCompanyInformativeText({
      kind: "closure",
      companyName: "EMPRESA TESTE LTDA",
      cnpj: null,
      taxRegime: "real",
      details: "Baixa concluída em 31/08/2026",
      actions: "",
    });
    expect(closure).toContain("INFORMATIVO DE BAIXA DE CLIENTE");
    expect(closure).toContain("CNPJ – NÃO INFORMADO");
    expect(closure).toContain("AÇÕES\nNenhuma missão adicional.");
  });

  test("reflete razão social e regime no cadastro apenas após uma alteração", () => {
    expect(amendmentClientRegistrationUpdate({
      kind: "amendment",
      requestedLegalName: "  NOME NOVO LTDA  ",
      taxRegime: "presumido",
    })).toEqual({ name: "NOME NOVO LTDA", taxRegime: "presumido" });
    expect(amendmentClientRegistrationUpdate({
      kind: "opening",
      requestedLegalName: "EMPRESA NOVA LTDA",
      taxRegime: "simples",
    })).toBeNull();
  });
});

describe("nome de exibição do Fluxo", () => {
  const base = {
    existingClientName: null,
    approvedLegalName: null,
    requestedLegalName: null,
  };

  test("abertura prefere o nome aprovado na Junta ao solicitado", () => {
    expect(
      companyFlowDisplayName({
        ...base,
        kind: "opening",
        approvedLegalName: "PADARIA AURORA LTDA",
        requestedLegalName: "Padaria Aurora",
      }),
    ).toBe("PADARIA AURORA LTDA");
  });

  test("abertura ainda sem retorno cai no nome solicitado", () => {
    expect(
      companyFlowDisplayName({
        ...base,
        kind: "opening",
        requestedLegalName: "Padaria Aurora",
      }),
    ).toBe("Padaria Aurora");
  });

  test.each(["amendment", "closure"] as const)(
    "%s prefere o cadastro, que é a fonte de verdade da empresa existente",
    (kind) => {
      expect(
        companyFlowDisplayName({
          ...base,
          kind,
          existingClientName: "Padaria Aurora ME",
          approvedLegalName: "OUTRO NOME LTDA",
        }),
      ).toBe("Padaria Aurora ME");
    },
  );

  test("sem nenhum nome, não devolve string vazia", () => {
    expect(companyFlowDisplayName({ ...base, kind: "closure" })).toBe(
      "Empresa não informada",
    );
  });
});

describe("missões geradas pelo Fluxo", () => {
  test("o título diz o tipo do fluxo, que é o que a pessoa precisa saber antes de abrir", () => {
    expect(companyFlowTaskTitle("opening", "Padaria Aurora")).toBe(
      "Novo fluxo — Abertura: Padaria Aurora",
    );
    expect(companyFlowTaskTitle("amendment", "Padaria Aurora")).toBe(
      "Novo fluxo — Alteração: Padaria Aurora",
    );
    expect(companyFlowTaskTitle("closure", "Padaria Aurora")).toBe(
      "Novo fluxo — Baixa: Padaria Aurora",
    );
  });

  test("o Informativo nomeia a empresa", () => {
    expect(companyFlowInformativeTaskTitle("Padaria Aurora")).toBe(
      "Gerar o Informativo — Padaria Aurora",
    );
  });

  test("abertura vale mais XP que alteração — ela dá mais trabalho", () => {
    expect(COMPANY_FLOW_TASK_DIFFICULTY.opening).toBeGreaterThan(
      COMPANY_FLOW_TASK_DIFFICULTY.closure,
    );
    expect(COMPANY_FLOW_TASK_DIFFICULTY.closure).toBeGreaterThan(
      COMPANY_FLOW_TASK_DIFFICULTY.amendment,
    );
  });

  test("toda dificuldade cabe na escala 1..5 da fórmula de XP", () => {
    for (const value of Object.values(COMPANY_FLOW_TASK_DIFFICULTY)) {
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(5);
    }
  });
});
