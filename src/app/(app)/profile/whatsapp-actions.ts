"use server";

import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { err, requireMemberContext, type ActionResult } from "@/lib/action-context";
import { appBaseUrl } from "@/lib/notices/links";
import { NOTICE_TEMPLATES, TEMPLATE_URL_EXAMPLE, type MemberTemplateKey } from "@/lib/notices/notice";
import { isAdminRole } from "@/lib/session";
import { loadWhatsAppChannelAccess } from "@/lib/whatsapp/channel-repository";
import { getWhatsAppConfig } from "@/lib/whatsapp/config";
import { startMemberWhatsAppVerification } from "@/lib/whatsapp/member-commands";
import { MEMBER_NEW_CLIENT_TEMPLATE, normalizeMemberPhoneInput, whatsAppPhoneVariants } from "@/lib/whatsapp/member-notifications";
import { verificationLink } from "@/lib/whatsapp/member-verification";
import {
  createWhatsAppUtilityTemplate,
  describeWhatsAppTemplateError,
  getWhatsAppTemplate,
  type MetaServerConfig,
  type WhatsAppTemplate,
  type WhatsAppTemplateButtonDefinition,
} from "@/lib/whatsapp/meta-client";

const settingsSchema = z.object({ phone: z.string().trim().min(8, "Informe o WhatsApp com DDD."), enabled: z.boolean() });

export async function saveMemberWhatsAppSettings(input: z.input<typeof settingsSchema>): Promise<ActionResult<{ needsVerification: boolean }>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const phone = normalizeMemberPhoneInput(parsed.data.phone);
  if (!phone) return err("Use um número válido com DDD, por exemplo (54) 99999-0000.");
  let taken = false;
  let needsVerification = true;
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
        columns: { id: true, phoneE164: true, verifiedAt: true },
      });
      const now = new Date();
      if (current) {
        const samePhone = whatsAppPhoneVariants(phone).includes(current.phoneE164);
        needsVerification = !samePhone || !current.verifiedAt;
        await tx.update(schema.memberWhatsAppConnections)
          .set({
            phoneE164: phone,
            enabled: parsed.data.enabled,
            optedInAt: now,
            updatedAt: now,
            // A janela e a confirmação pertencem ao número, não à pessoa: trocar
            // o telefone as reinicia (o mesmo número com ou sem o nono dígito
            // não é troca).
            ...(samePhone ? {} : { lastInboundAt: null, verifiedAt: null, verificationCodeHash: null, verificationExpiresAt: null }),
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
  return { ok: true, data: { needsVerification } };
}

export type VerificationStart = { code: string; link: string | null; officePhone: string | null; expiresAt: string };

/**
 * Gera o código que a pessoa manda do próprio WhatsApp. O código aparece só
 * nesta resposta; o banco guarda o hash.
 */
export async function startWhatsAppVerification(): Promise<ActionResult<VerificationStart>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const result = await withOrgTx(ctx.orgId, async (tx) => {
    const channel = await tx.query.supportWhatsAppChannels.findFirst({
      where: and(eq(schema.supportWhatsAppChannels.orgId, ctx.orgId), eq(schema.supportWhatsAppChannels.status, "active")),
      orderBy: [desc(schema.supportWhatsAppChannels.updatedAt)],
      columns: { displayPhoneNumber: true },
    });
    const started = await startMemberWhatsAppVerification(tx, { orgId: ctx.orgId, userId: ctx.userId });
    return started ? { ...started, officePhone: channel?.displayPhoneNumber ?? null } : null;
  });
  if (!result) return err("Salve o seu número antes de confirmar.");
  if (!result.officePhone) return err("O WhatsApp do escritório ainda não está conectado em Atendimento.");
  return {
    ok: true,
    data: {
      code: result.code,
      link: verificationLink(result.officePhone, result.code),
      officePhone: result.officePhone,
      expiresAt: result.expiresAt.toISOString(),
    },
  };
}

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário inválido.");
const optionalTime = z.union([timeSchema, z.literal("")]).transform((value) => value || null);

const preferencesSchema = z.object({
  taskNotifications: z.boolean(),
  approvalNotifications: z.boolean(),
  deadlineReminders: z.boolean(),
  xpNotifications: z.boolean(),
  closingNotifications: z.boolean(),
  campaignNotifications: z.boolean(),
  muralNotifications: z.boolean(),
  dailySummary: z.boolean(),
  dailySummaryTime: timeSchema,
  quietHoursStart: optionalTime,
  quietHoursEnd: optionalTime,
  timezone: z.string().trim().min(1).max(64).refine((zone) => {
    try {
      new Intl.DateTimeFormat("pt-BR", { timeZone: zone }).format();
      return true;
    } catch {
      return false;
    }
  }, "Fuso horário inválido."),
}).superRefine((value, ctx) => {
  if (Boolean(value.quietHoursStart) !== Boolean(value.quietHoursEnd)) {
    ctx.addIssue({ code: "custom", message: "Preencha o início e o fim do horário de silêncio." });
  }
});

export async function saveNotificationPreferences(input: z.input<typeof preferencesSchema>): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsed = preferencesSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Preferências inválidas.");
  const now = new Date();
  await withOrgTx(ctx.orgId, (tx) => tx
    .insert(schema.memberNotificationPreferences)
    .values({ orgId: ctx.orgId, userId: ctx.userId, ...parsed.data, updatedAt: now })
    .onConflictDoUpdate({
      target: [schema.memberNotificationPreferences.orgId, schema.memberNotificationPreferences.userId],
      set: { ...parsed.data, updatedAt: now },
    }));
  revalidatePath("/profile");
  return { ok: true };
}

// Estritamente operacional: o v1 tinha link e chamada para atendimento e foi
// classificado como Marketing. A Meta recusa variável no fim do BODY.
const NEW_CLIENT_BODY = "Cadastro operacional criado para a empresa {{1}}. Setor responsável: {{2}}. Consulte o registro na Guilda.";

type TemplateSpec = Readonly<{ key: MemberTemplateKey; name: string; body: string; examples: readonly string[]; buttons: WhatsAppTemplateButtonDefinition[] }>;

function templateSpecs(baseUrl: string): TemplateSpec[] {
  const link = (): WhatsAppTemplateButtonDefinition => ({ type: "URL", text: "Abrir na Guilda", url: `${baseUrl}/w/{{1}}`, example: `${baseUrl}/w/${TEMPLATE_URL_EXAMPLE}` });
  return [
    { key: "novo_cliente", name: MEMBER_NEW_CLIENT_TEMPLATE, body: NEW_CLIENT_BODY, examples: ["ACME Comércio Ltda", "Fiscal"], buttons: [] },
    ...Object.entries(NOTICE_TEMPLATES).map(([key, template]) => ({
      key: key as MemberTemplateKey,
      name: template.name,
      body: template.body,
      examples: template.examples,
      buttons: [...(template.quickReply ? [{ type: "QUICK_REPLY" as const, text: template.quickReply }] : []), link()],
    })),
  ];
}

export type TemplateStatusView = {
  key: string;
  name: string;
  status: string;
  category: string | null;
  rejectedReason: string | null;
  /** O código pede outra versão do modelo; vale depois de "Preparar modelos". */
  outdated?: boolean;
};

/**
 * Cria na Meta os modelos que faltam e atualiza a situação dos que existem.
 * Só admin: mexe na conta do WhatsApp do escritório.
 */
export async function prepareMemberWhatsAppTemplates(): Promise<ActionResult<{ templates: TemplateStatusView[] }>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  if (!isAdminRole(ctx.role)) return err("Somente admin ou dono prepara os modelos do WhatsApp.");
  const baseUrl = appBaseUrl();
  if (!baseUrl?.startsWith("https://")) return err("O endereço público da Guilda (NEXT_PUBLIC_APP_URL, com https) não está configurado.");
  try {
    const channel = await withOrgTx(ctx.orgId, (tx) => tx.query.supportWhatsAppChannels.findFirst({
      where: and(eq(schema.supportWhatsAppChannels.orgId, ctx.orgId), eq(schema.supportWhatsAppChannels.status, "active")),
      orderBy: [desc(schema.supportWhatsAppChannels.updatedAt)],
    }));
    if (!channel) throw new Error("Conecte primeiro o WhatsApp do escritório em Atendimento.");
    const access = await loadWhatsAppChannelAccess({ orgId: ctx.orgId, channelId: channel.id });
    if (!access) throw new Error("O token do WhatsApp do escritório não está disponível.");
    const meta = getWhatsAppConfig();
    if (!meta.appId || !meta.appSecret) throw new Error("A configuração do app da Meta está incompleta.");
    const config: MetaServerConfig = { appId: meta.appId, appSecret: meta.appSecret, graphApiVersion: meta.graphApiVersion };

    const results: { spec: TemplateSpec; template: WhatsAppTemplate }[] = [];
    for (const spec of templateSpecs(baseUrl)) {
      const template = await getWhatsAppTemplate({ wabaId: access.channel.wabaId, accessToken: access.accessToken, name: spec.name }, config)
        ?? await createWhatsAppUtilityTemplate({ wabaId: access.channel.wabaId, accessToken: access.accessToken, name: spec.name, body: spec.body, examples: spec.examples, buttons: spec.buttons }, config);
      results.push({ spec, template });
    }
    const now = new Date();
    await withOrgTx(ctx.orgId, async (tx) => {
      for (const { spec, template } of results) {
        const values = {
          name: template.name,
          language: template.language,
          status: template.status,
          category: template.category ?? null,
          templateId: template.id ?? null,
          rejectedReason: template.rejectedReason ?? null,
          checkedAt: now,
          updatedAt: now,
        };
        await tx.insert(schema.memberWhatsAppTemplates).values({ orgId: ctx.orgId, key: spec.key, ...values })
          .onConflictDoUpdate({ target: [schema.memberWhatsAppTemplates.orgId, schema.memberWhatsAppTemplates.key], set: values });
      }
    });
    revalidatePath("/profile");
    return {
      ok: true,
      data: { templates: results.map(({ spec, template }) => ({ key: spec.key, name: template.name, status: template.status, category: template.category ?? null, rejectedReason: template.rejectedReason ?? null })) },
    };
  } catch (cause) {
    return err(describeWhatsAppTemplateError(cause));
  }
}
