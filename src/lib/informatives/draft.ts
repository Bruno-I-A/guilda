import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import {
  resolveSectorClan,
  routeInformativeTask,
  type RoutingClan,
} from "@/domain/clan-routing";
import { resolveAssigneeClan } from "@/domain/clans";
import { normalizeCnpj, validateCnpj } from "@/domain/cnpj";
import { extractObservationLines } from "@/domain/informative-text";
import type { OrgRole } from "@/domain/task-state";
import { resolveClientName } from "@/lib/ai/client-resolution";
import { extractFlowActions, extractInformative } from "@/lib/ai/informative";
import {
  informativeDraftPayloadSchema,
  type AssigneeSuggestionPayload,
  type InformativeDraftPayload,
} from "@/lib/ai/informative-schema";
import { resolveMemberName } from "@/lib/ai/member-resolution";
import { type TaxRegime } from "@/lib/clients-ui";
import {
  listActiveClans,
  listInformativeRoutingRules,
  listOrgMembers,
} from "@/lib/org";
import { isDetailedInformativeMessage } from "@/lib/telegram/informative-detection";
import { CONTABILIDADE_CLAN_SLUG } from "@/lib/clans/rules";

/**
 * Construção da prévia de um informativo — compartilhada pelas DUAS portas de
 * entrada (bot do Telegram e painel). O que muda entre elas é apenas quem
 * apresenta o resultado; a extração, o roteamento e a persistência são os
 * mesmos.
 */

const DRAFT_TTL_MS = 30 * 60 * 1000;

const MISSING_FIELD_LABELS = {
  company: "o nome da empresa",
  actions: "o que precisa ser feito",
  responsible: "quem será a pessoa responsável ou qual clã receberá a missão",
  due_date: "a data final do período de fechamento",
} as const;

export interface InformativeActor {
  orgId: string;
  userId: string;
  role: OrgRole;
}

/**
 * Empresa já resolvida pelo fluxo "Novo cliente" (consulta de CNPJ na
 * Receita, ver src/lib/cnpj-lookup.ts). Quando presente, `buildInformativeDraft`
 * NÃO pede à IA para adivinhar esses campos — ela só extrai as tarefas do
 * texto do passo 2, que descreve apenas "o que precisa ser feito".
 */
export interface ResolvedCompany {
  legalName: string;
  normalizedCnpj: string;
  taxRegime: TaxRegime;
  cnaeCode: string | null;
  cnaeDescription: string | null;
  secondaryCnaes: { code: string; description: string }[] | null;
  openedAt: string | null;
}

/** Dados oficiais do Fluxo; nunca precisam seguir para a IA de roteamento. */
export interface CompanyFlowDraftContext {
  kind: "opening" | "amendment" | "closure";
  existingClientId: string | null;
  legalName: string | null;
  normalizedCnpj: string | null;
  taxRegime: TaxRegime | null;
}

export type BuildInformativeDraftResult =
  | { ok: true; payload: InformativeDraftPayload; model: string }
  | { ok: false; message: string };

function currentYearInSaoPaulo(): number {
  return Number(
    new Intl.DateTimeFormat("en", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
    }).format(new Date()),
  );
}

function normalizeObservationText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * A IA pode, ocasionalmente, repetir em `ignoredNotes` a mesma linha que
 * acabou de transformar em missão. A prévia deve mostrar cada providência uma
 * única vez: missão ou observação, nunca os dois.
 */
export function removeMissionDuplicatedObservations(
  observations: readonly string[],
  tasks: readonly Pick<InformativeDraftPayload["tasks"][number], "sourceSection">[],
): string[] {
  const taskSources = tasks
    .map((task) => normalizeObservationText(task.sourceSection))
    .filter((source) => source.length >= 16);
  const seen = new Set<string>();

  return observations.filter((observation) => {
    const normalized = normalizeObservationText(observation);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);

    return !taskSources.some(
      (source) => normalized === source || (normalized.length >= 16 && source.includes(normalized)),
    );
  });
}

/**
 * Extrai o informativo, resolve nomes e ROTEIA cada ação pelo setor.
 * Nenhuma missão é criada aqui: o resultado é só a prévia.
 */
export async function buildInformativeDraft(
  actor: InformativeActor,
  sourceText: string,
  resolvedCompany?: ResolvedCompany,
  flowContext?: CompanyFlowDraftContext,
): Promise<BuildInformativeDraftResult> {
  const [members, clients, activeClanMemberships, activeClans, routingRules] =
    await Promise.all([
      listOrgMembers(actor.orgId),
      withOrgTx(actor.orgId, (tx) =>
        tx.query.clients.findMany({
          where: and(
            eq(schema.clients.orgId, actor.orgId),
            eq(schema.clients.active, true),
          ),
        }),
      ),
      withOrgTx(actor.orgId, (tx) =>
        tx
          .select({
            userId: schema.clanMemberships.userId,
            clanId: schema.clanMemberships.clanId,
            clanName: schema.clans.name,
            isPrimary: schema.clanMemberships.isPrimary,
          })
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
              eq(schema.clanMemberships.orgId, actor.orgId),
              eq(schema.clans.orgId, actor.orgId),
              eq(schema.clans.active, true),
            ),
          ),
      ),
      listActiveClans(actor.orgId),
      listInformativeRoutingRules(actor.orgId),
    ]);

  const clansByUser = new Map<
    string,
    Array<{ clanId: string; clanName: string; isPrimary: boolean }>
  >();
  for (const membership of activeClanMemberships) {
    const current = clansByUser.get(membership.userId) ?? [];
    current.push({
      clanId: membership.clanId,
      clanName: membership.clanName,
      isPrimary: membership.isPrimary,
    });
    clansByUser.set(membership.userId, current);
  }
  const routingClans: RoutingClan[] = activeClans.map((clan) => ({
    id: clan.id,
    name: clan.name,
    slug: clan.slug,
  }));

  // Com empresa já resolvida, o texto do passo 2 não traz dados de empresa
  // (só "o que precisa ser feito") — a heurística de detecção não se aplica.
  const sourceFormat = resolvedCompany || flowContext
    ? "informative"
    : isDetailedInformativeMessage(sourceText)
      ? "informative"
      : "business_mission";
  const extracted = flowContext
    ? await extractFlowActions(
        sourceText,
        members.map(({ userId, name }) => ({ userId, name })),
        activeClans,
        `${actor.orgId}:${actor.userId}`,
        flowContext.kind === "opening",
      )
    : await extractInformative(
        sourceText,
        members.map(({ userId, name }) => ({ userId, name })),
        clients.map(({ name }) => ({ name })),
        activeClans,
        `${actor.orgId}:${actor.userId}`,
        Boolean(resolvedCompany),
      );

  // Com empresa resolvida por CNPJ, o pedido de missão já é certo — é o
  // próprio cadastro do cliente novo. O texto do passo 2 é detalhe
  // complementar, nunca o único sinal de "isto é uma missão": mesmo um texto
  // sem nenhuma linha acionável ainda gera a missão garantida do Fiscal
  // (abaixo), então a checagem da IA não pode bloquear aqui.
  if (!resolvedCompany && !flowContext && !extracted.data.isMissionRequest) {
    return {
      ok: false,
      message:
        "Não identifiquei uma solicitação de nova missão. Diga o que precisa ser feito, a pessoa responsável ou o clã e, quando houver, a empresa e o prazo.",
    };
  }

  const kind = flowContext
    ? flowContext.kind === "opening"
      ? "new_client"
      : flowContext.kind === "amendment"
        ? "client_change"
        : "client_closure"
    : resolvedCompany
      ? "new_client"
      : extracted.data.kind ?? "general_task";
  const hasClosingPeriod = extracted.data.tasks.some(
    (task) => task.category === "closing_period",
  );
  const hasAnnualClosing = extracted.data.tasks.some(
    (task) => task.category === "annual_closing",
  );
  const missing = new Set(extracted.data.missingFields);
  // A empresa já é conhecida — a IA não tem como "encontrá-la" num texto que
  // só descreve tarefas, e não faz sentido bloquear por isso.
  if (resolvedCompany || flowContext) {
    missing.delete("company");
  } else if (
    (kind !== "general_task" || hasClosingPeriod || hasAnnualClosing) &&
    !extracted.data.company.legalName
  ) {
    missing.add("company");
  }
  // Idem: sem resolvedCompany, zero tarefas extraídas é bloqueio de verdade.
  // Com empresa resolvida, a missão garantida do Fiscal cobre o caso de um
  // texto sem nenhuma linha acionável — não é "faltou dizer o que fazer".
  if (!resolvedCompany && !flowContext && extracted.data.tasks.length === 0) missing.add("actions");
  // O destino deixou de ser bloqueio de extração: quem não tem clã nem pessoa
  // vira missão pendente e a decisão acontece na prévia.
  missing.delete("responsible");
  if (
    extracted.data.tasks.some(
      (task) => task.category === "closing_period" && !task.dueDate,
    )
  ) {
    missing.add("due_date");
  }
  if (missing.size) {
    const labels = [...missing].map((field) => MISSING_FIELD_LABELS[field]);
    return {
      ok: false,
      message: `Entendi parte da solicitação, mas faltou informar: ${labels.join(", ")}. Reenvie tudo em uma única mensagem; a ordem e a formatação não importam.`,
    };
  }

  const legalName = flowContext?.legalName ?? resolvedCompany?.legalName ?? extracted.data.company.legalName;
  const normalizedCnpj =
    flowContext?.normalizedCnpj ??
    resolvedCompany?.normalizedCnpj ??
    (extracted.data.company.cnpj ? normalizeCnpj(extracted.data.company.cnpj) : null);
  const validCnpj =
    flowContext?.normalizedCnpj ??
    resolvedCompany?.normalizedCnpj ??
    (normalizedCnpj && validateCnpj(normalizedCnpj) ? normalizedCnpj : null);
  // Empresa resolvida por CNPJ: casa só por CNPJ, nunca por nome — o objetivo
  // aqui é não duplicar cadastro, não "adivinhar" que é outra empresa parecida.
  const existingClient = flowContext
    ? (flowContext.existingClientId
        ? clients.find((client) => client.id === flowContext.existingClientId) ?? null
        : null)
    : resolvedCompany
      ? clients.find((client) => client.cnpj === validCnpj) ?? null
      : (validCnpj ? clients.find((client) => client.cnpj === validCnpj) ?? null : null) ??
        (legalName ? resolveClientName(legalName, clients) : null);

  if ((hasClosingPeriod || hasAnnualClosing) && !existingClient) {
    return {
      ok: false,
      message: legalName
        ? `Não consegui localizar “${legalName}” de forma única na carteira de clientes. Reenvie a missão usando o nome cadastrado da empresa.`
        : "Para vincular o fechamento ao controle da empresa, informe o nome dela.",
    };
  }

  const finalLegalName = existingClient?.name ?? legalName;
  const unresolved = new Set<string>();
  const tasks: InformativeDraftPayload["tasks"] = [];

  for (const task of extracted.data.tasks) {
    const core = {
      title: task.title,
      description:
        `${task.description}\n\nTrecho da solicitação:\n${task.sourceSection}`.slice(
          0,
          5000,
        ),
      priority: task.priority,
      difficulty: task.difficulty,
      dueDate: task.dueDate,
      category: task.category,
      closingYear:
        task.category === "annual_closing"
          ? task.closingYear ?? currentYearInSaoPaulo()
          : null,
      sourceSection: task.sourceSection,
      sector: task.sector,
    };

    const suggestions: AssigneeSuggestionPayload[] = [];
    for (const requested of task.assignees) {
      const resolved = resolveMemberName(requested, members);
      if (suggestions.some((entry) => entry.rawName === requested)) continue;
      suggestions.push({
        rawName: requested,
        userId: resolved?.userId ?? null,
        name: resolved?.name ?? null,
      });
    }

    const route = routeInformativeTask({
      sector: task.sector,
      suggestions,
      clans: routingClans,
      rules: routingRules,
    });

    if (route.outcome === "clan") {
      // Clã ganha da pessoa: nasce sem responsável e o líder distribui.
      tasks.push({
        ...core,
        assignmentType: "clan",
        assigneeId: null,
        assigneeName: null,
        clanId: route.clan.id,
        clanName: route.clan.name,
        suggestions,
      });
      continue;
    }

    if (route.outcome === "individual") {
      for (const person of route.assignees) {
        if (route.clan) {
          tasks.push({
            ...core,
            assignmentType: "individual",
            assigneeId: person.userId,
            assigneeName: person.name,
            clanId: route.clan.id,
            clanName: route.clan.name,
            suggestions,
          });
          continue;
        }
        const memberships = clansByUser.get(person.userId) ?? [];
        const clanResolution = resolveAssigneeClan(memberships);
        if (!clanResolution.ok) {
          unresolved.add(`${person.name}: ${clanResolution.reason}`.slice(0, 200));
          continue;
        }
        const clan = memberships.find(
          (membership) => membership.clanId === clanResolution.clanId,
        );
        if (!clan) {
          unresolved.add(`${person.name}: clã não localizado`.slice(0, 200));
          continue;
        }
        tasks.push({
          ...core,
          assignmentType: "individual",
          assigneeId: person.userId,
          assigneeName: person.name,
          clanId: clan.clanId,
          clanName: clan.clanName,
          suggestions,
        });
      }
      continue;
    }

    tasks.push({
      ...core,
      assignmentType: "pending",
      assigneeId: null,
      assigneeName: null,
      clanId: null,
      clanName: null,
      reason: route.reason,
      suggestions,
    });
  }

  const warnings = [...extracted.data.warnings];
  const closingYears = [
    ...new Set(
      tasks
        .filter((task) => task.category === "annual_closing")
        .map((task) => task.closingYear)
        .filter((year): year is number => year !== null),
    ),
  ];
  if (existingClient && closingYears.length > 0) {
    const alreadyClosed = await withOrgTx(actor.orgId, (tx) =>
      tx.query.accountingClosingYears.findMany({
        where: and(
          eq(schema.accountingClosingYears.orgId, actor.orgId),
          eq(schema.accountingClosingYears.clientId, existingClient.id),
          inArray(schema.accountingClosingYears.year, closingYears),
        ),
        columns: { year: true, closedAt: true },
      }),
    );
    for (const annual of alreadyClosed) {
      if (annual.closedAt) {
        warnings.push(
          `A campanha de ${annual.year} desta empresa já está marcada como fechada.`,
        );
      }
    }
  }

  const finalTaxRegime = flowContext
    ? flowContext.taxRegime
    : resolvedCompany?.taxRegime ?? extracted.data.company.taxRegime;
  // Empresa já resolvida por CNPJ: legalName/CNPJ/regime sempre presentes
  // (o passo 1 da tela exige regime antes de liberar o passo 2) — o único
  // motivo para NÃO criar é já existir um cliente com este CNPJ.
  const createClient = flowContext
    ? flowContext.kind === "opening" &&
      !existingClient &&
      Boolean(finalLegalName && validCnpj && finalTaxRegime)
    : resolvedCompany
      ? !existingClient
      : sourceFormat === "informative" &&
        kind === "new_client" &&
        Boolean(finalLegalName) &&
        !existingClient &&
        Boolean(validCnpj && finalTaxRegime);
  if (!flowContext && !resolvedCompany && sourceFormat === "informative" && kind === "new_client" && !validCnpj) {
    warnings.push(
      "CNPJ ausente ou inválido; a empresa não poderá ser criada automaticamente.",
    );
  }
  if (
    !flowContext &&
    !resolvedCompany &&
    sourceFormat === "informative" &&
    kind === "new_client" &&
    !existingClient &&
    !finalTaxRegime
  ) {
    warnings.push(
      "Regime tributário não identificado; a empresa não poderá ser criada automaticamente.",
    );
  }
  if (
    flowContext &&
    flowContext.kind === "opening" &&
    !existingClient &&
    !finalTaxRegime
  ) {
    warnings.push(
      "Regime tributário ausente no Fluxo; a empresa não poderá ser criada automaticamente.",
    );
  }
  if ((resolvedCompany || flowContext) && existingClient) {
    warnings.push(
      `Este CNPJ já está cadastrado como “${existingClient.name}” — nenhuma empresa nova será criada.`,
    );
  }
  if (sourceFormat === "informative" && !existingClient && kind === "client_closure") {
    warnings.push(
      "Cliente baixado não localizado no painel; as missões serão criadas sem vínculo.",
    );
  } else if (sourceFormat === "informative" && !existingClient && !createClient) {
    warnings.push("As missões serão criadas sem vínculo com uma empresa do painel.");
  }

  // Cliente novo de verdade: o combinado do Fiscal (se houver) vai direto
  // para a carteira, não para uma missão — quem decide o responsável é o
  // líder do clã Fiscal na aba Carteira (ver portfolio-actions.ts), não a
  // Mesa do Líder. O nome sugerido só pré-preenche o seletor do líder; ele
  // sempre pode trocar.
  // Distribuição de lucros: o setor precisa resolver especificamente para a
  // Contabilidade. A IA não pode transformar outros combinados recorrentes
  // em um planejamento financeiro genérico.
  const commitments: InformativeDraftPayload["commitments"] = [];
  const unroutedCommitments: string[] = [];
  for (const commitment of extracted.data.commitments) {
    const clan = resolveSectorClan(commitment.sector, routingClans, routingRules);
    if (!clan || clan.slug !== CONTABILIDADE_CLAN_SLUG) {
      unroutedCommitments.push(
        `${commitment.title}${commitment.notes ? ` — ${commitment.notes}` : ""}`.slice(0, 500),
      );
      continue;
    }
    commitments.push({
      clanId: clan.id,
      clanName: clan.name,
      title: "Distribuição de lucros",
      cadence: commitment.cadence,
      notes: commitment.notes,
    });
  }

  const pendingFiscalNote =
    resolvedCompany && createClient ? extracted.data.fiscalNote?.text ?? null : null;
  const suggestedFiscalOwnerId =
    resolvedCompany && createClient && extracted.data.fiscalNote?.assignee
      ? resolveMemberName(extracted.data.fiscalNote.assignee, members)?.userId ?? null
      : null;

  // Decisão 11: o que não é ação vira corpo do aviso no mural, não missão.
  const observations = removeMissionDuplicatedObservations(
    [
      ...(flowContext ? [] : extractObservationLines(sourceText)),
      ...extracted.data.ignoredNotes,
      // Distribuição sem clã reconhecido não some: vira observação do aviso.
      ...unroutedCommitments,
    ],
    tasks,
  ).slice(0, 30);

  const payload = informativeDraftPayloadSchema.parse({
    ...extracted.data,
    kind,
    sourceFormat,
    company: {
      ...extracted.data.company,
      legalName: finalLegalName,
      taxRegime: finalTaxRegime,
      summary:
        extracted.data.company.summary ??
        (finalLegalName
          ? `Solicitação referente a ${finalLegalName}.`
          : "Solicitação de missão geral."),
      normalizedCnpj: validCnpj,
      clientId: existingClient?.id ?? null,
      createClient,
      cnaeCode: resolvedCompany?.cnaeCode ?? null,
      cnaeDescription: resolvedCompany?.cnaeDescription ?? null,
      secondaryCnaes: resolvedCompany?.secondaryCnaes ?? null,
      openedAt: resolvedCompany?.openedAt ?? null,
      pendingFiscalNote,
      suggestedFiscalOwnerId,
    },
    tasks,
    commitments,
    observations,
    unresolvedAssignees: [...unresolved],
    warnings,
  });

  return { ok: true, payload, model: extracted.model };
}

/**
 * Persiste a prévia, cancelando a anterior ainda pendente da mesma pessoa —
 * uma prévia aberta por vez evita confirmar o rascunho errado.
 */
export async function saveInformativeDraft(input: {
  actor: InformativeActor;
  payload: InformativeDraftPayload;
  model: string;
  sourceText: string;
  source: "telegram" | "panel";
  connectionId: string | null;
}): Promise<{ id: string }> {
  return withOrgTx(input.actor.orgId, async (tx) => {
    const pendingDrafts = await tx
      .select({ id: schema.informatives.id })
      .from(schema.informatives)
      .where(
        and(
          eq(schema.informatives.orgId, input.actor.orgId),
          eq(schema.informatives.requestedBy, input.actor.userId),
          eq(schema.informatives.status, "pending"),
        ),
      )
      .for("update", { of: schema.informatives });

    const pendingIds = pendingDrafts.map((draft) => draft.id);
    if (pendingIds.length > 0) {
      await tx
        .update(schema.informatives)
        .set({ status: "cancelled", decidedAt: new Date() })
        .where(
          and(
            eq(schema.informatives.orgId, input.actor.orgId),
            inArray(schema.informatives.id, pendingIds),
          ),
        );

      // Um rascunho que veio do Fluxo não pode deixar a solicitação presa em
      // "preparando informativo" caso o owner abra outra prévia. O vínculo e
      // a trilha de auditoria são revertidos na mesma transação do descarte.
      const attachedFlows = await tx
        .select({
          id: schema.companyFlows.id,
          status: schema.companyFlows.status,
          informativeId: schema.companyFlows.informativeId,
        })
        .from(schema.companyFlows)
        .where(
          and(
            eq(schema.companyFlows.orgId, input.actor.orgId),
            inArray(schema.companyFlows.status, ["informative_drafting", "completed"]),
            inArray(schema.companyFlows.informativeId, pendingIds),
          ),
        )
        .for("update", { of: schema.companyFlows });

      for (const flow of attachedFlows) {
        await tx
          .update(schema.companyFlows)
          .set({
            status: "awaiting_owner",
            informativeId: null,
            completedAt: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.companyFlows.orgId, input.actor.orgId),
              eq(schema.companyFlows.id, flow.id),
              inArray(schema.companyFlows.status, ["informative_drafting", "completed"]),
            ),
          );
        await tx.insert(schema.companyFlowEvents).values({
          orgId: input.actor.orgId,
          flowId: flow.id,
          eventType: "informative_cancelled",
          previousValue: {
            status: flow.status,
            informativeId: flow.informativeId,
          },
          newValue: { status: "awaiting_owner", informativeId: null },
          note: "Rascunho substituído por uma nova prévia do mesmo responsável.",
          actorId: input.actor.userId,
        });
      }
    }

    const [created] = await tx
      .insert(schema.informatives)
      .values({
        orgId: input.actor.orgId,
        requestedBy: input.actor.userId,
        connectionId: input.connectionId,
        source: input.source,
        sourceText: input.sourceText,
        model: input.model,
        payload: input.payload,
        expiresAt: new Date(Date.now() + DRAFT_TTL_MS),
      })
      .returning({ id: schema.informatives.id });
    return created;
  });
}

/**
 * A prévia pode ser confirmada como está? Missão pendente e responsável sem
 * clã travam o pacote inteiro. No painel a pendência é resolvível na tela;
 * `unresolvedAssignees` exige corrigir o cadastro antes.
 */
export function draftIsBlocked(payload: InformativeDraftPayload): boolean {
  return (
    // Prévia sem missão só trava quando também não há empresa nova a criar:
    // no cadastro de cliente novo, zero missão é resultado válido (combinado
    // e "sem particularidades" não viram missão) e a confirmação ainda tem
    // trabalho a fazer — criar a empresa e enfileirá-la na carteira.
    (payload.tasks.length === 0 &&
      !payload.company.createClient &&
      payload.kind !== "client_change") ||
    payload.unresolvedAssignees.length > 0 ||
    payload.tasks.some((task) => task.assignmentType === "pending")
  );
}
