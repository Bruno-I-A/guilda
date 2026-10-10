import { z } from "zod";

const digits = (length: number, label: string) =>
  z.string().regex(new RegExp(`^\\d{${length}}$`), `${label} deve ter ${length} dígitos.`);

/**
 * O modelo da nota de honorário do escritório: tudo que não muda de uma nota
 * para outra. Os campos espelham a DPS do leiaute nacional v1.01 e saem, na
 * etapa 3, do XML de uma nota já emitida no Portal.
 */
export const nfseTemplateSchema = z.object({
  cityCode: digits(7, "O código IBGE do município"),
  municipalRegistration: z.string().trim().min(1).max(15).optional(),
  taxRegime: z.object({
    opSimpNac: z.enum(["1", "2", "3"]),
    regApTribSN: z.enum(["1", "2", "3"]).optional(),
    regEspTrib: z.enum(["0", "1", "2", "3", "4", "5", "6", "9"]),
  }),
  service: z.object({
    nationalTaxCode: digits(6, "O código de tributação nacional"),
    municipalTaxCode: digits(3, "O código de tributação municipal").optional(),
    nbsCode: digits(9, "O código NBS").optional(),
  }),
  issqn: z.object({
    taxation: z.enum(["1", "2", "3", "4"]),
    withholding: z.enum(["1", "2", "3"]),
    rate: z.string().regex(/^(0|[0-9](\.[0-9]{2})?)$/, "Alíquota no formato 2.00.").optional(),
  }),
  totalTaxes: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("none") }),
    z.object({
      kind: z.literal("simples"),
      percent: z.string().regex(/^(0|0\.[0-9]{2}|[1-9][0-9]?(\.[0-9]{2})?)$/, "Percentual no formato 6.00."),
    }),
  ]),
  descriptions: z.object({
    monthly: z.string().trim().min(1).max(2000),
    additionalInstallment: z.string().trim().min(1).max(2000),
  }),
});

export type NfseTemplate = z.infer<typeof nfseTemplateSchema>;

export function parseNfseTemplate(value: unknown): NfseTemplate | null {
  const parsed = nfseTemplateSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
