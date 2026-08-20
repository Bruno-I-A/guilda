import { describe, expect, test } from "vitest";

import {
  deriveFiscalControlStatus,
  fiscalProfileMissingFields,
  fiscalProfileVersionMatches,
  initialFiscalStepStatus,
} from "./fiscal-control";

describe("controle fiscal mensal", () => {
  test("detecta edição concorrente da Ficha Fiscal", () => {
    expect(fiscalProfileVersionMatches(3, 3)).toBe(true);
    expect(fiscalProfileVersionMatches(4, 3)).toBe(false);
    expect(fiscalProfileVersionMatches(undefined, null)).toBe(true);
    expect(fiscalProfileVersionMatches(1, null)).toBe(false);
  });

  test("materializa somente etapas obrigatórias como pendentes", () => {
    expect(initialFiscalStepStatus("required")).toBe("pending");
    expect(initialFiscalStepStatus("unknown")).toBe("pending");
    expect(initialFiscalStepStatus("not_required")).toBe("not_applicable");
    expect(initialFiscalStepStatus("not_applicable")).toBe("not_applicable");
  });

  test("deriva o status geral das etapas", () => {
    expect(deriveFiscalControlStatus(["pending", "not_applicable"])).toBe(
      "not_started",
    );
    expect(deriveFiscalControlStatus(["completed", "pending"])).toBe(
      "in_progress",
    );
    expect(deriveFiscalControlStatus(["completed", "blocked"])).toBe(
      "blocked",
    );
    expect(
      deriveFiscalControlStatus(["completed", "not_applicable", "completed"]),
    ).toBe("completed");
  });

  test("ficha informa os campos que ainda precisam de conferência", () => {
    expect(
      fiscalProfileMissingFields({
        profileExists: true,
        movementsApplicability: "required",
        incomingApplicability: "not_required",
        outgoingApplicability: "required",
        guideApplicability: "required",
        nfsApplicability: "not_applicable",
        factorRApplicability: "not_required",
        deliveryChannel: "Onvio",
      }),
    ).toEqual([]);
    expect(
      fiscalProfileMissingFields({
        profileExists: true,
        movementsApplicability: "required",
        deliveryChannel: " ",
      }),
    ).toEqual(["entrada", "saída", "guia", "NFS", "Fator R", "entrega"]);
    expect(
      fiscalProfileMissingFields({
        profileExists: true,
        movementsApplicability: "unknown",
        incomingApplicability: "not_required",
        outgoingApplicability: "not_applicable",
        guideApplicability: "required",
        nfsApplicability: "not_required",
        factorRApplicability: "unknown",
        deliveryChannel: "Onvio",
      }),
    ).toEqual(["movimentos", "Fator R"]);
  });
});
