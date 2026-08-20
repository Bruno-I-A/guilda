import { describe, expect, it } from "vitest";

import {
  deriveOfficeFeeStatus,
  initialOfficeFeeSteps,
  isCanonicalFee,
  officeFeeProfileVersionMatches,
} from "./office-fee-control";

describe("controle mensal de honorários", () => {
  it("exige a parcela adicional apenas para quem a cobra", () => {
    expect(initialOfficeFeeSteps(true)).toEqual({
      invoice: "pending",
      additional_installment: "pending",
      collection: "pending",
    });
    expect(initialOfficeFeeSteps(false).additional_installment).toBe("not_applicable");
  });

  it("fecha somente depois de todas as etapas aplicáveis", () => {
    expect(
      deriveOfficeFeeStatus({
        invoice: "completed",
        additional_installment: "not_applicable",
        collection: "completed",
      }),
    ).toBe("completed");
    expect(
      deriveOfficeFeeStatus({
        invoice: "completed",
        additional_installment: "pending",
        collection: "completed",
      }),
    ).toBe("in_progress");
  });

  it("mantém validação decimal e concorrência de versão", () => {
    expect(isCanonicalFee("52980.00")).toBe(true);
    expect(isCanonicalFee("52.980,00")).toBe(false);
    expect(officeFeeProfileVersionMatches(3, 3)).toBe(true);
    expect(officeFeeProfileVersionMatches(4, 3)).toBe(false);
  });
});
