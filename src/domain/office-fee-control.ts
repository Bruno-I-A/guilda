import {
  deriveFiscalControlStatus,
  type FiscalControlStatus,
  type FiscalStepStatus,
} from "./fiscal-control";

export const OFFICE_FEE_STAGES = [
  "invoice",
  "additional_installment",
  "collection",
] as const;

export type OfficeFeeStage = (typeof OFFICE_FEE_STAGES)[number];
export type OfficeFeeBillingMethod = "asaas" | "recibo" | "pix" | "other";

/** Valor armazenado em decimal canônico, para nunca depender do locale da tela. */
export function isCanonicalFee(value: string): boolean {
  return /^\d+(?:\.\d{1,2})?$/.test(value);
}

/** Converte o combinado da ficha nos três marcadores da competência. */
export function initialOfficeFeeSteps(
  chargesAdditionalInstallment: boolean,
): Record<OfficeFeeStage, FiscalStepStatus> {
  return {
    invoice: "pending",
    additional_installment: chargesAdditionalInstallment
      ? "pending"
      : "not_applicable",
    collection: "pending",
  };
}

export function deriveOfficeFeeStatus(
  steps: Record<OfficeFeeStage, FiscalStepStatus>,
): FiscalControlStatus {
  return deriveFiscalControlStatus(OFFICE_FEE_STAGES.map((stage) => steps[stage]));
}

/** Evita que uma tela antiga salve por cima de uma regra de honorário revisada. */
export function officeFeeProfileVersionMatches(
  currentVersion: number | null | undefined,
  expectedVersion: number | null,
): boolean {
  return (currentVersion ?? null) === expectedVersion;
}
