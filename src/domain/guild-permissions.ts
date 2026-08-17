import type { OrgRole } from "./task-state";

/**
 * Permissões da Mesa do Líder, dos informativos e do Mural.
 *
 * São funções puras: a Server Action carrega os fatos do banco (papel na
 * organização, liderança de clã ativo, autoria do aviso) e chama estas
 * funções. Nada aqui aceita valor vindo da interface.
 */

export function isAdminRole(role: OrgRole): boolean {
  return role === "admin" || role === "owner";
}

export interface GuildActorFacts {
  role: OrgRole;
  /** Lidera ao menos um clã ATIVO da organização. */
  leadsAnyClan: boolean;
}

/**
 * Decisão 9: líderes também recebem e confirmam informativo, nas duas portas
 * de entrada. Não faz sentido o líder distribuir o trabalho mas depender de
 * um admin para o informativo entrar.
 */
export function canHandleInformatives(actor: GuildActorFacts): boolean {
  return isAdminRole(actor.role) || actor.leadsAnyClan;
}

/** Qualquer membro pode publicar um aviso no mural. */
export function canPublishNotice(): boolean {
  return true;
}

/**
 * Fixar ou exigir confirmação obriga a Guilda inteira a dar ciência —
 * por isso é restrito a líder e admin/owner.
 */
export function canEmphasizeNotice(actor: GuildActorFacts): boolean {
  return isAdminRole(actor.role) || actor.leadsAnyClan;
}

export interface NoticeAudienceFacts extends GuildActorFacts {
  isAuthor: boolean;
}

/** Quem publicou, líderes e admin/owner veem quem ainda não confirmou. */
export function canSeeNoticeAcknowledgements(
  actor: NoticeAudienceFacts,
): boolean {
  return actor.isAuthor || isAdminRole(actor.role) || actor.leadsAnyClan;
}

export interface ClanScopedFacts {
  role: OrgRole;
  /** Lidera ESTE clã, e o clã está ativo. */
  leadsThisClan: boolean;
}

/**
 * Decisão 7: o líder passa a gerenciar os integrantes do próprio clã.
 * Nomear/destituir líder continua exclusivo de admin/owner (ver
 * `canAppointClanLeader`).
 */
export function canManageClanMembership(actor: ClanScopedFacts): boolean {
  return isAdminRole(actor.role) || actor.leadsThisClan;
}

export function canAppointClanLeader(actor: ClanScopedFacts): boolean {
  return isAdminRole(actor.role);
}

/** A Mesa distribui as missões do clã: líder do clã ou admin/owner. */
export function canDistributeClanTasks(actor: ClanScopedFacts): boolean {
  return isAdminRole(actor.role) || actor.leadsThisClan;
}
