import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import { informativeExtractionSchema, type InformativeExtraction } from "./informative-schema";

/**
 * A IA às vezes devolve texto vazio onde o esquema pede ao menos uma letra
 * (descrição, trecho de origem, item de lista). A validação estrita do SDK
 * recusava a resposta inteira e o pedido não saía: foi o que travou o
 * primeiro pedido de missão pelo WhatsApp (2026-11-24, "too_small",
 * mínimo 1). Aqui a resposta é limpa antes de validar: vazio vira nulo onde
 * o campo aceita, a descrição e o trecho vazios herdam o título, item vazio
 * de lista sai e texto longo demais é cortado. Missão sem título legível sai
 * da lista em vez de derrubar o resto.
 */

type Raw = Record<string, unknown>;

function record(value: unknown): Raw | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : null;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  return clean ? clean.slice(0, max) : null;
}

function texts(value: unknown, max: number, limit: number): string[] {
  return Array.isArray(value)
    ? value.map((item) => text(item, max)).filter((item): item is string => item !== null).slice(0, limit)
    : [];
}

function normalizeTask(value: unknown): Raw | null {
  const task = record(value);
  if (!task) return null;
  const title = text(task.title, 200);
  if (!title || title.length < 3) return null;
  return {
    ...task,
    title,
    description: text(task.description, 5000) ?? title,
    sourceSection: text(task.sourceSection, 1000) ?? title,
    sector: text(task.sector, 120),
    assignees: texts(task.assignees, 200, 8),
    dueDate: typeof task.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(task.dueDate.trim()) ? task.dueDate.trim() : null,
  };
}

function normalizeCommitment(value: unknown): Raw | null {
  const commitment = record(value);
  const title = text(commitment?.title, 200);
  if (!commitment || !title || title.length < 3) return null;
  return { ...commitment, title, sector: text(commitment.sector, 120), notes: text(commitment.notes, 1000) };
}

export function normalizeInformativeExtraction(value: unknown): unknown {
  const raw = record(value);
  if (!raw) return value;
  const company = record(raw.company) ?? {};
  const fiscalNote = record(raw.fiscalNote);
  const fiscalText = text(fiscalNote?.text, 1000);
  return {
    ...raw,
    company: {
      ...company,
      systemCode: text(company.systemCode, 30),
      legalName: text(company.legalName, 200),
      cnpj: text(company.cnpj, 20),
      city: text(company.city, 120),
      contact: text(company.contact, 160),
      summary: text(company.summary, 1200),
      taxRegime: company.taxRegime ?? null,
    },
    tasks: Array.isArray(raw.tasks) ? raw.tasks.map(normalizeTask).filter((task): task is Raw => task !== null).slice(0, 30) : [],
    ignoredNotes: texts(raw.ignoredNotes, 500, 30),
    warnings: texts(raw.warnings, 500, 20),
    missingFields: Array.isArray(raw.missingFields) ? raw.missingFields.slice(0, 4) : [],
    fiscalNote: fiscalText ? { text: fiscalText, assignee: text(fiscalNote?.assignee, 200) } : null,
    commitments: Array.isArray(raw.commitments) ? raw.commitments.map(normalizeCommitment).filter((item): item is Raw => item !== null).slice(0, 10) : [],
  };
}

/** O formato do SDK (mesmo esquema enviado à IA) com a limpeza antes da validação. */
export function informativeOutputFormat() {
  const base = zodOutputFormat(informativeExtractionSchema);
  return {
    ...base,
    parse(content: string): InformativeExtraction {
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        throw new Error("A IA devolveu uma resposta que não é JSON.");
      }
      const output = informativeExtractionSchema.safeParse(normalizeInformativeExtraction(parsed));
      if (!output.success) {
        const issues = output.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".") || "resposta"}: ${issue.message}`).join("; ");
        throw new Error(`A IA devolveu um formato inesperado (${issues}).`);
      }
      return output.data;
    },
  };
}
