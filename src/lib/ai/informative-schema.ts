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

const informativeExtractionTaskSchema = z.discriminatedUnion("assignmentType", [
  informativeTaskCoreSchema.extend({
    assignmentType: z.literal("individual"),
    assignees: z.array(z.string().trim().min(1).max(200)).max(8),
    clanName: z.null(),
  }),
  informativeTaskCoreSchema.extend({
    assignmentType: z.literal("clan"),
    assignees: z.array(z.string().trim().min(1).max(200)).max(0),
    clanName: z.string().trim().min(1).max(100),
  }),
]);

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
  tasks: z
    .array(informativeExtractionTaskSchema)
    .max(30),
  ignoredNotes: z.array(z.string().trim().min(1).max(500)).max(30),
  warnings: z.array(z.string().trim().min(1).max(500)).max(20),
  missingFields: z
    .array(z.enum(["company", "actions", "responsible", "due_date"]))
    .max(4),
});

export type InformativeExtraction = z.infer<typeof informativeExtractionSchema>;

const individualDraftTaskSchema = informativeTaskCoreSchema.extend({
  // Rascunhos individuais gerados antes do discriminador continuam válidos.
  assignmentType: z.literal("individual").default("individual"),
  assigneeId: z.string().min(1),
  assigneeName: z.string().min(1).max(200),
  clanId: z.string().uuid(),
  clanName: z.string().min(1).max(100),
});

const clanDraftTaskSchema = informativeTaskCoreSchema.extend({
  assignmentType: z.literal("clan"),
  assigneeId: z.null(),
  assigneeName: z.null(),
  clanId: z.string().uuid(),
  clanName: z.string().min(1).max(100),
});

export const informativeDraftPayloadSchema = informativeExtractionSchema
  .omit({ isMissionRequest: true, missingFields: true })
  .extend({
    kind: z.enum(["new_client", "client_change", "client_closure", "general_task"]),
    sourceFormat: z.enum(["informative", "business_mission"]),
    company: informativeExtractionSchema.shape.company.extend({
      normalizedCnpj: z.string().regex(/^\d{14}$/).nullable(),
      clientId: z.string().uuid().nullable(),
      createClient: z.boolean(),
    }),
    tasks: z
      .array(z.union([individualDraftTaskSchema, clanDraftTaskSchema]))
      .max(60),
    unresolvedAssignees: z.array(z.string().min(1).max(200)).max(30),
  });

export type InformativeDraftPayload = z.infer<typeof informativeDraftPayloadSchema>;
