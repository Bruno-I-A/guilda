import type { AccountingClosing, Client } from "@/db/schema";

export type ClosingCadence = Client["closingCadence"];
export type ClosingPeriod = AccountingClosing["period"];
export type ClosingGroup = "simples" | "presumido_association" | "real";

export const CLOSING_CADENCES = ["quarterly", "annual"] as const;
export const CLOSING_PERIODS = ["q1", "q2", "q3", "q4", "annual"] as const;
export const QUARTERLY_PERIODS = ["q1", "q2", "q3", "q4"] as const;

export const CLOSING_CADENCE_LABELS: Record<ClosingCadence, string> = {
  quarterly: "Trimestral",
  annual: "Anual",
};

export const CLOSING_PERIOD_LABELS: Record<ClosingPeriod, string> = {
  q1: "1º tri",
  q2: "2º tri",
  q3: "3º tri",
  q4: "4º tri",
  annual: "Fechamento anual",
};

export const CLOSING_GROUPS: {
  key: ClosingGroup;
  label: string;
  shortLabel: string;
}[] = [
  { key: "simples", label: "Simples Nacional", shortLabel: "Simples" },
  {
    key: "presumido_association",
    label: "Presumido / Associação",
    shortLabel: "Presumido / Assoc.",
  },
  { key: "real", label: "Lucro Real", shortLabel: "Real" },
];

export function periodsForCadence(
  cadence: ClosingCadence,
): readonly ClosingPeriod[] {
  return cadence === "annual" ? ["annual"] : QUARTERLY_PERIODS;
}
