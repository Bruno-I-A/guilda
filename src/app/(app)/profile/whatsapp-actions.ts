"use server";

import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { err, requireMemberContext, type ActionResult } from "@/lib/action-context";
import { isAdminRole } from "@/lib/session";
import { loadWhatsAppChannelAccess } from "@/lib/whatsapp/channel-repository";
import { getWhatsAppConfig } from "@/lib/whatsapp/config";
import { createWhatsAppUtilityTemplate, describeWhatsAppTemplateError, getWhatsAppTemplate, type MetaServerConfig } from "@/lib/whatsapp/meta-client";
import { MEMBER_NEW_CLIENT_TEMPLATE, normalizeMemberPhoneInput, whatsAppPhoneVariants } from "@/lib/whatsapp/member-notifications";

const settingsSchema = z.object({ phone: z.string().trim().min(8, "Informe o WhatsApp com DDD."), enabled: z.boolean() });

export async function saveMemberWhatsAppSettings(input: z.input<typeof settingsSchema>): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const phone = normalizeMemberPhoneInput(parsed.data.phone);
  if (!phone) return err("Use um número válido com DDD, por exemplo (54) 99999-0000.");
  let taken = false;
  try {
    await withOrgTx(ctx.orgId, async (tx) => {
      // Com e sem o nono dígito é o mesmo WhatsApp: os dois formatos contam.
      const duplicate = await tx.query.memberWhatsAppConnections.findFirst({
        where: and(
          eq(schema.memberWhatsAppConnections.orgId, ctx.orgId),
          inArray(schema.memberWhatsAppConnections.phoneE164, whatsAppPhoneVariants(phone)),
          ne(schema.memberWhatsAppConnections.userId, ctx.userId),
        ),
        columns: { userId: true },
      });
      if (duplicate) {
        taken = true;
        return;
      }
      const current = await tx.query.memberWhatsAppConnections.findFirst({
        where: and(eq(schema.memberWhatsAppConnections.orgId, ctx.orgId), eq(schema.memberWhatsAppConnections.userId, ctx.userId)),
        columns: { id: true, phoneE164: true },
      });
      const now = new Date();
      if (current) {
        await tx.update(schema.memberWhatsAppConnections)
          .set({
            phoneE164: phone,
            enabled: parsed.data.enabled,
            optedInAt: now,
            updatedAt: now,
            // A janela pertence ao número, não à pessoa: trocar o telefone a reinicia
            // (o mesmo número com ou sem o nono dígito não é troca).
            ...(whatsAppPhoneVariants(phone).includes(current.phoneE164) ? {} : { lastInboundAt: null }),
          })
          .where(and(eq(schema.memberWhatsAppConnections.orgId, ctx.orgId), eq(schema.memberWhatsAppConnections.id, current.id)));
      } else {
        await tx.insert(schema.memberWhatsAppConnections).values({
          orgId: ctx.orgId,
          userId: ctx.userId,
          phoneE164: phone,
          enabled: parsed.data.enabled,
          optedInAt: now,
          updatedAt: now,
        });
      }
    });
  } catch (cause) {
    // Query e parâmetros nunca vão à tela: além de confundir, poderiam exibir telefone.
    console.error("Falha ao salvar vínculo de WhatsApp do integrante", cause);
    return err("Não foi possível salvar o WhatsApp agora. Tente novamente; se continuar, avise o administrador.");
  }
  // Fora do catch: dentro dele esta explicação virava a mensagem genérica.
  if (taken) return err("Este WhatsApp já está conectado a outra pessoa da Guilda.");
  revalidatePath("/profile");
  return { ok: true };
}

// A Meta recusa variável no fim do BODY — inclusive quando vem seguida de ponto.
const TEMPLATE_BODY = "Novo cliente na Guilda: {{1}}. Clã responsável: {{2}}. Abra os detalhes em {{3}} e dê sequência ao atendimento.";

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
