import type { NfseTemplate } from "../template";

export const TEST_TEMPLATE: NfseTemplate = {
  cityCode: "4314902",
  municipalRegistration: "12345",
  taxRegime: { opSimpNac: "3", regApTribSN: "1", regEspTrib: "0" },
  service: { nationalTaxCode: "171901" },
  issqn: { taxation: "1", withholding: "1" },
  totalTaxes: { kind: "simples", percent: "6.00" },
  descriptions: {
    monthly: "Honorários contábeis referentes à competência {competencia}.",
    additionalInstallment: "Parcela adicional de honorários contábeis de {ano}.",
  },
};
