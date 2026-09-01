export const MEI_DECLARATION_STATUSES = [
  "pending",
  "in_progress",
  "submitted",
] as const;

export type MeiDeclarationStatus =
  (typeof MEI_DECLARATION_STATUSES)[number];

export const MEI_DECLARATION_STATUS_LABELS: Record<
  MeiDeclarationStatus,
  string
> = {
  pending: "Pendente",
  in_progress: "Em andamento",
  submitted: "Entregue",
};

export function parseMeiDeclarationYear(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100
    ? parsed
    : fallback;
}
