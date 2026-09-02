"use server";

import { APIError } from "better-auth";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { z } from "zod";

import { db } from "@/db";
import * as schema from "@/db/schema";
import { err, type ActionResult } from "@/lib/action-context";
import { auth } from "@/lib/auth";
import { authErrorMessage } from "@/lib/auth-errors";

/**
 * Troca de senha da própria conta.
 *
 * Existe como Server Action — e não como duas chamadas do navegador — porque
 * `mustChangePassword` é o que prende quem entrou com senha temporária na
 * tela de troca. Enquanto o cliente podia desligar a flag por conta própria
 * (`authClient.updateUser`), a rotação obrigatória era uma sugestão: bastava
 * pedir para o servidor esquecê-la sem nunca trocar a senha.
 *
 * Aqui a flag só cai DEPOIS que `auth.api.changePassword` aceitou a senha
 * atual e gravou a nova — o desligamento é consequência da troca, não um
 * pedido independente. O campo saiu de `additionalFields.input`, então
 * `/api/auth/update-user` não o aceita mais.
 */

const schemaTroca = z
  .object({
    currentPassword: z.string().min(1, "Informe a senha atual."),
    newPassword: z
      .string()
      .min(8, "A senha precisa ter pelo menos 8 caracteres.")
      .max(200, "A senha é longa demais."),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "As senhas não coincidem.",
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    path: ["newPassword"],
    message: "A nova senha precisa ser diferente da atual.",
  });

export async function changeOwnPassword(
  input: z.input<typeof schemaTroca>,
): Promise<ActionResult> {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) return err("Sessão expirada. Entre novamente.");

  const parsed = schemaTroca.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }

  try {
    await auth.api.changePassword({
      headers: requestHeaders,
      body: {
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword,
      },
    });
  } catch (error) {
    if (error instanceof APIError) {
      return err(
        authErrorMessage({
          code: typeof error.body?.code === "string" ? error.body.code : undefined,
          message: error.message,
        }),
      );
    }
    console.error("Falha ao trocar a senha", error);
    return err("Não foi possível trocar a senha agora. Tente de novo.");
  }

  // Só aqui, e nunca a pedido do cliente. `user` é tabela do better-auth
  // (sem RLS), então a query fica fora de withOrgTx e mira o id da sessão.
  await db
    .update(schema.user)
    .set({ mustChangePassword: false, updatedAt: new Date() })
    .where(eq(schema.user.id, session.user.id));

  return { ok: true };
}
