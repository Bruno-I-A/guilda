import type { OrgRole } from "./task-state";

/**
 * Permissões dos espaços de clã, dos informativos e do Mural.
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
  /** Integra ESTE clã e tanto o clã quanto o vínculo na organização estão ativos. */
  isActiveClanMember: boolean;
}

/** Operação diária do clã: integrante ativo do próprio clã ou admin/owner. */
export function canOperateClan(actor: ClanScopedFacts): boolean {
  return isAdminRole(actor.role) || actor.isActiveClanMember;
}

/**
 * Quem monta a composição dos clãs: SOMENTE admin/owner (decisão de
 * 2026-08-18, que revoga a Decisão 7 — o líder gerenciava os integrantes do
 * próprio clã). O motivo é de organograma, não de confiança: com o clã
 * virando o espaço de trabalho da pessoa, entrar e sair de clã passou a
 * definir o que ela vê, então a composição vive nas Configurações da Guilda.
 *
 * As operações diárias são colaborativas entre os integrantes do próprio clã.
 */
export function canManageClanMembership(
  actor: Pick<ClanScopedFacts, "role">,
): boolean {
  return isAdminRole(actor.role);
}

/**
 * O espaço Fiscal é colaborativo: qualquer integrante ativo pode cadastrar,
 * editar e remanejar empresas. Admin/owner mantém acesso de supervisão mesmo
 * sem integrar o clã.
 */
export function canManageFiscalPortfolio(actor: ClanScopedFacts): boolean {
  return canOperateClan(actor);
}

/**
 * Ficha Fiscal, importações, competências, parcelamentos e honorários seguem
 * a mesma régua colaborativa da carteira.
 */
export function canManageFiscalOperations(actor: ClanScopedFacts): boolean {
  return canManageFiscalPortfolio(actor);
}

/**
 * Todo integrante ativo pode atualizar qualquer controle do espaço Fiscal.
 * O snapshot de responsável continua registrado como histórico da competência,
 * mas não limita mais quem pode executar a rotina.
 */
export function canUpdateFiscalControl(
  actor: ClanScopedFacts,
): boolean {
  return canManageFiscalOperations(actor);
}

export function canAppointClanLeader(
  actor: Pick<ClanScopedFacts, "role">,
): boolean {
  return isAdminRole(actor.role);
}

export interface ClosingActorFacts extends ClanScopedFacts {
  /** A pessoa continua como integrante ativa do clã Contabilidade. */
  isActiveClanMember: boolean;
}

/**
 * Excluir um fechamento apaga o registro contábil sem deixar rastro —
 * diferente de reabrir o ano, que preserva o histórico. Fica com quem
 * responde pelo clã.
 */
export function canDeleteClanClosing(actor: ClosingActorFacts): boolean {
  return isAdminRole(actor.role) || actor.leadsThisClan;
}

/**
 * Registrar período, fechar o ano, marcar a DEFIS e anotar observações é o
 * trabalho DIÁRIO da Contabilidade, e quem faz é quem recebe o XP — por isso
 * a régua alcança o integrante comum do clã, não só a liderança. Prender o
 * fechamento no líder tiraria da equipe justamente a tarefa que a remunera.
 * Mesmo espírito de `canUpdateFiscalControl`.
 */
export function canManageClanClosings(actor: ClosingActorFacts): boolean {
  return canDeleteClanClosing(actor) || actor.isActiveClanMember;
}

/** Qualquer integrante ativo distribui as missões do próprio clã. */
export function canDistributeClanTasks(actor: ClanScopedFacts): boolean {
  return canOperateClan(actor);
}

export interface QuickCompleteClanTaskFacts extends ClanScopedFacts {
  /** Atalho reservado às rotinas simples do Sucesso do Cliente. */
  isCustomerSuccessClan: boolean;
}

/**
 * Conclusão de uma missão simples ainda sem dono: exige vínculo ativo com o
 * Sucesso do Cliente para registrar quem executou.
 */
export function canQuickCompleteUnassignedInformativeTask(
  actor: QuickCompleteClanTaskFacts,
): boolean {
  return (
    actor.isCustomerSuccessClan &&
    actor.isActiveClanMember &&
    canDistributeClanTasks(actor)
  );
}

/**
 * Distribuição de lucros da empresa é operação diária compartilhada entre os
 * integrantes ativos da Contabilidade.
 */
export function canManageClanCommitments(actor: ClanScopedFacts): boolean {
  return canOperateClan(actor);
}

export interface CompanyFlowActorFacts extends ClanScopedFacts {
  /** A pessoa ainda participa ativamente do clã Societário. */
  isActiveCorporateMember: boolean;
  /** Responsável societário atual do Fluxo. */
  isAssignedToFlow: boolean;
}

/** O dono/admin abre a solicitação que chegou do cliente. */
export function canCreateCompanyFlow(actor: Pick<CompanyFlowActorFacts, "role">): boolean {
  return isAdminRole(actor.role);
}

/** Owner/admin supervisiona sem precisar entrar no clã; equipe societária trabalha nele. */
export function canViewCompanyFlow(actor: CompanyFlowActorFacts): boolean {
  return isAdminRole(actor.role) || actor.isActiveCorporateMember;
}

/** Qualquer integrante do Societário pode assumir uma demanda ainda na fila. */
export function canClaimCompanyFlow(actor: CompanyFlowActorFacts): boolean {
  return isAdminRole(actor.role) || actor.isActiveCorporateMember;
}

/** Qualquer integrante ativo do Societário pode devolver o resultado. */
export function canReturnCompanyFlow(actor: CompanyFlowActorFacts): boolean {
  return isAdminRole(actor.role) || actor.isActiveCorporateMember;
}

export interface CompanyFlowInformativeFacts
  extends Pick<CompanyFlowActorFacts, "role"> {
  /** É a pessoa designada no clã como responsável por redigir Informativos. */
  holdsInformativeDuty: boolean;
}

/**
 * A ponte para Informativos era decisão exclusiva de dono/admin. Com a
 * atribuição nominal, quem foi designado para redigir também abre a prévia —
 * senão a missão que ele recebe seria impossível de executar por quem a recebeu.
 */
export function canPrepareCompanyFlowInformative(
  actor: CompanyFlowInformativeFacts,
): boolean {
  return isAdminRole(actor.role) || actor.holdsInformativeDuty;
}
