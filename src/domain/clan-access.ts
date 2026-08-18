import { isAdminRole } from "./guild-permissions";
import type { OrgRole } from "./task-state";

/**
 * Quem vê qual clã (decisão de 2026-08-18).
 *
 * O clã deixou de ser um diretório da Guilda e passou a ser o espaço de
 * trabalho da pessoa: quem é do Fiscal abre o Fiscal e encontra as missões, a
 * carteira e as campanhas do Fiscal. Ver os outros clãs não é privilégio
 * negado por desconfiança — é ruído que empurra para baixo a única coisa que
 * importa na tela ("o que é meu, o que está atrasado").
 *
 * Admin/owner continuam vendo tudo, porque a supervisão é o trabalho deles.
 *
 * Funções puras: a página carrega os vínculos do banco e chama daqui.
 */

export interface ClanViewerFacts {
  role: OrgRole;
  /** IDs dos clãs em que a pessoa tem vínculo, ativos ou não. */
  memberClanIds: readonly string[];
}

/** Um clã específico está visível para esta pessoa? */
export function canViewClan(viewer: ClanViewerFacts, clanId: string): boolean {
  return isAdminRole(viewer.role) || viewer.memberClanIds.includes(clanId);
}

/** Filtra uma lista de clãs para o que a pessoa pode ver. */
export function filterVisibleClans<T extends { id: string }>(
  viewer: ClanViewerFacts,
  clans: readonly T[],
): T[] {
  if (isAdminRole(viewer.role)) return [...clans];
  return clans.filter((clan) => viewer.memberClanIds.includes(clan.id));
}

/**
 * Para onde a aba "Clãs" leva.
 *
 * `single` existe para o caso mais comum do escritório — a pessoa pertence a
 * um clã só — em que uma listagem de um item é pura fricção: a aba abre
 * direto no clã dela.
 */
export type ClanEntry =
  | { outcome: "clan"; clanId: string }
  | { outcome: "list" }
  | { outcome: "none" };

export function resolveClanEntry(viewer: ClanViewerFacts): ClanEntry {
  // Admin/owner sempre veem a listagem: precisam comparar clãs, não entrar
  // em um. Mesmo com vínculo em um único clã.
  if (isAdminRole(viewer.role)) return { outcome: "list" };

  const unique = [...new Set(viewer.memberClanIds)];
  if (unique.length === 0) return { outcome: "none" };
  if (unique.length === 1) return { outcome: "clan", clanId: unique[0] };
  return { outcome: "list" };
}
