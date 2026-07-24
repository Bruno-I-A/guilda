"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
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

  const authCtx = await auth.$context;

  const existing = await authCtx.internalAdapter.findUserByEmail(email);
  if (existing) {
    return err("Já existe uma conta com este e-mail.");
  }

  const hash = await authCtx.password.hash(data.tempPassword);
  let newUser: { id: string };
  try {
    newUser = await authCtx.internalAdapter.createUser({
      email,
      name: data.name,
      emailVerified: false,
      mustChangePassword: true,
    });
  } catch {
    return err("Não foi possível criar o usuário.");
  }

  await authCtx.internalAdapter.linkAccount({
    userId: newUser.id,
    providerId: "credential",
    accountId: newUser.id,
    password: hash,
  });

  try {
    await auth.api.addMember({
      body: { userId: newUser.id, organizationId: ctx.orgId, role: data.role },
    });
  } catch {
    return err("Usuário criado, mas não foi possível adicioná-lo à organização.");
  }

  revalidatePath("/members");
  return { ok: true };
}
