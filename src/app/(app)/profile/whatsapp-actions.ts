"use server";

import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { err, requireMemberContext, type ActionResult } from "@/lib/action-context";
import { isAdminRole } from "@/lib/session";
import { loadWhatsAppChannelAccess } from "@/lib/whatsapp/channel-repository";
import { getWhatsAppConfig } from "@/lib/whatsapp/config";
import { createWhatsAppUtilityTemplate, describeWhatsAppTemplateError, getWhatsAppTemplate, type MetaServerConfig } from "@/lib/whatsapp/meta-client";
import { MEMBER_NEW_CLIENT_TEMPLATE, normalizeWhatsAppPhone } from "@/lib/whatsapp/member-notifications";

const settingsSchema = z.object({ phone: z.string().trim().min(8, "Informe o WhatsApp com DDI e DDD."), enabled: z.boolean() });

export async function saveMemberWhatsAppSettings(input: z.input<typeof settingsSchema>): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const phone = normalizeWhatsAppPhone(parsed.data.phone);
  if (!phone) return err("Use um número válido com DDI e DDD, por exemplo 55 54 99999-0000.");
  try {
    await withOrgTx(ctx.orgId, async (tx) => {
      const duplicate = await tx.query.memberWhatsAppConnections.findFirst({
        where: and(eq(schema.memberWhatsAppConnections.orgId, ctx.orgId), eq(schema.memberWhatsAppConnections.phoneE164, phone)),
        columns: { userId: true },
      });
      if (duplicate && duplicate.userId !== ctx.userId) throw new Error("Este WhatsApp já está conectado a outra pessoa da Guilda.");
      await tx.insert(schema.memberWhatsAppConnections).values({ orgId: ctx.orgId, userId: ctx.userId, phoneE164: phone, enabled: parsed.data.enabled, optedInAt: new Date(), updatedAt: new Date() })
        .onConflictDoUpdate({ target: [schema.memberWhatsAppConnections.orgId, schema.memberWhatsAppConnections.userId], set: { phoneE164: phone, enabled: parsed.data.enabled, optedInAt: new Date(), updatedAt: new Date() } });
    });
  } catch (cause) {
    return err(cause instanceof Error ? cause.message : "Não foi possível salvar o WhatsApp.");
  }
  revalidatePath("/profile");
  return { ok: true };
}

const TEMPLATE_BODY = "Novo cliente na Guilda: {{1}}. Clã responsável: {{2}}. Abra os detalhes: {{3}}.";

export async function createMemberWhatsAppUtilityTemplate(): Promise<ActionResult<{ status: string }>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  if (!isAdminRole(ctx.role)) return err("Somente admin ou owner pode preparar o modelo de utilidade.");
  try {
    const channel = await withOrgTx(ctx.orgId, async (tx) => {
      return tx.query.supportWhatsAppChannels.findFirst({ where: and(eq(schema.supportWhatsAppChannels.orgId, ctx.orgId), eq(schema.supportWhatsAppChannels.status, "active")), orderBy: [desc(schema.supportWhatsAppChannels.updatedAt)] });
    });
    if (!channel) throw new Error("Conecte primeiro o WhatsApp do escritório em Atendimento.");
    const access = await loadWhatsAppChannelAccess({ orgId: ctx.orgId, channelId: channel.id });
    if (!access) throw new Error("O token do WhatsApp do escritório não está disponível.");
    const meta = getWhatsAppConfig();
    if (!meta.appId || !meta.appSecret) throw new Error("A configuração do app da Meta está incompleta.");
    const config: MetaServerConfig = { appId: meta.appId, appSecret: meta.appSecret, graphApiVersion: meta.graphApiVersion };
    const template = await getWhatsAppTemplate({ wabaId: access.channel.wabaId, accessToken: access.accessToken, name: MEMBER_NEW_CLIENT_TEMPLATE }, config)
      ?? await createWhatsAppUtilityTemplate({ wabaId: access.channel.wabaId, accessToken: access.accessToken, name: MEMBER_NEW_CLIENT_TEMPLATE, body: TEMPLATE_BODY, examples: ["ACME Comércio Ltda", "Fiscal", "https://guilda.example/clans/exemplo?flow=exemplo"] }, config);
    const result = await withOrgTx(ctx.orgId, async (tx) => {
      await tx.insert(schema.memberWhatsAppNotificationConfig).values({ orgId: ctx.orgId, templateName: template.name, templateLanguage: template.language, templateStatus: template.status, templateId: template.id, rejectedReason: template.rejectedReason, updatedAt: new Date() })
        .onConflictDoUpdate({ target: schema.memberWhatsAppNotificationConfig.orgId, set: { templateName: template.name, templateLanguage: template.language, templateStatus: template.status, templateId: template.id, rejectedReason: template.rejectedReason, updatedAt: new Date() } });
      return template.status;
    });
    revalidatePath("/profile");
    return { ok: true, data: { status: result } };
  } catch (cause) {
    return err(describeWhatsAppTemplateError(cause));
  }
}
