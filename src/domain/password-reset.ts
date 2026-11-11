/**
 * Quem pode redefinir a senha de quem (funções puras).
 *
 * Recuperação de senha na Guilda é administrativa: não há e-mail, então quem
 * esqueceu pede a um admin, que gera uma senha temporária e a repassa. A
 * pessoa entra com ela e é obrigada a escolher outra (`mustChangePassword`),
 * o mesmo caminho do cadastro direto de integrante.
 *
 * Redefinir a senha de alguém é poder entrar como essa pessoa, então a régua é
 * estreita:
 * - só para baixo na hierarquia: o owner redefine admin e membro; o admin,
 *   só membro. Admin redefinindo admin poderia agir em nome de um par;
 * - nunca a própria senha (para isso existe "Alterar senha", que pede a atual);
 * - nunca de quem também participa de outra organização: a conta é uma só
 *   para todas, e a senha nova abriria a porta de um escritório alheio.
 */

import type { OrgRole } from "./task-state";

const RANK: Record<OrgRole, number> = { owner: 0, admin: 1, member: 2 };

export interface PasswordResetFacts {
  actorRole: OrgRole;
  targetRole: OrgRole;
  isSelf: boolean;
  /** A pessoa também é integrante de alguma outra organização. */
  targetInOtherOrganization: boolean;
}

export type PasswordResetDecision = { allowed: true } | { allowed: false; reason: string };

export function authorizePasswordReset(facts: PasswordResetFacts): PasswordResetDecision {
  if (facts.isSelf) {
    return { allowed: false, reason: "Para trocar a sua própria senha, use Alterar senha." };
  }
  if (facts.actorRole !== "owner" && facts.actorRole !== "admin") {
    return { allowed: false, reason: "Apenas admin ou owner pode redefinir senhas." };
  }
  if (RANK[facts.targetRole] <= RANK[facts.actorRole]) {
    return {
      allowed: false,
      reason:
        facts.actorRole === "admin"
          ? "Admin só redefine a senha de membros. Peça ao owner."
          : "A senha do owner não pode ser redefinida por aqui.",
    };
  }
  if (facts.targetInOtherOrganization) {
    return {
      allowed: false,
      reason:
        "Esta pessoa também participa de outra organização; a senha dela vale lá também e não pode ser redefinida daqui.",
    };
  }
  return { allowed: true };
}

/** Sem 0/O, 1/l/I: a senha é ditada ou copiada por mensagem. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

/**
 * Senha temporária legível. `randomIndex` devolve um inteiro em [0, n) — o
 * servidor passa `crypto.randomInt`; o teste passa uma sequência fixa.
 */
export function generateTemporaryPassword(
  randomIndex: (n: number) => number,
  length = 10,
): string {
  let out = "";
  for (let i = 0; i < length; i += 1) out += ALPHABET[randomIndex(ALPHABET.length)];
  return out;
}
