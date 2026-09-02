import "server-only";

import { auth } from "@/lib/auth";

/**
 * Criação de conta pelo caminho administrativo — o único que existe.
 *
 * O endpoint público `/api/auth/sign-up/email` está desligado
 * (`emailAndPassword.disableSignUp` em `auth.ts`): conta nesta Guilda nasce por
 * decisão de alguém que já está dentro, nunca por autocadastro. Este módulo é
 * esse caminho, e ele NÃO passa pelo endpoint — usa o `internalAdapter`, que
 * fica abaixo da camada de rotas e continua disponível.
 *
 * Três consumidores: a tela de Membros (admin cria colega), o script de
 * bootstrap (primeiro dono de uma instância nova) e o seed de demonstração.
 * Ter um lugar só evita que um deles volte a chamar o endpoint quando alguém
 * mexer sem lembrar da trava.
 */
export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  /**
   * `true` obriga a troca no primeiro acesso — é o certo quando quem define a
   * senha não é quem vai usá-la (admin criando colega). `false` quando a
   * própria pessoa escolheu a senha.
   */
  mustChangePassword: boolean;
}

export type CreateUserResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "email_taken" | "create_failed" };

export async function createUserWithPassword(
  input: CreateUserInput,
): Promise<CreateUserResult> {
  const email = input.email.trim().toLowerCase();
  const ctx = await auth.$context;

  const existing = await ctx.internalAdapter.findUserByEmail(email);
  if (existing) return { ok: false, reason: "email_taken" };

  const hash = await ctx.password.hash(input.password);

  let user: { id: string };
  try {
    user = await ctx.internalAdapter.createUser({
      email,
      name: input.name.trim(),
      emailVerified: false,
      mustChangePassword: input.mustChangePassword,
    });
  } catch {
    return { ok: false, reason: "create_failed" };
  }

  // Sem a conta de credencial a pessoa existe mas não consegue entrar.
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: hash,
  });

  return { ok: true, userId: user.id };
}
