import type { TransitionDecision } from "./task-state";

/**
 * Autorização de mudança na carteira fiscal, depois que a Server Action já
 * carregou os fatos do banco. Função pura — nada aqui aceita valor vindo da
 * interface, e a action continua responsável pelos locks e por provar que
 * cliente e pessoa pertencem à organização da sessão.
 */

export interface PortfolioChangeFacts {
  /** A empresa segue ativa? Empresa inativa não entra em carteira nova. */
  clientIsActive: boolean;
  /** Quem responde pela empresa hoje; null = está sem responsável. */
  currentHolderId: string | null;
  /**
   * Destino da empresa. `null` significa tirar da carteira sem repassar —
   * a empresa volta para a fila de "sem responsável".
   */
  target: { userId: string; isActiveClanMember: boolean } | null;
}

const ALLOW: TransitionDecision = { allowed: true };

function deny(reason: string): TransitionDecision {
  return { allowed: false, reason };
}

export function authorizePortfolioChange(
  facts: PortfolioChangeFacts,
): TransitionDecision {
  const { target, currentHolderId, clientIsActive } = facts;

  if (!target) {
    return currentHolderId
      ? ALLOW
      : deny("Esta empresa já está sem responsável.");
  }
  if (target.userId === currentHolderId) {
    return deny("Esta empresa já está na carteira dessa pessoa.");
  }
  if (!target.isActiveClanMember) {
    return deny(
      "A carteira só pode ficar com quem é integrante ativo do clã Fiscal.",
    );
  }
  // Empresa inativa pode SAIR da carteira (limpeza), mas não entrar: seria
  // criar responsabilidade por um trabalho que não existe mais.
  if (!clientIsActive) {
    return deny("Empresa inativa não entra em carteira. Reative-a primeiro.");
  }
  return ALLOW;
}

/** Divide a carteira do clã em blocos por pessoa, com os órfãos à parte. */
export interface PortfolioClientRow {
  clientId: string;
  clientName: string;
  holderId: string | null;
}

export interface PortfolioBucket {
  userId: string;
  name: string;
  clients: PortfolioClientRow[];
}

export interface PortfolioSummary {
  buckets: PortfolioBucket[];
  orphans: PortfolioClientRow[];
  /** Média de empresas por integrante — a régua para ver desequilíbrio. */
  averagePerMember: number;
}

/**
 * Agrupa a carteira. Inclui integrante com carteira VAZIA no resultado: a
 * pessoa sem empresa nenhuma é justamente quem o líder precisa ver ao
 * distribuir.
 */
export function summarizePortfolio(
  members: readonly { userId: string; name: string }[],
  rows: readonly PortfolioClientRow[],
): PortfolioSummary {
  const buckets = members.map((member) => ({
    userId: member.userId,
    name: member.name,
    clients: rows
      .filter((row) => row.holderId === member.userId)
      .sort((left, right) =>
        left.clientName.localeCompare(right.clientName, "pt-BR"),
      ),
  }));
  const orphans = rows
    .filter((row) => !row.holderId)
    .sort((left, right) =>
      left.clientName.localeCompare(right.clientName, "pt-BR"),
    );
  const assigned = rows.length - orphans.length;

  return {
    buckets,
    orphans,
    averagePerMember: members.length > 0 ? assigned / members.length : 0,
  };
}
