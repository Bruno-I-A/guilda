export const CUSTOMER_SUCCESS_CLAN_SLUG = "sucesso-do-cliente";
export const RH_CLAN_SLUG = "rh";

export const DEFAULT_ORGANIZATION_CLANS = [
  { name: "Fiscal", slug: "fiscal" },
  { name: "Contabilidade", slug: "contabilidade" },
  { name: "RH", slug: RH_CLAN_SLUG },
  { name: "Societário", slug: "societario" },
  { name: "Financeiro", slug: "financeiro" },
  { name: "Sucesso do Cliente", slug: CUSTOMER_SUCCESS_CLAN_SLUG },
] as const;

export const DEFAULT_PRIMARY_CLAN_SLUG = "contabilidade";

/** O clã que trabalha por carteira de empresas (ver src/lib/clan-tabs.ts). */
export const FISCAL_CLAN_SLUG = "fiscal";

/** O clã que trabalha por fechamento anual das empresas. */
export const CONTABILIDADE_CLAN_SLUG = "contabilidade";

/** O dono encaminha ao Societário e recebe o retorno por esta área. */
export const SOCIETARIO_CLAN_SLUG = "societario";

export const ACTIVE_ASSIGNED_TASK_STATUSES = [
  "pending",
  "in_progress",
  "awaiting_approval",
  "rejected",
] as const;

export interface DefaultClanRow {
  id: string;
  slug: string;
}

export function buildDefaultLeaderMemberships(
  orgId: string,
  creatorUserId: string,
  clans: readonly DefaultClanRow[],
) {
  return clans.map((clan) => ({
    orgId,
    clanId: clan.id,
    userId: creatorUserId,
    isLeader: true as const,
    isPrimary: clan.slug === DEFAULT_PRIMARY_CLAN_SLUG,
  }));
}

export interface MemberRemovalFacts {
  activeAssignedTaskCount: number;
  soleLeaderClanNames: readonly string[];
}

/** Better Auth pode armazenar mais de um papel separado por vírgulas. */
export function organizationRoleIncludesOwner(role: string): boolean {
  return role
    .split(",")
    .map((candidate) => candidate.trim())
    .includes("owner");
}

/**
 * Produz uma mensagem acionável sem depender de banco ou do Better Auth.
 * `null` significa que os invariantes de remoção foram satisfeitos.
 */
export function memberRemovalBlockReason({
  activeAssignedTaskCount,
  soleLeaderClanNames,
}: MemberRemovalFacts): string | null {
  const reasons: string[] = [];

  if (activeAssignedTaskCount > 0) {
    const noun = activeAssignedTaskCount === 1 ? "missão ativa" : "missões ativas";
    reasons.push(
      `transfira ${activeAssignedTaskCount} ${noun} atribuída${activeAssignedTaskCount === 1 ? "" : "s"} a esta pessoa`,
    );
  }

  if (soleLeaderClanNames.length > 0) {
    const clans = [...soleLeaderClanNames].sort((a, b) =>
      a.localeCompare(b, "pt-BR"),
    );
    reasons.push(
      `defina outro líder para ${clans.length === 1 ? "o clã" : "os clãs"} ${clans.join(", ")}`,
    );
  }

  if (reasons.length === 0) return null;
  return `Não é possível remover este membro: ${reasons.join(" e ")}.`;
}
