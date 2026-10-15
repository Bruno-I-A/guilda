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
  /**
   * Reforma tributária (IBS/CBS): o Emissor Nacional já preenche este grupo
   * nas notas do escritório (nota 104 de 08/10/2026: indicador 100301, CST 200,
   * cClassTrib 200052 — redução de 30% de profissão regulamentada). As
   * alíquotas o próprio Sistema Nacional calcula; aqui vão só os códigos.
   */
  ibsCbs: z
    .object({
      operationIndicator: digits(6, "O indicador de operação"),
      cst: digits(3, "O CST do IBS/CBS"),
      classification: digits(6, "A classificação tributária"),
    })
    .optional(),
  descriptions: z.object({
    monthly: z.string().trim().min(1).max(2000),
    additionalInstallment: z.string().trim().min(1).max(2000),
  }),
});

/**
 * Regras do leiaute que o tipo sozinho não pega e que o Sistema Nacional
 * recusa (Anexo I): ME/EPP não pode usar "não informar tributos" (E0712) e
 * MEI não pode usar o percentual do Simples (E0710). Não optante exigiria
 * valores por esfera (vTotTrib/pTotTrib), que o modelo ainda não tem (E0713).
 */
export const nfseTemplateRulesSchema = nfseTemplateSchema.superRefine((template, ctx) => {
  const kind = template.totalTaxes.kind;
  if (template.taxRegime.opSimpNac === "3" && kind !== "simples") {
    ctx.addIssue({
      code: "custom",
      path: ["totalTaxes"],
      message: "Para ME/EPP do Simples, informe o percentual aproximado do Simples Nacional em \"Total de tributos\".",
    });
  }
  if (template.taxRegime.opSimpNac === "2" && kind === "simples") {
    ctx.addIssue({ code: "custom", path: ["totalTaxes"], message: "MEI não pode informar o percentual do Simples Nacional." });
  }
  if (template.taxRegime.opSimpNac === "1") {
    ctx.addIssue({
      code: "custom",
      path: ["taxRegime"],
      message: "Escritório não optante do Simples ainda não é suportado: a nota exigiria os tributos por esfera.",
    });
  }
});

export type NfseTemplate = z.infer<typeof nfseTemplateSchema>;

export function parseNfseTemplate(value: unknown): NfseTemplate | null {
  const parsed = nfseTemplateSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
