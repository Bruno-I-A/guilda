"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { withOrgTx, type OrgTx } from "@/db/org-tx";
import type { SupportViewer } from "@/domain/support-inbox";
import { err, requireMemberContext, type ActionResult } from "@/lib/action-context";
import {
  addSupportNote,
  linkSupportContact,
  loadSupportViewer,
  markSupportWaiting,
  reopenSupportConversation,
  resolveSupportConversation,
  sendSupportReply,
  takeSupportConversation,
  transferSupportConversation,
} from "@/lib/support/inbox";

/**
 * Caixa de entrada: cada action confere sessão, organização e visibilidade da
 * conversa no servidor (dentro de lib/support/inbox) e valida tudo com Zod.
 */

const conversationId = z.uuid("Conversa inválida.");

type Base = { orgId: string; viewer: SupportViewer; now: Date };

async function run(body: (tx: OrgTx, base: Base) => Promise<ActionResult>): Promise<ActionResult> {
  const context = await requireMemberContext();
  if (!context.ok) return context;
  const result = await withOrgTx(context.orgId, async (tx) => {
    const viewer = await loadSupportViewer(tx, { orgId: context.orgId, userId: context.userId, role: context.role });
    return body(tx, { orgId: context.orgId, viewer, now: new Date() });
  });
  if (result.ok) revalidatePath("/atendimento");
  return result;
}

const idSchema = z.object({ conversationId });

export async function takeConversation(input: z.input<typeof idSchema>): Promise<ActionResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return err("Conversa inválida.");
  return run((tx, base) => takeSupportConversation(tx, { ...base, ...parsed.data }));
}

export async function markWaiting(input: z.input<typeof idSchema>): Promise<ActionResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return err("Conversa inválida.");
  return run((tx, base) => markSupportWaiting(tx, { ...base, ...parsed.data }));
}

export async function resolveConversation(input: z.input<typeof idSchema>): Promise<ActionResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return err("Conversa inválida.");
  return run((tx, base) => resolveSupportConversation(tx, { ...base, ...parsed.data }));
}

export async function reopenConversation(input: z.input<typeof idSchema>): Promise<ActionResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return err("Conversa inválida.");
  return run((tx, base) => reopenSupportConversation(tx, { ...base, ...parsed.data }));
}

const replySchema = z.object({
  conversationId,
  requestId: z.uuid("Recarregue a página e tente de novo."),
  // 4096 é o limite de texto da Cloud API.
  text: z.string().trim().min(1, "Escreva a mensagem.").max(4096, "Mensagem muito longa (até 4096 caracteres)."),
});

export async function sendReply(input: z.input<typeof replySchema>): Promise<ActionResult> {
  const parsed = replySchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Mensagem inválida.");
  return run((tx, base) => sendSupportReply(tx, { ...base, ...parsed.data }));
}

const noteSchema = z.object({
  conversationId,
  text: z.string().trim().min(1, "Escreva a nota.").max(4000, "Nota muito longa (até 4000 caracteres)."),
});

export async function addNote(input: z.input<typeof noteSchema>): Promise<ActionResult> {
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Nota inválida.");
  return run((tx, base) => addSupportNote(tx, { ...base, ...parsed.data }));
}

const transferSchema = z.object({
  conversationId,
  clanId: z.uuid("Clã inválido.").nullable(),
  userId: z.string().min(1).max(200).nullable(),
});

export async function transferConversation(input: z.input<typeof transferSchema>): Promise<ActionResult> {
  const parsed = transferSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Transferência inválida.");
  return run((tx, base) => transferSupportConversation(tx, { ...base, ...parsed.data }));
}

const linkSchema = z.object({ conversationId, clientId: z.uuid("Empresa inválida.").nullable() });

export async function linkContact(input: z.input<typeof linkSchema>): Promise<ActionResult> {
  const parsed = linkSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Empresa inválida.");
  return run((tx, base) => linkSupportContact(tx, { ...base, ...parsed.data }));
}
