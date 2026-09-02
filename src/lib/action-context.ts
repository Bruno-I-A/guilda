import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";

import { db } from "@/db";
import * as schema from "@/db/schema";
import type { OrgRole } from "@/domain/task-state";
import { auth } from "@/lib/auth";

/**
 * Base compartilhada das Server Actions: resultado padronizado e o
 * contexto obrigatório (sessão + organização ativa + papel do membro).
 */

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

export function err(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/** Sessão + organização ativa + papel — obrigatório em toda action. */
export async function requireMemberContext(): Promise<
  | { ok: true; userId: string; orgId: string; role: OrgRole }
  | { ok: false; error: string }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return err("Sessão expirada. Entre novamente.");
  }
  // A rotação obrigatória valia só para a navegação de páginas
  // (`requireOrgSession`), então quem entrava com senha temporária já operava
  // tudo por Server Action sem nunca passar por /change-password.
  if (session.user.mustChangePassword) {
    return err("Defina uma senha própria antes de continuar.");
  }
  const orgId = session.session.activeOrganizationId;
  if (!orgId) {
    return err("Nenhuma organização ativa.");
  }
  const membership = await db.query.member.findFirst({
    where: and(
      eq(schema.member.userId, session.user.id),
      eq(schema.member.organizationId, orgId),
    ),
  });
  if (!membership) {
    return err("Você não é membro desta organização.");
  }
  return {
    ok: true,
    userId: session.user.id,
    orgId,
    role: membership.role as OrgRole,
  };
}
