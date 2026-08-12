"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { requireMemberContext } from "@/lib/action-context";
import { getTelegramBotUsername } from "@/lib/telegram/client";
import { getTelegramConfig } from "@/lib/telegram/config";
import {
  generateTelegramLinkToken,
  hashTelegramLinkToken,
  telegramLinkTokenExpiresAt,
} from "@/lib/telegram/link-token";

import type { TelegramActionState } from "./telegram-types";

const IDLE_STATE: TelegramActionState = { status: "idle" };
const optionalTimeSchema = z
  .union([
    z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário silencioso inválido."),
    z.literal(""),
  ])
  .transform((value) => value || null);
const preferencesSchema = z.object({
  taskNotifications: z.boolean(),
  approvalNotifications: z.boolean(),
  deadlineReminders: z.boolean(),
  xpNotifications: z.boolean(),
  closingNotifications: z.boolean(),
  campaignNotifications: z.boolean(),
  dailySummary: z.boolean(),
  dailySummaryTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário do resumo inválido."),
  quietHoursStart: optionalTimeSchema,
  quietHoursEnd: optionalTimeSchema,
  timezone: z
    .string()
    .trim()
    .min(1, "Selecione um fuso horário.")
    .max(64, "Fuso horário inválido.")
    .refine(isValidTimezone, "Fuso horário inválido."),
}).superRefine((value, ctx) => {
  if (Boolean(value.quietHoursStart) !== Boolean(value.quietHoursEnd)) {
    ctx.addIssue({
      code: "custom",
      message: "Preencha o início e o fim do período silencioso.",
    });
  }
});

function isValidTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

function checkbox(formData: FormData, name: string) {
  return formData.get(name) === "on";
}

/** Gera um token de uso único; apenas o hash é persistido. */
export async function createTelegramLink(
  _previousState: TelegramActionState = IDLE_STATE,
  _formData?: FormData,
): Promise<TelegramActionState> {
  void _previousState;
  void _formData;
  const ctx = await requireMemberContext();
  if (!ctx.ok) return { status: "error", message: ctx.error };

  const username = await getTelegramBotUsername();
  if (!getTelegramConfig().botToken || !username) {
    return {
      status: "error",
      message:
        "O bot ainda não está configurado ou não foi possível consultar seu @username. Verifique TELEGRAM_BOT_TOKEN.",
    };
  }

  const rawToken = generateTelegramLinkToken();
  const tokenHash = hashTelegramLinkToken(rawToken);
  const now = new Date();
  const expiresAt = telegramLinkTokenExpiresAt(now);

  await withOrgTx(ctx.orgId, async (tx) => {
    // Um novo link invalida os anteriores ainda não utilizados.
    await tx
      .update(schema.telegramLinkTokens)
      .set({ consumedAt: now })
      .where(
        and(
          eq(schema.telegramLinkTokens.orgId, ctx.orgId),
          eq(schema.telegramLinkTokens.userId, ctx.userId),
          isNull(schema.telegramLinkTokens.consumedAt),
        ),
      );

    await tx.insert(schema.telegramLinkTokens).values({
      orgId: ctx.orgId,
      userId: ctx.userId,
      tokenHash,
      expiresAt,
    });
  });

  return {
    status: "success",
    message: "Link temporário criado. Ele pode ser usado uma única vez.",
    link: `https://t.me/${username}?start=${rawToken}`,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function disconnectTelegram(
  _previousState: TelegramActionState = IDLE_STATE,
  _formData?: FormData,
): Promise<TelegramActionState> {
  void _previousState;
  void _formData;
  const ctx = await requireMemberContext();
  if (!ctx.ok) return { status: "error", message: ctx.error };

  const now = new Date();
  const revoked = await withOrgTx(ctx.orgId, async (tx) => {
    const result = await tx
      .update(schema.telegramConnections)
      .set({ revokedAt: now })
      .where(
        and(
          eq(schema.telegramConnections.orgId, ctx.orgId),
          eq(schema.telegramConnections.userId, ctx.userId),
          isNull(schema.telegramConnections.revokedAt),
        ),
      )
      .returning({ id: schema.telegramConnections.id });

    await tx
      .update(schema.telegramLinkTokens)
      .set({ consumedAt: now })
      .where(
        and(
          eq(schema.telegramLinkTokens.orgId, ctx.orgId),
          eq(schema.telegramLinkTokens.userId, ctx.userId),
          isNull(schema.telegramLinkTokens.consumedAt),
        ),
      );

    return result;
  });

  revalidatePath("/profile");
  return revoked.length > 0
    ? { status: "success", message: "Telegram desconectado desta guilda." }
    : { status: "error", message: "Nenhuma conta do Telegram estava conectada." };
}

export async function updateTelegramPreferences(
  _previousState: TelegramActionState,
  formData: FormData,
): Promise<TelegramActionState> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return { status: "error", message: ctx.error };

  const parsed = preferencesSchema.safeParse({
    taskNotifications: checkbox(formData, "taskNotifications"),
    approvalNotifications: checkbox(formData, "approvalNotifications"),
    deadlineReminders: checkbox(formData, "deadlineReminders"),
    xpNotifications: checkbox(formData, "xpNotifications"),
    closingNotifications: checkbox(formData, "closingNotifications"),
    campaignNotifications: checkbox(formData, "campaignNotifications"),
    dailySummary: checkbox(formData, "dailySummary"),
    dailySummaryTime: String(formData.get("dailySummaryTime") ?? ""),
    timezone: String(formData.get("timezone") ?? ""),
    quietHoursStart: String(formData.get("quietHoursStart") ?? ""),
    quietHoursEnd: String(formData.get("quietHoursEnd") ?? ""),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Preferências inválidas.",
    };
  }

  const now = new Date();
  await withOrgTx(ctx.orgId, (tx) =>
    tx
      .insert(schema.telegramPreferences)
      .values({
        orgId: ctx.orgId,
        userId: ctx.userId,
        ...parsed.data,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          schema.telegramPreferences.orgId,
          schema.telegramPreferences.userId,
        ],
        set: { ...parsed.data, updatedAt: now },
      }),
  );

  revalidatePath("/profile");
  return { status: "success", message: "Preferências do Telegram salvas." };
}
