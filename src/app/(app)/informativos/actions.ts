"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { type OrgTx, withOrgTx } from "@/db/org-tx";
import {
  accountantChangeInformativeText,
  companyFlowActionsText,
  companyFlowInformativeText,
  directCompanyInformativeText,
} from "@/domain/company-flow";
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
  type StructuredInformativeCompany,
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
    .max(60, "Adicione no máximo 60 missões por Informativo."),
  resolvedCompany: resolvedCompanySchema.optional(),
  flowId: z.uuid("Fluxo inválido.").optional(),
  directCompany: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("company"),
      clientId: z.uuid("Empresa inválida."),
      kind: z.enum(["amendment", "closure"]),
      details: z.string().trim().max(5_000),
    }),
    z.object({
      type: z.literal("accountant_change"),
      clientId: z.uuid("Empresa inválida."),
      responsibilityUntil: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data de responsabilidade.")
        .refine((value) => {
          const parsed = new Date(`${value}T12:00:00Z`);
          return (
            !Number.isNaN(parsed.getTime()) &&
            parsed.toISOString().slice(0, 10) === value
          );
        }, "Informe uma data de responsabilidade válida."),
      address: z.string().trim().max(1_000),
      observations: z.string().trim().max(5_000),
    }),
  ]).optional(),
}).superRefine((data, ctx) => {
  const origins = [
    Boolean(data.resolvedCompany),
    Boolean(data.flowId),
    Boolean(data.directCompany),
  ].filter(Boolean).length;
  if (origins > 1) {
    ctx.addIssue({
      code: "custom",
      path: ["flowId"],
      message: "Escolha apenas uma origem para o Informativo.",
    });
  }
});

async function attachInformativeToFlow(
  actor: InformativeActor,
  flowId: string,
  informativeId: string,
): Promise<boolean> {
  return withOrgTx(actor.orgId, async (tx) => {
    if (!isAdminRole(actor.role)) return false;
    const [flow] = await tx
      .select({
        id: schema.companyFlows.id,
        status: schema.companyFlows.status,
        informativeId: schema.companyFlows.informativeId,
      })
      .from(schema.companyFlows)
      .where(
        and(
          eq(schema.companyFlows.orgId, actor.orgId),
          eq(schema.companyFlows.id, flowId),
        ),
      )
      .for("update");
    if (
      !flow ||
      flow.status !== "informative_drafting" ||
      flow.informativeId
    ) {
      return false;
    }
    await tx
      .update(schema.companyFlows)
      .set({
        informativeId,
        status: "completed",
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.companyFlows.id, flow.id));
    await tx.insert(schema.companyFlowEvents).values({
      orgId: actor.orgId,
      flowId: flow.id,
      eventType: "informative_prepared",
      previousValue: { status: flow.status },
      newValue: { status: "completed", informativeId },
      actorId: actor.userId,
    });
    return true;
  });
}

/**
 * Caminho rápido do painel: clã e descrição já chegam separados, portanto a
 * prévia é montada deterministicamente e nenhuma API de IA é chamada.
 */
export async function prepareStructuredInformative(
  input: z.input<typeof structuredInformativeSchema>,
): Promise<ActionResult<{ informativeId: string }>> {
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

  let company: StructuredInformativeCompany | undefined;
  let kind: "new_client" | "client_change" | "client_closure" | "general_task" =
    "general_task";
  let sourceText = structuredInformativeSourceText(parsed.data.missions, clans);
  let observations: string[] = [];
  let summary: string | undefined;

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
    kind = "new_client";
  } else if (parsed.data.directCompany) {
    const direct = parsed.data.directCompany;
    const client = await withOrgTx(gate.actor.orgId, (tx) =>
      tx.query.clients.findFirst({
        where: and(
          eq(schema.clients.orgId, gate.actor.orgId),
          eq(schema.clients.id, direct.clientId),
          eq(schema.clients.active, true),
        ),
        columns: {
          id: true,
          name: true,
          cnpj: true,
          taxRegime: true,
          cnaeCode: true,
          cnaeDescription: true,
          secondaryCnaes: true,
          openedAt: true,
        },
      }),
    );
    if (!client) return err("Empresa ativa não encontrada.");

    company = {
      legalName: client.name,
      normalizedCnpj:
        client.cnpj && validateCnpj(client.cnpj) ? client.cnpj : null,
      taxRegime: client.taxRegime,
      clientId: client.id,
      createClient: false,
      cnaeCode: client.cnaeCode,
      cnaeDescription: client.cnaeDescription,
      secondaryCnaes: client.secondaryCnaes,
      openedAt: client.openedAt,
    };
    const actionText = structuredInformativeSourceText(parsed.data.missions, clans);

    if (direct.type === "accountant_change") {
      kind = "client_closure";
      sourceText = accountantChangeInformativeText({
        companyName: client.name,
        cnpj: client.cnpj,
        taxRegime: client.taxRegime,
        address: direct.address,
        responsibilityUntil: direct.responsibilityUntil,
        observations: direct.observations,
        actions: actionText,
      });
      observations = [
        `Responsabilidade do escritório até ${direct.responsibilityUntil}`,
        direct.address ? `Endereço: ${direct.address}` : "",
        direct.observations,
      ].filter(Boolean);
      summary = `Desligamento de ${client.name} por troca de contabilidade.`;
    } else {
      kind = direct.kind === "amendment" ? "client_change" : "client_closure";
      sourceText = directCompanyInformativeText({
        kind: direct.kind,
        companyName: client.name,
        cnpj: client.cnpj,
        taxRegime: client.taxRegime,
        details: direct.details,
        actions: actionText,
      });
      observations = direct.details ? [direct.details] : [];
      summary = `${direct.kind === "amendment" ? "Alteração" : "Baixa"} de ${client.name}.`;
    }
  } else if (parsed.data.flowId) {
    if (!isAdminRole(gate.actor.role)) {
      return err("Apenas owner ou admin pode preparar o Informativo de um Fluxo.");
    }
    const flow = await withOrgTx(gate.actor.orgId, async (tx) => {
      const [row] = await tx
        .select({
          flow: schema.companyFlows,
          clientName: schema.clients.name,
          clientCnpj: schema.clients.cnpj,
          clientTaxRegime: schema.clients.taxRegime,
          rhVerificationTaskStatus: schema.tasks.status,
        })
        .from(schema.companyFlows)
        .leftJoin(
          schema.clients,
          and(
            eq(schema.clients.orgId, schema.companyFlows.orgId),
            eq(schema.clients.id, schema.companyFlows.existingClientId),
          ),
        )
        .leftJoin(
          schema.tasks,
          and(
            eq(schema.tasks.orgId, schema.companyFlows.orgId),
            eq(schema.tasks.id, schema.companyFlows.rhVerificationTaskId),
          ),
        )
        .where(
          and(
            eq(schema.companyFlows.orgId, gate.actor.orgId),
            eq(schema.companyFlows.id, parsed.data.flowId!),
            eq(schema.companyFlows.status, "informative_drafting"),
            isNull(schema.companyFlows.informativeId),
          ),
        );
      return row ?? null;
    });
    if (!flow) {
      return err("Este Fluxo não está disponível para gerar uma prévia. Reabra-o no Societário.");
    }

    const flowInput = {
      ...flow.flow,
      existingClientName: flow.clientName ?? null,
      existingClientCnpj: flow.clientCnpj ?? null,
      existingClientTaxRegime: flow.clientTaxRegime ?? null,
      rhVerificationConfirmed:
        Boolean(flow.flow.rhVerificationTaskId) &&
        flow.rhVerificationTaskStatus === "completed",
    };
    const originalSource = companyFlowInformativeText(flowInput);
    const actionsMarker = originalSource.search(/(?:^|\n)A(?:Ç|C)(?:Õ|O)ES\s*:?(?:\n|$)/i);
    sourceText = [
      actionsMarker >= 0 ? originalSource.slice(0, actionsMarker).trimEnd() : originalSource,
      structuredInformativeSourceText(parsed.data.missions, clans),
    ].join("\n\n");
    kind =
      flow.flow.kind === "opening"
        ? "new_client"
        : flow.flow.kind === "amendment"
          ? "client_change"
          : "client_closure";
    const legalName =
      flow.flow.kind === "opening"
        ? flow.flow.approvedLegalName ?? flow.flow.requestedLegalName ?? flow.clientName
        : flow.clientName ?? flow.flow.approvedLegalName ?? flow.flow.requestedLegalName;
    if (!legalName) return err("O Fluxo não possui uma razão social para o Informativo.");
    company = {
      legalName,
      normalizedCnpj: [flow.clientCnpj, flow.flow.resultCnpj].find(
        (cnpj): cnpj is string => Boolean(cnpj && validateCnpj(cnpj)),
      ) ?? null,
      taxRegime:
        flow.flow.approvedTaxRegime ??
        flow.flow.taxRegime ??
        flow.clientTaxRegime ??
        null,
      clientId: flow.flow.existingClientId,
      createClient: flow.flow.kind === "opening" && !flow.flow.existingClientId,
      cnaeCode: null,
      cnaeDescription: null,
      secondaryCnaes: null,
      openedAt: null,
    };
    observations = [flow.flow.requestDetails, flow.flow.processingNotes].filter(
      (value): value is string => Boolean(value?.trim()),
    );
    summary = `${flow.flow.kind === "opening" ? "Abertura" : flow.flow.kind === "amendment" ? "Alteração" : "Baixa"} de ${legalName}.`;
  }

  if (
    parsed.data.missions.length === 0 &&
    kind !== "client_change" &&
    !company?.createClient
  ) {
    return err("Adicione ao menos uma missão.");
  }

  let payload;
  try {
    payload = buildStructuredInformativePayload({
      clans,
      missions: parsed.data.missions,
      company,
      kind,
      summary,
      observations,
    });
  } catch (error) {
    console.error("informativo estruturado: falha ao montar prévia", error);
    return err("Não foi possível montar a prévia. Atualize a página e tente novamente.");
  }

  const saved = await saveInformativeDraft({
    actor: gate.actor,
    payload,
    model: STRUCTURED_INFORMATIVE_MODEL,
    sourceText,
    source: "panel",
    connectionId: null,
  });

  if (parsed.data.flowId) {
    const attached = await attachInformativeToFlow(
      gate.actor,
      parsed.data.flowId,
      saved.id,
    );
    if (!attached) {
      await cancelInformative(gate.actor, saved.id);
      return err("Este Fluxo não está disponível para criar um Informativo. Reabra-o no Societário e tente novamente.");
    }
  }

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
    const attached = await attachInformativeToFlow(
      gate.actor,
      flowId,
      saved.id,
    );
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
