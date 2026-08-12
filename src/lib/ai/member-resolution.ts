export type ResolvedMember = Readonly<{ userId: string; name: string }>;

function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Resolve apenas correspondências inequívocas; nomes ambíguos exigem nova prévia. */
export function resolveMemberName(
  requestedName: string,
  members: ResolvedMember[],
): ResolvedMember | null {
  const requested = normalizeName(requestedName);
  if (!requested) return null;

  const exact = members.filter((member) => normalizeName(member.name) === requested);
  if (exact.length === 1) return exact[0];

  const byToken = members.filter((member) => {
    const normalized = normalizeName(member.name);
    const tokens = normalized.split(" ");
    return tokens.includes(requested) || normalized.startsWith(`${requested} `);
  });
  return byToken.length === 1 ? byToken[0] : null;
}
