import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db";
import {
  releaseOrphanedUserEmailInDb,
  retireUserIfOrphanedInDb,
} from "@/lib/auth-orphan-db";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Libera o e-mail de uma conta sem nenhuma organização, preservando o usuário
 * antigo para que missões, XP e auditoria continuem apontando para a pessoa
 * correta. Contas ainda vinculadas a qualquer organização nunca são alteradas.
 */
export function releaseOrphanedUserEmail(email: string): Promise<boolean> {
  return releaseOrphanedUserEmailInDb(db, email);
}

/** Desativa credenciais quando a pessoa perde seu último vínculo organizacional. */
export function retireUserIfOrphaned(userId: string): Promise<boolean> {
  return retireUserIfOrphanedInDb(db, userId);
}

/**
 * Serializa cadastros administrativos do mesmo e-mail. O Better Auth cria o
 * usuário e o member em operações separadas; sem este mutex, duas requisições
 * poderiam interpretar a conta recém-criada pela outra como uma conta órfã.
 */
export async function withAuthEmailLock<T>(
  email: string,
  work: () => Promise<T>,
): Promise<T> {
  const normalized = normalizeEmail(email);
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${normalized}, 0))`,
    );
    return work();
  });
}
