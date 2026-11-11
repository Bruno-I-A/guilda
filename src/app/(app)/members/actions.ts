"use server";

import { randomInt } from "node:crypto";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import {
  authorizePasswordReset,
  generateTemporaryPassword,
} from "@/domain/password-reset";
import type { OrgRole } from "@/domain/task-state";
import { auth } from "@/lib/auth";
import { createUserWithPassword } from "@/lib/auth-admin";
import { withAuthEmailLock } from "@/lib/auth-orphan";
import { err, requireMemberContext } from "@/lib/action-context";
import type { ActionResult } from "@/lib/action-context";

/**
 * Cadastro direto de membro com senha temporária (substitui o convite por
 * link — decisão de 2026-07-06). Só admin/owner.
 *
 * NÃO usar `auth.api.signUpEmail` aqui: ela sempre cria sessão e seta
 * cookie (ver node_modules/better-auth/dist/api/routes/sign-up.mjs), o que
 * trocaria a sessão de quem está chamando esta action pela da pessoa
 * recém-criada. Em vez disso, replica-se a sequência de baixo nível que a
 * própria signUpEmail usa ANTES de criar sessão (hash + createUser +
 * linkAccount), e usa-se `addMember` — endpoint serverOnly do plugin de
 * organization feito exatamente para "admin adiciona alguém já existente à
 * org", sem convite.
 */

const createMemberSchema = z.object({
  name: z.string().trim().min(2, "Nome muito curto.").max(120, "Nome muito longo."),
  email: z.email("Informe um e-mail válido."),
  role: z.enum(["member", "admin"]),
  tempPassword: z.string().min(8, "A senha precisa ter pelo menos 8 caracteres."),
});

export async function createMemberWithTempPassword(
  input: z.input<typeof createMemberSchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  if (ctx.role !== "admin" && ctx.role !== "owner") {
    return err("Apenas admin ou owner pode adicionar membros.");
  }

  const parsed = createMemberSchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }
  const data = parsed.data;
  const email = data.email.toLowerCase();

  const result = await withAuthEmailLock(email, async (): Promise<ActionResult> => {
    const criado = await createUserWithPassword({
      name: data.name,
      email,
      password: data.tempPassword,
      // Quem escolheu a senha foi o admin, não a pessoa: trocar é obrigatório.
      mustChangePassword: true,
    });
    if (!criado.ok) {
      return err(
        criado.reason === "email_taken"
          ? "Já existe uma conta ativa com este e-mail."
          : "Não foi possível criar o usuário.",
      );
    }

    try {
      await auth.api.addMember({
        body: {
          userId: criado.userId,
          organizationId: ctx.orgId,
          role: data.role,
        },
      });
    } catch {
      // Sem member e sem histórico, a conta recém-criada pode ser removida por
      // inteiro. Assim uma falha parcial não reserva o e-mail para a tentativa
      // seguinte.
      const authContext = await auth.$context;
      await authContext.internalAdapter
        .deleteUser(criado.userId)
        .catch(() => undefined);
      return err("Não foi possível adicionar o usuário à organização.");
    }

    return { ok: true };
  });

  if (!result.ok) return result;

  revalidatePath("/members");
  return result;
}

const resetPasswordSchema = z.object({ memberId: z.string().min(1).max(100) });

/**
 * Recuperação de senha esquecida (decisão de 2026-11-11): não há e-mail, então
 * o admin gera uma senha temporária e a repassa. A antiga deixa de valer, a
 * pessoa sai de todos os aparelhos e, ao entrar com a temporária, é obrigada a
 * escolher outra — o mesmo caminho do cadastro direto.
 *
 * A senha nasce no servidor (`crypto.randomInt`) e volta só nesta resposta:
 * não é gravada em claro nem registrada. A trilha `password_resets` guarda
 * quem redefiniu a de quem, e quando. A régua de quem pode está em
 * `authorizePasswordReset`.
 */
export async function resetMemberPassword(
  input: z.input<typeof resetPasswordSchema>,
): Promise<ActionResult<{ email: string; password: string }>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) return err("Integrante inválido.");

  // `member` e `user` são tabelas do better-auth, sem RLS: o filtro por
  // organização é explícito em cada consulta.
  const [target] = await db
    .select({
      userId: schema.member.userId,
      role: schema.member.role,
      email: schema.user.email,
    })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(
      and(
        eq(schema.member.id, parsed.data.memberId),
        eq(schema.member.organizationId, ctx.orgId),
      ),
    );
  if (!target) return err("Integrante não encontrado.");

  const [elsewhere] = await db
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.userId, target.userId),
        ne(schema.member.organizationId, ctx.orgId),
      ),
    )
    .limit(1);

  const decision = authorizePasswordReset({
    actorRole: ctx.role,
    targetRole: target.role as OrgRole,
    isSelf: target.userId === ctx.userId,
    targetInOtherOrganization: Boolean(elsewhere),
  });
  if (!decision.allowed) return err(decision.reason);

  const authContext = await auth.$context;
  const accounts = await authContext.internalAdapter.findAccounts(target.userId);
  if (!accounts.some((account) => account.providerId === "credential")) {
    return err("Esta conta não entra por senha.");
  }

  const password = generateTemporaryPassword((n) => randomInt(n));
  try {
    await authContext.internalAdapter.updatePassword(
      target.userId,
      await authContext.password.hash(password),
    );
    // Quem estava logado com a senha antiga (ou quem a descobriu) sai agora.
    await authContext.internalAdapter.deleteUserSessions(target.userId);
    await withOrgTx(ctx.orgId, async (tx) => {
      await tx
        .update(schema.user)
        .set({ mustChangePassword: true, updatedAt: new Date() })
        .where(eq(schema.user.id, target.userId));
      await tx.insert(schema.passwordResets).values({
        orgId: ctx.orgId,
        userId: target.userId,
        resetBy: ctx.userId,
      });
    });
  } catch (error) {
    console.error("Falha ao redefinir a senha", error);
    return err("Não foi possível redefinir a senha agora. Tente de novo.");
  }

  revalidatePath("/members");
  return { ok: true, data: { email: target.email, password } };
}
