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
 * Quem monta a composição dos clãs: SOMENTE admin/owner (decisão de
 * 2026-08-18, que revoga a Decisão 7 — o líder gerenciava os integrantes do
 * próprio clã). O motivo é de organograma, não de confiança: com o clã
 * virando o espaço de trabalho da pessoa, entrar e sair de clã passou a
 * definir o que ela vê, então a composição vive nas Configurações da Guilda.
 *
 * O líder continua dono do dia a dia: distribui missões
 * (`canDistributeClanTasks`) e remaneja a carteira
 * (`canManageFiscalPortfolio`).
 */
export function canManageClanMembership(actor: ClanScopedFacts): boolean {
  return isAdminRole(actor.role);
}

/**
 * Remanejar empresa entre pessoas da carteira fiscal é trabalho do dia a dia
 * do líder — mesma régua da Mesa do Líder. Membro comum enxerga a carteira
 * inteira do clã (transparência de quem responde pelo quê) mas não move nada.
 */
export function canManageFiscalPortfolio(actor: ClanScopedFacts): boolean {
  return isAdminRole(actor.role) || actor.leadsThisClan;
}

/**
 * A Ficha Fiscal, a importação e a abertura de competências alteram a
 * configuração do trabalho de toda a equipe. Seguem, portanto, a mesma
 * régua da carteira: liderança do Fiscal ou admin/owner.
 */
export function canManageFiscalOperations(actor: ClanScopedFacts): boolean {
  return canManageFiscalPortfolio(actor);
}

export interface FiscalControlActorFacts extends ClanScopedFacts {
  /** A pessoa continua como integrante ativa do clã Fiscal. */
  isActiveClanMember: boolean;
  /** A competência guardou essa pessoa como responsável no seu snapshot. */
  ownsControlSnapshot: boolean;
}

/**
 * Líder/admin pode corrigir qualquer controle. Integrante comum atualiza
 * somente as empresas que ficaram sob sua responsabilidade quando a
 * competência foi aberta; remanejamentos futuros não reescrevem o histórico.
 */
export function canUpdateFiscalControl(
  actor: FiscalControlActorFacts,
): boolean {
  return (
    canManageFiscalOperations(actor) ||
    (actor.isActiveClanMember && actor.ownsControlSnapshot)
  );
}

export function canAppointClanLeader(actor: ClanScopedFacts): boolean {
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

/** A Mesa distribui as missões do clã: líder do clã ou admin/owner. */
export function canDistributeClanTasks(actor: ClanScopedFacts): boolean {
  return isAdminRole(actor.role) || actor.leadsThisClan;
}

export interface QuickCompleteClanTaskFacts extends ClanScopedFacts {
  /** Quem confirma recebe o registro e o XP, então precisa integrar o clã. */
  isActiveClanMember: boolean;
  /** Atalho reservado às rotinas simples do Sucesso do Cliente. */
  isCustomerSuccessClan: boolean;
}

/**
 * Conclusão de uma missão simples ainda sem dono: mantém a régua da Mesa do
 * Líder, mas exige que quem clicou possa ser registrado como executor.
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
 * Distribuição de lucros da empresa (planejar, registrar valor e gerar a
 * missão do período): mesma régua do dia a dia do líder da Contabilidade.
 */
export function canManageClanCommitments(actor: ClanScopedFacts): boolean {
  return isAdminRole(actor.role) || actor.leadsThisClan;
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

/** Só quem assumiu, liderança do Societário ou owner/admin pode devolver o resultado. */
export function canReturnCompanyFlow(actor: CompanyFlowActorFacts): boolean {
  return (
    isAdminRole(actor.role) ||
    (actor.isActiveCorporateMember && (actor.isAssignedToFlow || actor.leadsThisClan))
  );
}

/** A ponte para Informativos continua sendo uma decisão do dono/admin. */
export function canPrepareCompanyFlowInformative(
  actor: Pick<CompanyFlowActorFacts, "role">,
): boolean {
  return isAdminRole(actor.role);
}
