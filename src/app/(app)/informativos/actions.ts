"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { type OrgTx, withOrgTx } from "@/db/org-tx";
import { companyFlowActionsText } from "@/domain/company-flow";
import * as schema from "@/db/schema";
import { normalizeCnpj, validateCnpj } from "@/domain/cnpj";
import { inferTaxRegimeFromCnpj } from "@/domain/client-tax-regime";
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
import {
  buildStructuredInformativePayload,
  STRUCTURED_INFORMATIVE_MODEL,
  structuredInformativeSourceText,
} from "@/lib/informatives/structured";
import { listActiveClans } from "@/lib/org";

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

interface ConsultedCnpjLookupView {
  kind: "consulted";
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

interface ExistingCnpjLookupView {
  kind: "existing";
  clientId: string;
  legalName: string;
  normalizedCnpj: string;
  active: boolean;
}

export type CnpjLookupView = ConsultedCnpjLookupView | ExistingCnpjLookupView;

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

  const existing = await withOrgTx(gate.actor.orgId, (tx) =>
    tx.query.clients.findFirst({
      columns: { id: true, name: true, active: true },
      where: and(
        eq(schema.clients.orgId, gate.actor.orgId),
        eq(schema.clients.cnpj, normalized),
      ),
    }),
  );
  if (existing) {
    return {
      ok: true,
      data: {
        kind: "existing",
        clientId: existing.id,
        legalName: existing.name,
        normalizedCnpj: normalized,
        active: existing.active,
      },
    };
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
      kind: "consulted",
      legalName: result.data.legalName,
      normalizedCnpj: normalized,
      cnaeCode: result.data.cnaeCode,
      cnaeDescription: result.data.cnaeDescription,
      secondaryCnaes: result.data.secondaryCnaes,
      openedAt: result.data.openedAt,
      suggestedTaxRegime: inferTaxRegimeFromCnpj(result.data),
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
  /** Atalho direto: vincula empresa e tipo sem criar Fluxo Societário. */
  directCompany: z.object({
    clientId: z.uuid("Empresa inválida."),
    kind: z.enum(["amendment", "closure"]),
  }).optional(),
}).superRefine((data, ctx) => {
  const origins = [
    Boolean(data.flowId),
    Boolean(data.directCompany),
    Boolean(data.resolvedCompany),
  ].filter(Boolean).length;
  if (origins > 1) {
    ctx.addIssue({
      code: "custom",
      path: ["directCompany"],
      message: "Escolha apenas uma origem para o Informativo.",
    });
  }
});

const structuredMissionSchema = z.object({
  clanId: z.uuid("Escolha um clã válido."),
  description: z
    .string()
    .trim()
    .min(3, "Descreva a missão.")
    .max(5_000, "A descrição da missão excede 5.000 caracteres."),
});

const structuredInformativeSchema = z.object({
  missions: z
    .array(structuredMissionSchema)
    .min(1, "Adicione ao menos uma missão.")
    .max(60, "Adicione no máximo 60 missões por Informativo."),
  resolvedCompany: resolvedCompanySchema.optional(),
});

/**
 * Caminho rápido do painel: clã e descrição já chegam separados, portanto a
 * prévia é montada deterministicamente e nenhuma API de IA é chamada.
 */
export async function prepareStructuredInformative(input: {
  missions: { clanId: string; description: string }[];
  resolvedCompany?: ResolvedCompany;
}): Promise<ActionResult<{ informativeId: string }>> {
  const gate = await requireInformativeActor();
  if (!gate.ok) return gate;

  const parsed = structuredInformativeSchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }
  if (
    parsed.data.resolvedCompany &&
    !validateCnpj(parsed.data.resolvedCompany.normalizedCnpj)
  ) {
    return err("CNPJ inválido — confira os dígitos.");
  }

  const clans = await listActiveClans(gate.actor.orgId);
  const activeClanIds = new Set(clans.map((clan) => clan.id));
  if (parsed.data.missions.some((mission) => !activeClanIds.has(mission.clanId))) {
    return err("Um dos clãs selecionados não está mais ativo. Atualize a página.");
  }

  let company;
  if (parsed.data.resolvedCompany) {
    const resolved = parsed.data.resolvedCompany;
    const existing = await withOrgTx(gate.actor.orgId, (tx) =>
      tx.query.clients.findFirst({
        where: and(
          eq(schema.clients.orgId, gate.actor.orgId),
          eq(schema.clients.cnpj, resolved.normalizedCnpj),
        ),
        columns: { id: true, name: true },
      }),
    );
    company = {
      ...resolved,
      legalName: existing?.name ?? resolved.legalName,
      clientId: existing?.id ?? null,
      createClient: !existing,
    };
  }

  let payload;
  try {
    payload = buildStructuredInformativePayload({
      clans,
      missions: parsed.data.missions,
      company,
    });
  } catch (error) {
    console.error("informativo estruturado: falha ao montar prévia", error);
    return err("Não foi possível montar a prévia. Atualize a página e tente novamente.");
  }

  const saved = await saveInformativeDraft({
    actor: gate.actor,
    payload,
    model: STRUCTURED_INFORMATIVE_MODEL,
    sourceText: structuredInformativeSourceText(parsed.data.missions, clans),
    source: "panel",
    connectionId: null,
  });

  revalidatePath("/informativos");
  return { ok: true, data: { informativeId: saved.id } };
}

/**
 * Extrai e roteia, salvando a prévia. Substitui a prévia pendente anterior
 * desta mesma pessoa (`saveInformativeDraft` cancela a antiga), então não
 * há duas prévias competindo pela confirmação.
 */
export async function analyzeInformative(input: {
  sourceText: string;
  resolvedCompany?: ResolvedCompany;
  flowId?: string;
  directCompany?: { clientId: string; kind: "amendment" | "closure" };
}): Promise<ActionResult<{ informativeId: string }>> {
  const gate = await requireInformativeActor();
  if (!gate.ok) return gate;

  const parsed = analyzeSchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }

  let flowContext: CompanyFlowDraftContext | undefined;
  let sourceForAi = parsed.data.sourceText;
  let sourceToSave = parsed.data.sourceText;
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
          billingAmount: schema.companyFlows.billingAmount,
          billingDescription: schema.companyFlows.billingDescription,
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
      billingAmount: flow.billingAmount,
      billingDescription: flow.billingDescription,
    };
    sourceForAi = actions;
    sourceToSave = actions;
  } else if (parsed.data.directCompany) {
    const directCompany = await withOrgTx(gate.actor.orgId, (tx) =>
      tx.query.clients.findFirst({
        where: and(
          eq(schema.clients.orgId, gate.actor.orgId),
          eq(schema.clients.id, parsed.data.directCompany!.clientId),
          eq(schema.clients.active, true),
        ),
        columns: {
          id: true,
          name: true,
          cnpj: true,
          taxRegime: true,
        },
      }),
    );
    if (!directCompany) return err("Empresa ativa não encontrada.");
    flowContext = {
      kind: parsed.data.directCompany.kind,
      existingClientId: directCompany.id,
      legalName: directCompany.name,
      normalizedCnpj: directCompany.cnpj,
      taxRegime: directCompany.taxRegime,
      billingAmount: null,
      billingDescription: null,
      noticeSourceText: parsed.data.sourceText,
    };
    sourceForAi =
      companyFlowActionsText(parsed.data.sourceText) ??
      "Nenhuma missão adicional.";
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
    sourceText: sourceToSave,
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
