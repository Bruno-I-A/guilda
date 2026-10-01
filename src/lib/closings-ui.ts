import type { AccountingClosing, Client } from "@/db/schema";

export type ClosingStatus = AccountingClosing["status"];
export type ClosingGroup = "mei" | "simples" | "presumido_association" | "real";

export const CLOSING_STATUSES = ["pending", "blocked", "completed"] as const;

export const CLOSING_STATUS_LABELS: Record<ClosingStatus, string> = {
  pending: "Pendente",
  blocked: "Com pendência",
  completed: "Concluído",
};

export const CLOSING_STATUS_BADGE_CLASSES: Record<ClosingStatus, string> = {
  pending: "border-primary/25 bg-primary/10 text-primary",
  blocked: "border-destructive/30 bg-destructive/10 text-destructive",
  completed: "border-success/25 bg-success/10 text-success",
};

export const CLOSING_GROUPS: {
  key: ClosingGroup;
  label: string;
  shortLabel: string;
}[] = [
  { key: "mei", label: "MEI", shortLabel: "MEI" },
  { key: "simples", label: "Simples Nacional", shortLabel: "Simples" },
  {
    key: "presumido_association",
    label: "Presumido / Associação",
    shortLabel: "Presumido / Assoc.",
  },
  { key: "real", label: "Lucro Real", shortLabel: "Real" },
];

type TaxRegime = Client["taxRegime"];

/** Regimes cadastrais que cada grupo da aba Fechamentos reúne. */
export const CLOSING_GROUP_REGIMES: Record<ClosingGroup, readonly TaxRegime[]> = {
  mei: ["mei"],
  simples: ["simples"],
  presumido_association: ["presumido", "association"],
  real: ["real"],
};

/** O grupo da aba onde uma empresa deste regime aparece. */
export function closingGroupForRegime(taxRegime: TaxRegime): ClosingGroup {
  const entry = (
    Object.entries(CLOSING_GROUP_REGIMES) as [ClosingGroup, readonly TaxRegime[]][]
  ).find(([, regimes]) => regimes.includes(taxRegime));
  return entry?.[0] ?? "simples";
}

export function isClosingOverdue(
  dueDate: string,
  status: ClosingStatus,
  today: string,
): boolean {
  return status !== "completed" && dueDate < today;
}
