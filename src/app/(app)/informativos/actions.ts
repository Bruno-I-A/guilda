"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { type OrgTx, withOrgTx } from "@/db/org-tx";
import { companyFlowActionsText } from "@/domain/company-flow";
import * as schema from "@/db/schema";
import { normalizeCnpj, validateCnpj } from "@/domain/cnpj";
import { canHandleInformatives, isAdminRole } from "@/domain/guild-permissions";
import type { OrgRole } from "@/domain/task-state";
import {
  err,
  requireMemberContext,
  type ActionResult,
} from "@/lib/action-context";
import { lookupCnpj } from "@/lib/cnpj-lookup";
import { TAX_REGIMES } from "@/lib/clients-ui";
import {
  cancelInformative,
  confirmInformative,
  type InformativeTaskDecision,
} from "@/lib/informatives/confirm";
import {
  buildInformativeDraft,
  saveInformativeDraft,
  type InformativeActor,
  type CompanyFlowDraftContext,
  type ResolvedCompany,
} from "@/lib/informatives/draft";

/**
 * Server Actions do painel de informativos.
 *
 * Segunda porta de entrada do mesmo pipeline do Telegram: extrai, roteia e
 * mostra a prévia. NADA é criado antes de uma confirmação explícita.
 * Decisão 9: líder de clã também opera informativo, não só admin/owner.
 */

/** Lidera ao menos um clã ativo — habilita operar informativos. */
async function leadsAnyActiveClan(
  tx: OrgTx,
  orgId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: schema.clanMemberships.id })
    .from(schema.clanMemberships)
    .innerJoin(
      schema.clans,
      and(
        eq(schema.clans.id, schema.clanMemberships.clanId),
        eq(schema.clans.orgId, schema.clanMemberships.orgId),
      ),
    )
    .where(
      and(
        eq(schema.clanMemberships.orgId, orgId),
        eq(schema.clanMemberships.userId, userId),
        eq(schema.clanMemberships.isLeader, true),
        eq(schema.clans.active, true),
      ),
    )
    .limit(1);
  return Boolean(row);
}

async function requireInformativeActor(): Promise<
  { ok: true; actor: InformativeActor } | { ok: false; error: string }
> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const leadsAnyClan = await withOrgTx(ctx.orgId, (tx) =>
    leadsAnyActiveClan(tx, ctx.orgId, ctx.userId),
  );

  if (!canHandleInformatives({ role: ctx.role as OrgRole, leadsAnyClan })) {
    return err("Apenas um líder de clã, admin ou owner pode processar informativos.");
  }

  return {
    ok: true,
    actor: { orgId: ctx.orgId, userId: ctx.userId, role: ctx.role as OrgRole },
  };
}

const cnpjLookupSchema = z.object({ cnpj: z.string().min(1, "Informe o CNPJ.") });

export interface CnpjLookupView {
  legalName: string;
  normalizedCnpj: string;
  cnaeCode: string | null;
  cnaeDescription: string | null;
  secondaryCnaes: { code: string; description: string }[];
  openedAt: string | null;
  /** null quando a Receita não confirma opção pelo Simples — resto é escolha humana. */
  suggestedTaxRegime: (typeof TAX_REGIMES)[number] | null;
  /** Ex.: "ATIVA", "BAIXADA" — a tela decide se avisa, a action nunca bloqueia. */
  cadastralSituation: string | null;
}

/**
 * Passo 1 do fluxo "Novo cliente": busca o CNPJ na Receita (via BrasilAPI).
 * Nunca é a última palavra — falha, CNPJ não encontrado ou empresa baixada
 * só viram aviso na tela; a pessoa sempre pode preencher os campos à mão e
 * seguir (decisão de 2026-08-18).
 */
export async function lookupClientCnpj(input: {
  cnpj: string;
}): Promise<ActionResult<CnpjLookupView>> {
  const gate = await requireInformativeActor();
  if (!gate.ok) return gate;

  const parsed = cnpjLookupSchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }

  const normalized = normalizeCnpj(parsed.data.cnpj);
  if (!validateCnpj(normalized)) {
    return err("CNPJ inválido — confira os dígitos.");
  }

  const result = await lookupCnpj(normalized);
  if (!result.ok) {
    return err(
      result.reason === "not_found"
        ? "CNPJ não encontrado na Receita. Confira os dígitos ou preencha os dados manualmente."
        : "Não foi possível consultar a Receita agora. Preencha os dados manualmente.",
    );
  }

  return {
    ok: true,
    data: {
      legalName: result.data.legalName,
      normalizedCnpj: normalized,
      cnaeCode: result.data.cnaeCode,
      cnaeDescription: result.data.cnaeDescription,
      secondaryCnaes: result.data.secondaryCnaes,
      openedAt: result.data.openedAt,
      suggestedTaxRegime: result.data.isSimplesOptant ? "simples" : null,
      cadastralSituation: result.data.cadastralSituation,
    },
  };
}

const resolvedCompanySchema = z.object({
  legalName: z.string().trim().min(2, "Razão social muito curta.").max(200),
  normalizedCnpj: z.string().regex(/^\d{14}$/, "CNPJ inválido."),
  taxRegime: z.enum(TAX_REGIMES, { error: "Escolha o regime tributário." }),
  cnaeCode: z.string().trim().max(10).nullable(),
  cnaeDescription: z.string().trim().max(200).nullable(),
  secondaryCnaes: z
    .array(z.object({ code: z.string(), description: z.string() }))
    .nullable(),
  openedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
});

const analyzeSchema = z.object({
  sourceText: z
    .string()
    .trim()
    .min(10, "Cole o informativo — está curto demais para analisar.")
    .max(12_000, "O informativo excede 12.000 caracteres. Envie uma empresa por vez."),
  /** Presente só no fluxo "Novo cliente" — empresa já resolvida no passo 1. */
  resolvedCompany: resolvedCompanySchema.optional(),
  /** Presente quando a prévia nasceu de um Fluxo devolvido pelo Societário. */
  flowId: z.uuid("Fluxo inválido.").optional(),
});

/**
 * Extrai e roteia, salvando a prévia. Substitui a prévia pendente anterior
 * desta mesma pessoa (`saveInformativeDraft` cancela a antiga), então não
 * há duas prévias competindo pela confirmação.
 */
export async function analyzeInformative(input: {
  sourceText: string;
  resolvedCompany?: ResolvedCompany;
  flowId?: string;
}): Promise<ActionResult<{ informativeId: string }>> {
  const gate = await requireInformativeActor();
  if (!gate.ok) return gate;

  const parsed = analyzeSchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }

  let flowContext: CompanyFlowDraftContext | undefined;
  let sourceForAi = parsed.data.sourceText;
  const flowId = parsed.data.flowId;
  if (flowId) {
    if (!isAdminRole(gate.actor.role)) {
      return err("Apenas owner ou admin pode preparar o Informativo de um Fluxo.");
    }
    const actions = companyFlowActionsText(parsed.data.sourceText);
    if (!actions) {
      return err("Mantenha o título AÇÕES e descreva abaixo o que cada setor precisa fazer.");
    }
    const flow = await withOrgTx(gate.actor.orgId, async (tx) => {
      const [row] = await tx
        .select({
          kind: schema.companyFlows.kind,
          existingClientId: schema.companyFlows.existingClientId,
          requestedLegalName: schema.companyFlows.requestedLegalName,
          approvedLegalName: schema.companyFlows.approvedLegalName,
          resultCnpj: schema.companyFlows.resultCnpj,
          taxRegime: schema.companyFlows.taxRegime,
          approvedTaxRegime: schema.companyFlows.approvedTaxRegime,
        })
        .from(schema.companyFlows)
        .where(
          and(
            eq(schema.companyFlows.orgId, gate.actor.orgId),
            eq(schema.companyFlows.id, flowId),
            eq(schema.companyFlows.status, "informative_drafting"),
            isNull(schema.companyFlows.informativeId),
          ),
        );
      return row ?? null;
    });
    if (!flow) {
      return err("Este Fluxo não está disponível para gerar uma prévia. Reabra-o no Societário.");
    }
    flowContext = {
      kind: flow.kind,
      existingClientId: flow.existingClientId,
      legalName: flow.approvedLegalName ?? flow.requestedLegalName,
      normalizedCnpj: flow.resultCnpj,
      taxRegime: flow.approvedTaxRegime ?? flow.taxRegime,
    };
    sourceForAi = actions;
  }

  let draft;
  try {
    draft = await buildInformativeDraft(
      gate.actor,
      sourceForAi,
      parsed.data.resolvedCompany,
      flowContext,
    );
  } catch (error) {
    // Falha de rede/chave de API não deve vazar detalhe interno para a tela.
    console.error("informativo: falha ao extrair", error);
    return err("Não foi possível analisar o informativo agora. Tente de novo.");
  }

  if (!draft.ok) return err(draft.message);

  const saved = await saveInformativeDraft({
    actor: gate.actor,
    payload: draft.payload,
    model: draft.model,
    // No Fluxo, persiste somente o bloco enviado à IA; a ficha societária
    // continua sendo a fonte dos dados cadastrais e sensíveis.
    sourceText: sourceForAi,
    source: "panel",
    connectionId: null,
  });

  if (flowId) {
    const attached = await withOrgTx(gate.actor.orgId, async (tx) => {
      if (!isAdminRole(gate.actor.role)) return false;
      const [flow] = await tx
        .select({ id: schema.companyFlows.id, status: schema.companyFlows.status, informativeId: schema.companyFlows.informativeId })
        .from(schema.companyFlows)
        .where(and(eq(schema.companyFlows.orgId, gate.actor.orgId), eq(schema.companyFlows.id, flowId)))
        .for("update");
      if (!flow || flow.status !== "informative_drafting" || flow.informativeId) return false;
      await tx.update(schema.companyFlows).set({
        informativeId: saved.id,
        status: "completed",
        completedAt: new Date(),
        updatedAt: new Date(),
      })
        .where(eq(schema.companyFlows.id, flow.id));
      await tx.insert(schema.companyFlowEvents).values({
        orgId: gate.actor.orgId,
        flowId: flow.id,
        eventType: "informative_prepared",
        previousValue: { status: flow.status },
        newValue: { status: "completed", informativeId: saved.id },
        actorId: gate.actor.userId,
      });
      return true;
    });
    if (!attached) {
      await cancelInformative(gate.actor, saved.id);
      return err("Este Fluxo não está disponível para criar um Informativo. Reabra-o no Societário e tente novamente.");
    }
  }

  revalidatePath("/informativos");
  return { ok: true, data: { informativeId: saved.id } };
}

const decisionSchema = z.object({
  index: z.number().int().min(0).max(59),
  clanId: z.uuid("Clã inválido.").nullish(),
  assigneeId: z.string().min(1).nullish(),
});

const confirmSchema = z.object({
  informativeId: z.uuid("Informativo inválido."),
  decisions: z.array(decisionSchema).max(60).optional(),
});

export async function confirmInformativeDraft(input: {
  informativeId: string;
  decisions?: InformativeTaskDecision[];
}): Promise<ActionResult<{ taskIds: string[]; message: string }>> {
  const gate = await requireInformativeActor();
  if (!gate.ok) return gate;

  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }

  const result = await confirmInformative(gate.actor, parsed.data.informativeId, {
    decisions: parsed.data.decisions,
  });

  if (!result.ok) return err(result.message);

  revalidatePath("/informativos");
  revalidatePath("/tasks");
  revalidatePath("/clans");
  revalidatePath("/mural");
  revalidatePath("/clients");
  revalidatePath("/dashboard");
  return { ok: true, data: { taskIds: result.taskIds, message: result.message } };
}

export async function cancelInformativeDraft(input: {
  informativeId: string;
}): Promise<ActionResult<{ message: string }>> {
  const gate = await requireInformativeActor();
  if (!gate.ok) return gate;

  const parsed = z
    .object({ informativeId: z.uuid("Informativo inválido.") })
    .safeParse(input);
  if (!parsed.success) return err("Informativo inválido.");

  const result = await cancelInformative(gate.actor, parsed.data.informativeId);
  if (!result.ok) return err(result.message);

  revalidatePath("/informativos");
  return { ok: true, data: { message: result.message } };
}
