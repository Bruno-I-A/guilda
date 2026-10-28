"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

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
