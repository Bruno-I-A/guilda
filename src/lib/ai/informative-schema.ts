import { z } from "zod";

import { TAX_REGIMES } from "@/lib/clients-ui";

const nullableText = (max: number) => z.string().trim().max(max).nullable();

const informativeTaskCoreSchema = z.object({
  category: z.enum(["general", "closing_period", "annual_closing"]),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(1).max(5000),
  priority: z.number().int().min(1).max(3),
  difficulty: z.number().int().min(1).max(5),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  closingYear: z.number().int().min(2000).max(2100).nullable(),
  sourceSection: z.string().trim().min(1).max(1000),
});

/**
 * A IA NÃO escolhe mais entre missão individual e missão de clã: devolve o
 * setor como texto e os nomes citados. Quem decide o destino é a função pura
 * `routeInformativeTask` no servidor (ver src/domain/clan-routing.ts).
 */
const informativeExtractionTaskSchema = informativeTaskCoreSchema.extend({
  sector: nullableText(120),
  assignees: z.array(z.string().trim().min(1).max(200)).max(8),
});

export const informativeExtractionSchema = z.object({
  isMissionRequest: z.boolean(),
  kind: z
    .enum(["new_client", "client_change", "client_closure", "general_task"])
    .nullable(),
  company: z.object({
    systemCode: nullableText(30),
    legalName: nullableText(200),
    cnpj: nullableText(20),
    taxRegime: z.enum(TAX_REGIMES).nullable(),
    city: nullableText(120),
    contact: nullableText(160),
    summary: nullableText(1200),
  }),
  tasks: z.array(informativeExtractionTaskSchema).max(30),
  ignoredNotes: z.array(z.string().trim().min(1).max(500)).max(30),
  warnings: z.array(z.string().trim().min(1).max(500)).max(20),
  missingFields: z
    .array(z.enum(["company", "actions", "responsible", "due_date"]))
    .max(4),
  /**
   * Combinado permanente do setor FISCAL (valores, Fator R etc.) — só
   * preenchido no cadastro de cliente novo (ver isNewClientOnboarding em
   * src/lib/ai/informative.ts). Fora desse caso fica sempre null.
   */
  fiscalNote: z
    .object({
      text: z.string().trim().min(1).max(1000),
      assignee: nullableText(200),
    })
    .nullable()
    .default(null),
});

export type InformativeExtraction = z.infer<typeof informativeExtractionSchema>;

/** "Att. FULANO" já confrontado com o diretório de membros da Guilda. */
const assigneeSuggestionSchema = z.object({
  rawName: z.string().min(1).max(200),
  userId: z.string().min(1).nullable(),
  name: z.string().min(1).max(200).nullable(),
});

export type AssigneeSuggestionPayload = z.infer<typeof assigneeSuggestionSchema>;

const draftTaskCoreSchema = informativeTaskCoreSchema.extend({
  sector: z.string().max(120).nullable(),
  suggestions: z.array(assigneeSuggestionSchema).max(8),
});

const individualDraftTaskSchema = draftTaskCoreSchema.extend({
  assignmentType: z.literal("individual"),
  assigneeId: z.string().min(1),
  assigneeName: z.string().min(1).max(200),
  clanId: z.string().uuid(),
  clanName: z.string().min(1).max(100),
});

const clanDraftTaskSchema = draftTaskCoreSchema.extend({
  assignmentType: z.literal("clan"),
  assigneeId: z.null(),
  assigneeName: z.null(),
  clanId: z.string().uuid(),
  clanName: z.string().min(1).max(100),
});

/**
 * Sem clã e sem nome reconhecido: a missão NÃO é criada até um humano
 * escolher o destino na prévia. Nunca adivinhar por proximidade com a linha
 * anterior.
 */
const pendingDraftTaskSchema = draftTaskCoreSchema.extend({
  assignmentType: z.literal("pending"),
  assigneeId: z.null(),
  assigneeName: z.null(),
  clanId: z.null(),
  clanName: z.null(),
  reason: z.string().min(1).max(300),
});

export const informativeDraftPayloadSchema = informativeExtractionSchema
  // fiscalNote é resolvido (suggestedFiscalOwnerId) e persistido só em
  // company.pendingFiscalNote — o payload não guarda o formato bruto da IA.
  .omit({ isMissionRequest: true, missingFields: true, fiscalNote: true })
  .extend({
    kind: z.enum(["new_client", "client_change", "client_closure", "general_task"]),
    sourceFormat: z.enum(["informative", "business_mission"]),
    company: informativeExtractionSchema.shape.company.extend({
      normalizedCnpj: z.string().regex(/^\d{14}$/).nullable(),
      clientId: z.string().uuid().nullable(),
      createClient: z.boolean(),
      // Só preenchidos pelo fluxo "Novo cliente" (consulta de CNPJ na
      // Receita) — null no caminho de texto livre. `.default(null)` (não só
      // `.nullable()`) porque prévias antigas já persistidas no banco nem
      // têm essas chaves no JSONB; sem o default, o parse dessas prévias
      // falharia e a página as trataria como inexistentes.
      cnaeCode: nullableText(10).default(null),
      cnaeDescription: nullableText(200).default(null),
      secondaryCnaes: z
        .array(z.object({ code: z.string(), description: z.string() }))
        .nullable()
        .default(null),
      openedAt: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable()
        .default(null),
      // Resolvidos a partir de fiscalNote — combinado do Fiscal e a pessoa
      // sugerida, pendentes até o líder confirmar a carteira (ver
      // src/app/(app)/clans/[id]/portfolio-actions.ts).
      pendingFiscalNote: z.string().trim().max(1000).nullable().default(null),
      suggestedFiscalOwnerId: z.string().min(1).nullable().default(null),
    }),
    tasks: z
      .array(
        z.union([
          individualDraftTaskSchema,
          clanDraftTaskSchema,
          pendingDraftTaskSchema,
        ]),
      )
      .max(60),
    /** Linhas do informativo que não são ação — corpo do aviso no mural. */
    observations: z.array(z.string().trim().min(1).max(500)).max(30),
    unresolvedAssignees: z.array(z.string().min(1).max(200)).max(30),
  });

export type InformativeDraftPayload = z.infer<typeof informativeDraftPayloadSchema>;
export type InformativeDraftTask = InformativeDraftPayload["tasks"][number];
