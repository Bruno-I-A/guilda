/**
 * Encaminhamento por assunto dentro do clã (2026-11-20): a IA indica a pessoa
 * pela lista de assuntos (o roster do Scharff); aqui se decide quem recebe a
 * conversa e o aviso. Ordem: pessoa indicada → responsável da Carteira →
 * líder do clã → clã inteiro. Puro, sem banco.
 */
import type { AtendenteRoster, SetorValido } from "@/lib/support/triage/classificacao";

/** Entrada especial do roster: o responsável da empresa na Carteira. */
export const PORTFOLIO_ROSTER_ID = "carteira";

export type RoutingMember = { userId: string; name: string; isLeader: boolean };
export type RoutingChoice = { assigneeUserId: string | null; notifyUserIds: string[]; label: string | null };

export function chooseRecipient(input: {
  suggested: string | null;
  members: readonly RoutingMember[];
  portfolioOwnerId: string | null;
}): RoutingChoice {
  const member = (id: string | null) => (id ? input.members.find((m) => m.userId === id) : undefined);
  // Só recebe quem ainda é do clã: indicação ou responsável que saiu cai no líder.
  const person = input.suggested === PORTFOLIO_ROSTER_ID ? member(input.portfolioOwnerId) : member(input.suggested);
  if (person) return { assigneeUserId: person.userId, notifyUserIds: [person.userId], label: person.name };
  const leaders = input.members.filter((m) => m.isLeader);
  if (leaders.length === 1) {
    return { assigneeUserId: leaders[0].userId, notifyUserIds: [leaders[0].userId], label: leaders[0].name };
  }
  const notify = leaders.length > 1 ? leaders : input.members;
  return { assigneeUserId: null, notifyUserIds: notify.map((m) => m.userId), label: null };
}

/** Lista que vai ao prompt: só quem é do clã e tem assunto escrito, com o setor do clã. */
export function buildRoutingRoster(
  clans: readonly {
    sector: SetorValido | null;
    members: readonly RoutingMember[];
    rules: readonly { userId: string | null; topics: string }[];
  }[],
): AtendenteRoster[] {
  return clans.flatMap((clan) => {
    if (!clan.sector || clan.sector === "outro") return [];
    const setores = [clan.sector];
    return clan.rules.flatMap((rule): AtendenteRoster[] => {
      if (rule.userId === null) {
        return [{ id: PORTFOLIO_ROSTER_ID, primeiroNome: "Responsável da empresa (carteira)", setores, atribuicoes: rule.topics }];
      }
      const person = clan.members.find((m) => m.userId === rule.userId);
      return person
        ? [{ id: person.userId, primeiroNome: person.name.split(/\s+/)[0] || person.name, setores, atribuicoes: rule.topics }]
        : [];
    });
  });
}
