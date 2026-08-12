import { z } from "zod";

import { TAX_REGIMES } from "@/lib/clients-ui";

const nullableText = (max: number) => z.string().trim().max(max).nullable();

export const informativeExtractionSchema = z.object({
  kind: z.enum(["new_client", "client_change"]),
  company: z.object({
    systemCode: nullableText(30),
    legalName: z.string().trim().min(2).max(200),
    cnpj: nullableText(20),
    taxRegime: z.enum(TAX_REGIMES).nullable(),
    city: nullableText(120),
    contact: nullableText(160),
    summary: z.string().trim().min(1).max(1200),
  }),
  tasks: z
    .array(
      z.object({
        title: z.string().trim().min(3).max(200),
        description: z.string().trim().min(1).max(5000),
        assignees: z.array(z.string().trim().min(1).max(200)).min(1).max(8),
        priority: z.number().int().min(1).max(3),
        difficulty: z.number().int().min(1).max(5),
        dueDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable(),
        sourceSection: z.string().trim().min(1).max(1000),
      }),
    )
    .max(30),
  ignoredNotes: z.array(z.string().trim().min(1).max(500)).max(30),
  warnings: z.array(z.string().trim().min(1).max(500)).max(20),
});

export type InformativeExtraction = z.infer<typeof informativeExtractionSchema>;

export const informativeDraftPayloadSchema = informativeExtractionSchema.extend({
  company: informativeExtractionSchema.shape.company.extend({
    normalizedCnpj: z.string().regex(/^\d{14}$/).nullable(),
    clientId: z.string().uuid().nullable(),
    createClient: z.boolean(),
  }),
  tasks: z
    .array(
      informativeExtractionSchema.shape.tasks.element.omit({ assignees: true }).extend({
        assigneeId: z.string().min(1),
        assigneeName: z.string().min(1).max(200),
      }),
    )
    .max(60),
  unresolvedAssignees: z.array(z.string().min(1).max(200)).max(30),
});

export type InformativeDraftPayload = z.infer<typeof informativeDraftPayloadSchema>;
