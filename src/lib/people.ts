/** Utilidades compartilhadas entre Server e Client Components. */

export const ROLE_LABELS: Record<string, string> = {
  owner: "Dono(a)",
  admin: "Admin",
  member: "Membro",
};

export function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}
