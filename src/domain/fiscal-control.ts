export const FISCAL_STAGES = [
  "movements",
  "incoming",
  "outgoing",
  "guide",
  "delivery",
  "nfs",
] as const;

export type FiscalStage = (typeof FISCAL_STAGES)[number];
export type FiscalStepStatus =
  | "not_applicable"
  | "pending"
  | "completed"
  | "blocked";
export type FiscalControlStatus =
  | "not_started"
  | "in_progress"
  | "blocked"
  | "completed";

export type FiscalApplicability =
  | "unknown"
  | "required"
  | "not_required"
  | "not_applicable";

/** Evita salvar por cima de uma ficha alterada depois que a tela foi aberta. */
export function fiscalProfileVersionMatches(
  currentVersion: number | null | undefined,
  expectedVersion: number | null,
): boolean {
  return (currentVersion ?? null) === expectedVersion;
}

/** Etapa nasce pendente somente quando a ficha diz que o trabalho se aplica. */
export function initialFiscalStepStatus(
  applicability: FiscalApplicability,
): FiscalStepStatus {
  return applicability === "required" || applicability === "unknown"
    ? "pending"
    : "not_applicable";
}

/**
 * O status geral é derivado das etapas e não depende de um clique separado.
 * Assim a grade e os resumos nunca contradizem as células.
 */
export function deriveFiscalControlStatus(
  steps: readonly FiscalStepStatus[],
): FiscalControlStatus {
  if (steps.some((step) => step === "blocked")) return "blocked";
  if (steps.every((step) => step === "completed" || step === "not_applicable")) {
    return "completed";
  }
  if (steps.some((step) => step === "completed")) return "in_progress";
  return "not_started";
}

export interface FiscalProfileCompletenessFacts {
  profileExists: boolean;
  movementsApplicability?: FiscalApplicability | null;
  incomingApplicability?: FiscalApplicability | null;
  outgoingApplicability?: FiscalApplicability | null;
  guideApplicability?: FiscalApplicability | null;
  nfsApplicability?: FiscalApplicability | null;
  factorRApplicability?: FiscalApplicability | null;
  deliveryChannel?: string | null;
}

/**
 * Receita e observações são opcionais; os cinco marcadores, Fator R e a
 * forma de entrega precisam ser explicitamente conhecidos para a ficha
 * deixar de aparecer como incompleta.
 */
export function fiscalProfileMissingFields(
  profile: FiscalProfileCompletenessFacts,
): string[] {
  if (!profile.profileExists) return ["ficha"];

  const missing: string[] = [];
  if (!profile.movementsApplicability || profile.movementsApplicability === "unknown") missing.push("movimentos");
  if (!profile.incomingApplicability || profile.incomingApplicability === "unknown") missing.push("entrada");
  if (!profile.outgoingApplicability || profile.outgoingApplicability === "unknown") missing.push("saída");
  if (!profile.guideApplicability || profile.guideApplicability === "unknown") missing.push("guia");
  if (!profile.nfsApplicability || profile.nfsApplicability === "unknown") missing.push("NFS");
  if (!profile.factorRApplicability || profile.factorRApplicability === "unknown") missing.push("Fator R");
  if (!profile.deliveryChannel?.trim()) missing.push("entrega");
  return missing;
}
