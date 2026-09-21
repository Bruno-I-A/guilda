import { describe, expect, test } from "vitest";

import {
  deriveFiscalControlStatus,
  fiscalProfileMissingFields,
  fiscalProfileVersionMatches,
  initialFiscalControlSteps,
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

  test("não cria pendência de entrada ou saída quando a ficha diz não", () => {
    expect(
      initialFiscalControlSteps({
        movementsApplicability: "not_required",
        incomingApplicability: "not_required",
        outgoingApplicability: "not_applicable",
        guideApplicability: "required",
        nfsApplicability: "required",
        deliveryApplicability: "required",
        deliveryChannel: "e-mail",
      }),
    ).toEqual({
      movements: "not_applicable",
      incoming: "not_applicable",
      outgoing: "not_applicable",
      guide: "pending",
      delivery: "pending",
      nfs: "pending",
    });
  });

  test("envio necessário sem canal ainda vira etapa pendente", () => {
    const base = {
      movementsApplicability: "not_required" as const,
      incomingApplicability: "not_required" as const,
      outgoingApplicability: "not_required" as const,
      guideApplicability: "not_required" as const,
      nfsApplicability: "not_required" as const,
      deliveryChannel: null,
    };
    expect(initialFiscalControlSteps({ ...base, deliveryApplicability: "required" }).delivery).toBe("pending");
    expect(initialFiscalControlSteps({ ...base, deliveryApplicability: "not_required" }).delivery).toBe("not_applicable");
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
        deliveryApplicability: "required",
        factorRApplicability: "not_required",
        deliveryChannel: "Onvio",
      }),
    ).toEqual([]);
    expect(
      fiscalProfileMissingFields({
        profileExists: true,
        movementsApplicability: "required",
        deliveryApplicability: "unknown",
        deliveryChannel: " ",
      }),
    ).toEqual(["entrada", "saída", "guia", "notas fiscais", "Fator R", "entrega"]);
    expect(
      fiscalProfileMissingFields({
        profileExists: true,
        movementsApplicability: "unknown",
        incomingApplicability: "not_required",
        outgoingApplicability: "not_applicable",
        guideApplicability: "required",
        nfsApplicability: "not_required",
        deliveryApplicability: "required",
        factorRApplicability: "unknown",
        deliveryChannel: "Onvio",
      }),
    ).toEqual(["movimentos", "Fator R"]);
    expect(fiscalProfileMissingFields({
      profileExists: true,
      movementsApplicability: "not_required",
      incomingApplicability: "not_required",
      outgoingApplicability: "not_required",
      guideApplicability: "not_required",
      nfsApplicability: "not_required",
      factorRApplicability: "not_required",
      deliveryApplicability: "required",
      deliveryChannel: null,
    })).toEqual(["canal de entrega"]);
  });
});
