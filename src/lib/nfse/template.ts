import { z } from "zod";

const digits = (length: number, label: string) =>
  z.string().regex(new RegExp(`^\\d{${length}}$`), `${label} deve ter ${length} dígitos.`);

const percent = (label: string) =>
  z.string().regex(/^(0|0\.[0-9]{2}|[1-9][0-9]?(\.[0-9]{2})?)$/, `${label} no formato 6.00.`);

/**
 * O modelo fiscal de quem emite: tudo que não muda de uma nota para outra. Os
 * campos espelham a DPS do leiaute nacional v1.01. Serve ao escritório (nota
 * de honorário) e às empresas-cliente (aba Notas dos clientes).
 */
export const nfseIssuerTemplateSchema = z.object({
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
    z.object({ kind: z.literal("simples"), percent: percent("Percentual") }),
    // Não optante do Simples: percentual aproximado por esfera (pTotTrib).
    z.object({
      kind: z.literal("percent"),
      federal: percent("Percentual federal"),
      state: percent("Percentual estadual"),
      municipal: percent("Percentual municipal"),
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
      /** tpOper: quando o pagamento ocorre em relação ao serviço (E0903). */
      operationType: z.enum(["1", "2", "3", "4", "5"]).optional(),
    })
    .optional(),
  /**
   * Retenções federais já calculadas para ESTA nota (tribFed). Só existe no
   * modelo congelado no pedido; o modelo da empresa não leva valores.
   */
  federal: z
    .object({
      cpCents: z.number().int().positive().optional(),
      irrfCents: z.number().int().positive().optional(),
      csllCents: z.number().int().positive().optional(),
      pisCofins: z
        .object({
          cst: digits(2, "O CST do PIS/COFINS"),
          baseCents: z.number().int().positive(),
          pisPercent: z.string(),
          cofinsPercent: z.string(),
          pisCents: z.number().int().nonnegative(),
          cofinsCents: z.number().int().nonnegative(),
          retention: z.enum(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]),
        })
        .optional(),
    })
    .optional(),
});

/** O modelo da nota de honorário do escritório: o fiscal mais as descrições. */
export const nfseTemplateSchema = nfseIssuerTemplateSchema.extend({
  descriptions: z.object({
    monthly: z.string().trim().min(1).max(2000),
    additionalInstallment: z.string().trim().min(1).max(2000),
  }),
});

/** Itens da LC 116 em que a nota com IBS/CBS precisa do tipo de operação (E0903). */
const OPERATION_TYPE_SERVICES = new Set(["1005", "1509", "1712", "2505"]);

export function nfseServiceRequiresOperationType(nationalTaxCode: string): boolean {
  return OPERATION_TYPE_SERVICES.has(nationalTaxCode.slice(0, 4));
}

export const NFSE_OPERATION_TYPE_REQUIRED = "Este serviço exige o tipo de operação: informe nos dados fiscais da empresa, em Reforma tributária.";

/**
 * Regras do leiaute que o tipo sozinho não pega e que o Sistema Nacional
 * recusa (Anexo I): ME/EPP não pode usar "não informar tributos" (E0712), MEI
 * não pode usar o percentual do Simples (E0710) e não optante informa os
 * tributos por esfera (E0713).
 */
function checkTaxRules(template: z.infer<typeof nfseIssuerTemplateSchema>, ctx: z.RefinementCtx): void {
  if (template.ibsCbs && !template.ibsCbs.operationType && nfseServiceRequiresOperationType(template.service.nationalTaxCode)) {
    ctx.addIssue({ code: "custom", path: ["ibsCbs"], message: NFSE_OPERATION_TYPE_REQUIRED });
  }
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
  if (template.taxRegime.opSimpNac === "1" && kind !== "percent") {
    ctx.addIssue({
      code: "custom",
      path: ["totalTaxes"],
      message: "Para não optante do Simples, informe os percentuais aproximados de tributos federais, estaduais e municipais.",
    });
  }
}

export const nfseTemplateRulesSchema = nfseTemplateSchema.superRefine(checkTaxRules);

/** Empresa-cliente emissora: MEI fica fora (não usa certificado na Guilda). */
export const nfseIssuerTemplateRulesSchema = nfseIssuerTemplateSchema.superRefine((template, ctx) => {
  checkTaxRules(template, ctx);
  if (template.taxRegime.opSimpNac === "2") {
    ctx.addIssue({ code: "custom", path: ["taxRegime"], message: "MEI não emite pela aba Notas dos clientes." });
  }
});

export type NfseIssuerTemplate = z.infer<typeof nfseIssuerTemplateSchema>;
export type NfseTemplate = z.infer<typeof nfseTemplateSchema>;

export function parseNfseTemplate(value: unknown): NfseTemplate | null {
  const parsed = nfseTemplateSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseNfseIssuerTemplate(value: unknown): NfseIssuerTemplate | null {
  const parsed = nfseIssuerTemplateSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
