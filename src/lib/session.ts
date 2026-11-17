import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { auth } from "@/lib/auth";

/**
 * Sessão da requisição atual (cacheada por render).
 * Fonte da verdade: better-auth valida o token no banco — o proxy.ts faz
 * apenas a checagem otimista do cookie; aqui é a verificação real.
 */
export const getSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});

/** Exige usuário autenticado (páginas). */
export async function requireSession() {
  const session = await getSession();
  if (!session) {
    redirect("/sign-in");
  }
  return session;
}

/**
 * Exige usuário autenticado COM organização ativa.
 * Quem não tem org (ex.: cadastro interrompido) cai no onboarding.
 */
export async function requireOrgSession() {
  const session = await requireSession();
  if (session.user.mustChangePassword) {
    redirect("/change-password");
  }
  const orgId = session.session.activeOrganizationId;
  if (!orgId) {
    redirect("/onboarding");
  }
  // O vínculo é conferido AQUI, e não só no layout (app): na navegação pelo
  // app o Next renderiza apenas a página que mudou, e o layout não roda de
  // novo. Sem isto, quem foi removido e ainda tinha sessão continuava lendo
  // as páginas que não perguntam o papel (/tasks, /leaderboard...).
  // Revisão de segurança de 2026-11-16, medida no `next start`.
  const member = await getActiveMember();
  if (!member) {
    redirect("/onboarding");
  }
  return { ...session, orgId };
}

/**
 * Papel do usuário na organização ativa (member/admin/owner),
 * verificado no servidor — nunca confiar no que a UI diz.
 */
export const getActiveMember = cache(async () => {
  try {
    return await auth.api.getActiveMember({ headers: await headers() });
  } catch {
    return null;
  }
});

export function isAdminRole(role: string | undefined | null) {
  return role === "admin" || role === "owner";
}
