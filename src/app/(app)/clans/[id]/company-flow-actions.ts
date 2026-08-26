"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { withOrgTx, type OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import {
  COMPANY_FLOW_KINDS,
  COMPANY_FLOW_SOURCES,
  companyFlowInformativeText,
} from "@/domain/company-flow";
import { normalizeCnpj, validateCnpj } from "@/domain/cnpj";
import { TAX_REGIMES } from "@/lib/clients-ui";
import {
  canClaimCompanyFlow,
  canCreateCompanyFlow,
  canPrepareCompanyFlowInformative,
  canReturnCompanyFlow,
} from "@/domain/guild-permissions";
import {
  err,
  requireMemberContext,
  type ActionResult,
} from "@/lib/action-context";
import { isActiveClanMember, loadClanScopedFacts } from "@/lib/clans/facts";
import { lockActiveClansForMembershipRead } from "@/lib/clans/locks";
import { SOCIETARIO_CLAN_SLUG } from "@/lib/clans/rules";
import {
  decryptFlowSecret,
  encryptFlowSecret,
} from "@/lib/company-flows/secrets";
import { lookupCnpj } from "@/lib/cnpj-lookup";

const activitySchema = z.object({
  code: z.string().trim().max(12).nullable().optional(),
  description: z.string().trim().min(2, "Descreva a atividade.").max(300),
});

const qsaMemberSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do sócio.").max(200),
  document: z.string().trim().max(32).nullable().optional(),
  qualification: z.string().trim().max(120).nullable().optional(),
  participation: z.string().trim().max(40).nullable().optional(),
  changeType: z.enum(["entered", "left", "updated"]).nullable().optional(),
});

function optionalMoneySchema(label: string) {
  return z
    .union([z.string(), z.number()])
    .transform((value, ctx) => {
      const raw = String(value).trim();
      if (!raw) return null;
      const normalized = raw.includes(",")
        ? raw.replace(/\./g, "").replace(",", ".")
        : raw;
      if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
        ctx.addIssue({
          code: "custom",
          message: `${label} deve ter até duas casas decimais.`,
        });
        return z.NEVER;
      }
      const numericValue = Number(normalized);
      if (!Number.isFinite(numericValue) || numericValue > 9_999_999_999_999.99) {
        ctx.addIssue({ code: "custom", message: `${label} está fora do limite permitido.` });
        return z.NEVER;
      }
      return normalized;
    });
}

const flowBaseSchema = z.object({
  clanId: z.uuid("Clã inválido."),
  kind: z.enum(COMPANY_FLOW_KINDS),
  source: z.enum(COMPANY_FLOW_SOURCES),
  existingClientId: z.uuid("Empresa inválida.").nullable().optional(),
  requestedLegalName: z.string().trim().max(200).optional(),
  requestedActivities: z.array(activitySchema).max(30).default([]),
  removedActivities: z.array(activitySchema).max(30).default([]),
  taxRegime: z.enum(TAX_REGIMES).nullable().optional(),
  iptu: z.string().trim().max(120).optional(),
  socialCapital: optionalMoneySchema("Capital social").optional(),
  roomSize: z.string().trim().max(100).optional(),
  address: z.string().trim().max(1000).optional(),
  clientResponsible: z.string().trim().max(160).optional(),
  qsa: z.array(qsaMemberSchema).max(20).default([]),
  contactName: z.string().trim().max(160).optional(),
  contactPhone: z.string().trim().max(40).optional(),
  contactEmail: z.string().trim().email("E-mail de contato inválido.").max(200).or(z.literal("")).optional(),
  requestDetails: z.string().trim().max(5000).optional(),
  billingAmount: optionalMoneySchema("Valor cobrado").optional(),
  billingDescription: z.string().trim().max(1000).optional(),
  govPassword: z.string().min(1).max(500).optional(),
});

const createFlowSchema = flowBaseSchema.superRefine((data, ctx) => {
  if (data.kind === "opening") {
    if (!data.requestedLegalName?.trim()) {
      ctx.addIssue({ code: "custom", path: ["requestedLegalName"], message: "Informe a razão social pretendida." });
    }
    if (data.requestedActivities.length === 0) {
      ctx.addIssue({ code: "custom", path: ["requestedActivities"], message: "Informe ao menos uma atividade." });
    }
    if (!data.taxRegime) {
      ctx.addIssue({ code: "custom", path: ["taxRegime"], message: "Informe o regime tributário." });
    }
    if (data.qsa.length === 0) {
      ctx.addIssue({ code: "custom", path: ["qsa"], message: "Informe ao menos um integrante do QSA." });
    }
  } else if (!data.existingClientId) {
    ctx.addIssue({ code: "custom", path: ["existingClientId"], message: "Escolha a empresa que será alterada ou baixada." });
  }
  const hasBillingAmount = Boolean(data.billingAmount);
  const hasBillingDescription = Boolean(data.billingDescription?.trim());
  if (hasBillingAmount !== hasBillingDescription) {
    ctx.addIssue({
      code: "custom",
      path: hasBillingAmount ? ["billingDescription"] : ["billingAmount"],
      message: "Informe o valor e a descrição da cobrança.",
    });
  }
  if (data.billingAmount && Number(data.billingAmount) <= 0) {
    ctx.addIssue({
      code: "custom",
      path: ["billingAmount"],
      message: "O valor cobrado deve ser maior que zero.",
    });
  }
  if (data.kind === "opening" && (hasBillingAmount || hasBillingDescription)) {
    ctx.addIssue({
      code: "custom",
      path: ["billingAmount"],
      message: "A cobrança deste Fluxo está disponível somente para alterações e baixas.",
    });
  }
});

async function requireCorporateFlowClan(
  tx: OrgTx,
  input: { orgId: string; clanId: string; userId: string; role: Parameters<typeof loadClanScopedFacts>[4] },
) {
  await lockActiveClansForMembershipRead(tx, input.orgId);
  const loaded = await loadClanScopedFacts(
    tx,
    input.orgId,
    input.clanId,
    input.userId,
    input.role,
  );
  if (!loaded.clan || !loaded.clan.active || loaded.clan.slug !== SOCIETARIO_CLAN_SLUG) {
    return null;
  }
  const activeMember = await isActiveClanMember(
    tx,
    input.orgId,
    input.clanId,
    input.userId,
  );
  return { ...loaded, activeMember };
}

function revalidateCompanyFlow(clanId: string) {
  revalidatePath(`/clans/${clanId}`);
  revalidatePath("/informativos");
}

export async function createCompanyFlow(
  input: z.input<typeof createFlowSchema>,
): Promise<ActionResult<{ flowId: string }>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsed = createFlowSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const data = parsed.data;

  const encryptedSecret = data.govPassword ? encryptFlowSecret(data.govPassword) : null;
  if (data.govPassword && !encryptedSecret) {
    return err("O cofre do Gov.br não está configurado. Defina FLOW_SECRETS_KEY antes de salvar a senha.");
  }

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult<{ flowId: string }>> => {
    const corporate = await requireCorporateFlowClan(tx, {
      orgId: ctx.orgId,
      clanId: data.clanId,
      userId: ctx.userId,
      role: ctx.role,
    });
    if (!corporate) return err("Clã Societário não encontrado.");
    if (!canCreateCompanyFlow(corporate.facts)) {
      return err("Apenas owner ou admin pode abrir um Fluxo.");
    }

    if (data.existingClientId) {
      const [client] = await tx
        .select({ id: schema.clients.id })
        .from(schema.clients)
        .where(and(eq(schema.clients.orgId, ctx.orgId), eq(schema.clients.id, data.existingClientId)))
        .for("update");
      if (!client) return err("A empresa escolhida não pertence à organização.");
    }

    const [flow] = await tx
      .insert(schema.companyFlows)
      .values({
        orgId: ctx.orgId,
        societarioClanId: data.clanId,
        kind: data.kind,
        source: data.source,
        existingClientId: data.kind === "opening" ? null : data.existingClientId ?? null,
        requestedLegalName: data.requestedLegalName || null,
        requestedActivities: data.requestedActivities,
        removedActivities: data.removedActivities,
        taxRegime: data.taxRegime ?? null,
        iptu: data.iptu || null,
        socialCapital: data.socialCapital ?? null,
        roomSize: data.roomSize || null,
        address: data.address || null,
        clientResponsible: data.clientResponsible || null,
        qsa: data.qsa,
        contactName: data.contactName || null,
        contactPhone: data.contactPhone || null,
        contactEmail: data.contactEmail || null,
        requestDetails: data.requestDetails || null,
        billingAmount: data.kind === "opening" ? null : data.billingAmount ?? null,
        billingDescription: data.kind === "opening" ? null : data.billingDescription || null,
        createdBy: ctx.userId,
      })
      .returning({ id: schema.companyFlows.id });

    if (encryptedSecret) {
      await tx.insert(schema.companyFlowSecrets).values({
        orgId: ctx.orgId,
        flowId: flow.id,
        ...encryptedSecret,
        updatedBy: ctx.userId,
      });
    }
    await tx.insert(schema.companyFlowEvents).values({
      orgId: ctx.orgId,
      flowId: flow.id,
      eventType: "created",
      newValue: { kind: data.kind, source: data.source, hasGovSecret: Boolean(encryptedSecret) },
      actorId: ctx.userId,
    });
    return { ok: true, data: { flowId: flow.id } };
  });

  if (result.ok) revalidateCompanyFlow(data.clanId);
  return result;
}

const flowTargetSchema = z.object({
  clanId: z.uuid("Clã inválido."),
  flowId: z.uuid("Fluxo inválido."),
});

export async function claimCompanyFlow(
  input: z.input<typeof flowTargetSchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsed = flowTargetSchema.safeParse(input);
  if (!parsed.success) return err("Fluxo inválido.");
  const data = parsed.data;

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult> => {
    const corporate = await requireCorporateFlowClan(tx, { ...ctx, clanId: data.clanId });
    if (!corporate) return err("Clã Societário não encontrado.");
    const [flow] = await tx
      .select()
      .from(schema.companyFlows)
      .where(and(eq(schema.companyFlows.orgId, ctx.orgId), eq(schema.companyFlows.id, data.flowId), eq(schema.companyFlows.societarioClanId, data.clanId)))
      .for("update");
    if (!flow) return err("Fluxo não encontrado.");
    if (!canClaimCompanyFlow({ ...corporate.facts, isActiveCorporateMember: corporate.activeMember, isAssignedToFlow: flow.assignedTo === ctx.userId })) {
      return err("Você não participa do Societário.");
    }
    if (flow.status !== "sent_to_corporate") return err("Este Fluxo não está aguardando atendimento.");

    await tx.update(schema.companyFlows).set({ assignedTo: ctx.userId, status: "in_progress", updatedAt: new Date() })
      .where(eq(schema.companyFlows.id, flow.id));
    await tx.insert(schema.companyFlowEvents).values({
      orgId: ctx.orgId,
      flowId: flow.id,
      eventType: "claimed",
      previousValue: { status: flow.status, assignedTo: flow.assignedTo },
      newValue: { status: "in_progress", assignedTo: ctx.userId },
      actorId: ctx.userId,
    });
    return { ok: true };
  });
  if (result.ok) revalidateCompanyFlow(data.clanId);
  return result;
}

const returnFlowSchema = flowTargetSchema.extend({
  resultCnpj: z.string().trim().optional(),
  approvedLegalName: z.string().trim().max(200).optional(),
  approvedActivities: z.array(activitySchema).max(30).default([]),
  approvedTaxRegime: z.enum(TAX_REGIMES).nullable().optional(),
  approvedAddress: z.string().trim().max(1000).optional(),
  approvedQsa: z.array(qsaMemberSchema).max(20).default([]),
  processingNotes: z.string().trim().min(2, "Descreva o retorno do Societário.").max(5000),
}).superRefine((data, ctx) => {
  if (data.resultCnpj && !validateCnpj(normalizeCnpj(data.resultCnpj))) {
    ctx.addIssue({ code: "custom", path: ["resultCnpj"], message: "CNPJ inválido." });
  }
});

export async function returnCompanyFlowToOwner(
  input: z.input<typeof returnFlowSchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsed = returnFlowSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const data = parsed.data;
  const resultCnpj = data.resultCnpj ? normalizeCnpj(data.resultCnpj) : null;
  let officialLegalName = data.approvedLegalName || null;

  if (resultCnpj) {
    // A consulta visual apenas auxilia a revisão. A gravação repete a consulta
    // no servidor para que texto alterado no navegador nunca substitua a razão
    // social oficial vinculada ao CNPJ.
    const authorized = await withOrgTx(ctx.orgId, async (tx) => {
      const corporate = await requireCorporateFlowClan(tx, {
        ...ctx,
        clanId: data.clanId,
      });
      if (!corporate) return false;
      const [flow] = await tx
        .select({
          assignedTo: schema.companyFlows.assignedTo,
          status: schema.companyFlows.status,
        })
        .from(schema.companyFlows)
        .where(
          and(
            eq(schema.companyFlows.orgId, ctx.orgId),
            eq(schema.companyFlows.id, data.flowId),
            eq(schema.companyFlows.societarioClanId, data.clanId),
          ),
        );
      return Boolean(
        flow &&
        flow.status === "in_progress" &&
        canReturnCompanyFlow({
          ...corporate.facts,
          isActiveCorporateMember: corporate.activeMember,
          isAssignedToFlow: flow.assignedTo === ctx.userId,
        }),
      );
    });
    if (!authorized) {
      return err("Você não pode devolver este Fluxo.");
    }

    const officialCompany = await lookupCnpj(resultCnpj);
    if (!officialCompany.ok) {
      return err(
        officialCompany.reason === "not_found"
          ? "CNPJ não encontrado na Receita. Confira o número antes de devolver."
          : "Não foi possível confirmar a razão social na Receita agora. Tente novamente.",
      );
    }
    officialLegalName = officialCompany.data.legalName;
  }

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult> => {
    const corporate = await requireCorporateFlowClan(tx, { ...ctx, clanId: data.clanId });
    if (!corporate) return err("Clã Societário não encontrado.");
    const [flow] = await tx.select().from(schema.companyFlows)
      .where(and(eq(schema.companyFlows.orgId, ctx.orgId), eq(schema.companyFlows.id, data.flowId), eq(schema.companyFlows.societarioClanId, data.clanId)))
      .for("update");
    if (!flow) return err("Fluxo não encontrado.");
    if (!canReturnCompanyFlow({ ...corporate.facts, isActiveCorporateMember: corporate.activeMember, isAssignedToFlow: flow.assignedTo === ctx.userId })) {
      return err("Apenas quem assumiu o Fluxo, a liderança do Societário ou owner/admin pode devolvê-lo.");
    }
    if (flow.status !== "in_progress") return err("Este Fluxo não está em processamento.");
    if (flow.kind === "opening" && !data.resultCnpj) return err("Informe o CNPJ aprovado antes de devolver uma abertura.");

    const simpleConfirmation = flow.kind === "amendment" || flow.kind === "closure";

    await tx.update(schema.companyFlows).set({
      status: "awaiting_owner",
      resultCnpj: simpleConfirmation ? flow.resultCnpj : resultCnpj,
      approvedLegalName: simpleConfirmation ? flow.approvedLegalName : officialLegalName,
      approvedActivities: data.approvedActivities,
      approvedTaxRegime: simpleConfirmation ? flow.approvedTaxRegime : null,
      approvedAddress: simpleConfirmation ? flow.approvedAddress : null,
      approvedQsa: simpleConfirmation ? flow.approvedQsa : [],
      processingNotes: data.processingNotes,
      returnedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(schema.companyFlows.id, flow.id));
    await tx.insert(schema.companyFlowEvents).values({
      orgId: ctx.orgId,
      flowId: flow.id,
      eventType: "returned_to_owner",
      previousValue: { status: flow.status },
      newValue: {
        status: "awaiting_owner",
        resultCnpj: simpleConfirmation ? flow.resultCnpj : resultCnpj,
        approvedLegalName: simpleConfirmation ? flow.approvedLegalName : officialLegalName,
        approvedTaxRegime: simpleConfirmation ? flow.approvedTaxRegime : null,
        approvedAddress: simpleConfirmation ? flow.approvedAddress : null,
        approvedQsa: simpleConfirmation ? flow.approvedQsa : [],
      },
      note: data.processingNotes,
      actorId: ctx.userId,
    });
    return { ok: true };
  });
  if (result.ok) revalidateCompanyFlow(data.clanId);
  return result;
}

export async function prepareCompanyFlowInformative(
  input: z.input<typeof flowTargetSchema>,
): Promise<ActionResult<{ sourceText: string }>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsed = flowTargetSchema.safeParse(input);
  if (!parsed.success) return err("Fluxo inválido.");
  const data = parsed.data;

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult<{ sourceText: string }>> => {
    const corporate = await requireCorporateFlowClan(tx, { ...ctx, clanId: data.clanId });
    if (!corporate) return err("Clã Societário não encontrado.");
    if (!canPrepareCompanyFlowInformative(corporate.facts)) return err("Apenas owner ou admin pode preparar o Informativo.");
    const [flow] = await tx
      .select({
        flow: schema.companyFlows,
        clientName: schema.clients.name,
        clientCnpj: schema.clients.cnpj,
        clientTaxRegime: schema.clients.taxRegime,
      })
      .from(schema.companyFlows)
      .leftJoin(schema.clients, and(eq(schema.clients.orgId, schema.companyFlows.orgId), eq(schema.clients.id, schema.companyFlows.existingClientId)))
      .where(and(eq(schema.companyFlows.orgId, ctx.orgId), eq(schema.companyFlows.id, data.flowId), eq(schema.companyFlows.societarioClanId, data.clanId)))
      .for("update", { of: schema.companyFlows });
    if (!flow) return err("Fluxo não encontrado.");
    if (flow.flow.status !== "awaiting_owner" && flow.flow.status !== "informative_drafting") {
      return err("O Fluxo precisa estar devolvido ao dono antes de preparar o Informativo.");
    }
    if (flow.flow.informativeId) return err("Este Fluxo já possui uma prévia de Informativo. Abra Informativos para continuar.");

    const sourceText = companyFlowInformativeText({
      ...flow.flow,
      existingClientName: flow.clientName ?? null,
      existingClientCnpj: flow.clientCnpj ?? null,
      existingClientTaxRegime: flow.clientTaxRegime ?? null,
    });
    if (flow.flow.status !== "informative_drafting") {
      await tx.update(schema.companyFlows).set({ status: "informative_drafting", updatedAt: new Date() })
        .where(eq(schema.companyFlows.id, flow.flow.id));
    }
    return { ok: true, data: { sourceText } };
  });
  if (result.ok) revalidateCompanyFlow(data.clanId);
  return result;
}

export async function revealCompanyFlowGovPassword(
  input: z.input<typeof flowTargetSchema>,
): Promise<ActionResult<{ password: string }>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsed = flowTargetSchema.safeParse(input);
  if (!parsed.success) return err("Fluxo inválido.");
  const data = parsed.data;

  return withOrgTx(ctx.orgId, async (tx): Promise<ActionResult<{ password: string }>> => {
    const corporate = await requireCorporateFlowClan(tx, { ...ctx, clanId: data.clanId });
    if (!corporate) return err("Clã Societário não encontrado.");
    const [flow] = await tx.select({ assignedTo: schema.companyFlows.assignedTo }).from(schema.companyFlows)
      .where(and(eq(schema.companyFlows.orgId, ctx.orgId), eq(schema.companyFlows.id, data.flowId), eq(schema.companyFlows.societarioClanId, data.clanId)))
      .for("update");
    if (!flow) return err("Fluxo não encontrado.");
    if (!canReturnCompanyFlow({ ...corporate.facts, isActiveCorporateMember: corporate.activeMember, isAssignedToFlow: flow.assignedTo === ctx.userId })) {
      return err("A senha do Gov.br só pode ser vista pelo responsável societário, liderança ou owner/admin.");
    }
    const [secret] = await tx.select().from(schema.companyFlowSecrets)
      .where(and(eq(schema.companyFlowSecrets.orgId, ctx.orgId), eq(schema.companyFlowSecrets.flowId, data.flowId)));
    if (!secret) return err("Nenhuma senha do Gov.br foi registrada neste Fluxo.");
    const password = decryptFlowSecret(secret);
    if (!password) return err("Não foi possível abrir o cofre. Confira FLOW_SECRETS_KEY.");
    return { ok: true, data: { password } };
  });
}

const lookupCompanyFlowCnpjSchema = flowTargetSchema.extend({
  cnpj: z.string().min(1),
});

export async function lookupCompanyFlowCnpj(
  input: z.input<typeof lookupCompanyFlowCnpjSchema>,
): Promise<ActionResult<{ legalName: string; cnpj: string; activities: { code: string | null; description: string }[] }>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsed = lookupCompanyFlowCnpjSchema.safeParse(input);
  if (!parsed.success) return err("CNPJ inválido.");
  const data = parsed.data;
  const cnpj = normalizeCnpj(data.cnpj);
  if (!validateCnpj(cnpj)) return err("CNPJ inválido.");

  const authorized = await withOrgTx(ctx.orgId, async (tx) => {
    const corporate = await requireCorporateFlowClan(tx, { ...ctx, clanId: data.clanId });
    if (!corporate) return false;
    const [flow] = await tx.select({ assignedTo: schema.companyFlows.assignedTo, status: schema.companyFlows.status })
      .from(schema.companyFlows)
      .where(and(eq(schema.companyFlows.orgId, ctx.orgId), eq(schema.companyFlows.id, data.flowId), eq(schema.companyFlows.societarioClanId, data.clanId)));
    return Boolean(flow && flow.status === "in_progress" && canReturnCompanyFlow({ ...corporate.facts, isActiveCorporateMember: corporate.activeMember, isAssignedToFlow: flow.assignedTo === ctx.userId }));
  });
  if (!authorized) return err("Você não pode consultar CNPJ neste Fluxo.");

  const result = await lookupCnpj(cnpj);
  if (!result.ok) return err(result.reason === "not_found" ? "CNPJ não encontrado na Receita." : "Não foi possível consultar a Receita agora.");
  return {
    ok: true,
    data: {
      legalName: result.data.legalName,
      cnpj,
      activities: [
        ...(result.data.cnaeDescription ? [{ code: result.data.cnaeCode, description: result.data.cnaeDescription }] : []),
        ...result.data.secondaryCnaes,
      ],
    },
  };
}

export async function cancelCompanyFlow(
  input: z.input<typeof flowTargetSchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsed = flowTargetSchema.safeParse(input);
  if (!parsed.success) return err("Fluxo inválido.");
  const data = parsed.data;
  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult> => {
    const corporate = await requireCorporateFlowClan(tx, { ...ctx, clanId: data.clanId });
    if (!corporate || !canCreateCompanyFlow(corporate.facts)) return err("Apenas owner ou admin pode cancelar o Fluxo.");
    const [flow] = await tx.select().from(schema.companyFlows)
      .where(and(eq(schema.companyFlows.orgId, ctx.orgId), eq(schema.companyFlows.id, data.flowId), eq(schema.companyFlows.societarioClanId, data.clanId)))
      .for("update");
    if (!flow) return err("Fluxo não encontrado.");
    if (flow.status === "completed" || flow.status === "cancelled") return err("Este Fluxo não pode mais ser cancelado.");
    await tx.update(schema.companyFlows).set({ status: "cancelled", updatedAt: new Date() }).where(eq(schema.companyFlows.id, flow.id));
    await tx.insert(schema.companyFlowEvents).values({ orgId: ctx.orgId, flowId: flow.id, eventType: "cancelled", previousValue: { status: flow.status }, newValue: { status: "cancelled" }, actorId: ctx.userId });
    return { ok: true };
  });
  if (result.ok) revalidateCompanyFlow(data.clanId);
  return result;
}

/**
 * Apaga um Fluxo criado por engano. O banco remove em cascata o histórico e a
 * credencial Gov.br cifrada. Um informativo ainda pendente é cancelado antes
 * da exclusão; se ele já foi confirmado, as missões e os avisos continuam
 * preservados — apenas o Fluxo deixa de aparecer no Societário.
 */
export async function deleteCompanyFlow(
  input: z.input<typeof flowTargetSchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsed = flowTargetSchema.safeParse(input);
  if (!parsed.success) return err("Fluxo inválido.");
  const data = parsed.data;

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult> => {
    const corporate = await requireCorporateFlowClan(tx, { ...ctx, clanId: data.clanId });
    if (!corporate || !canCreateCompanyFlow(corporate.facts)) {
      return err("Apenas owner ou admin pode excluir o Fluxo.");
    }

    // A confirmação do informativo bloqueia o próprio rascunho antes de ler o
    // Fluxo. Mantemos essa mesma ordem para não disputar locks em sentidos
    // opostos quando alguém confirmar e outra pessoa tentar excluir.
    const [candidate] = await tx
      .select({ informativeId: schema.companyFlows.informativeId })
      .from(schema.companyFlows)
      .where(and(
        eq(schema.companyFlows.orgId, ctx.orgId),
        eq(schema.companyFlows.id, data.flowId),
        eq(schema.companyFlows.societarioClanId, data.clanId),
      ));
    if (!candidate) return err("Fluxo não encontrado.");

    let informative: { id: string; status: "pending" | "confirmed" | "cancelled" } | undefined;
    if (candidate.informativeId) {
      [informative] = await tx
        .select({ id: schema.informatives.id, status: schema.informatives.status })
        .from(schema.informatives)
        .where(and(
          eq(schema.informatives.orgId, ctx.orgId),
          eq(schema.informatives.id, candidate.informativeId),
      ))
        .for("update");
      if (!informative) return err("A prévia de Informativo vinculada a este Fluxo não foi encontrada.");
    }

    const [flow] = await tx
      .select()
      .from(schema.companyFlows)
      .where(and(
        eq(schema.companyFlows.orgId, ctx.orgId),
        eq(schema.companyFlows.id, data.flowId),
        eq(schema.companyFlows.societarioClanId, data.clanId),
      ))
      .for("update");
    if (!flow) return err("Fluxo não encontrado.");
    if (flow.informativeId !== candidate.informativeId) {
      return err("O Fluxo foi atualizado. Atualize a página e tente novamente.");
    }

    if (informative?.status === "pending") {
      await tx
        .update(schema.informatives)
        .set({ status: "cancelled", decidedAt: new Date() })
        .where(eq(schema.informatives.id, informative.id));
    }
    await tx.delete(schema.companyFlows).where(and(
      eq(schema.companyFlows.orgId, ctx.orgId),
      eq(schema.companyFlows.id, flow.id),
    ));
    return { ok: true };
  });

  if (result.ok) revalidateCompanyFlow(data.clanId);
  return result;
}
