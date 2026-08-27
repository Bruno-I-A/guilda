import type { AccountingClosing } from "@/db/schema";

export type ClosingStatus = AccountingClosing["status"];
export type ClosingGroup = "simples" | "presumido_association" | "real";

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
  { key: "simples", label: "Simples Nacional", shortLabel: "Simples" },
  {
    key: "presumido_association",
    label: "Presumido / Associação",
    shortLabel: "Presumido / Assoc.",
  },
  { key: "real", label: "Lucro Real", shortLabel: "Real" },
];

export function isClosingOverdue(
  dueDate: string,
  status: ClosingStatus,
  today: string,
): boolean {
  return status !== "completed" && dueDate < today;
}
