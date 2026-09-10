/**
 * Observações dos Fechamentos (funções puras).
 *
 * A observação deixou de ser texto livre e virou item porque o texto não
 * respondia a pergunta que importa: isso ainda precisa de alguém? "Tem
 * rubricas para configurar" ficava parado no card sem estado, sem dono e sem
 * data — e quem faz as rubricas costuma ser de outra área, então o recado
 * dependia de alguém reparar nele.
 */

export const OBSERVATION_SCOPES = ["year", "defis", "closing"] as const;
export type ObservationScope = (typeof OBSERVATION_SCOPES)[number];

export const OBSERVATION_SCOPE_LABELS: Record<ObservationScope, string> = {
  year: "Fechamento anual",
  defis: "DEFIS",
  closing: "Período",
};

export function parseObservationScope(value: unknown): ObservationScope {
  return OBSERVATION_SCOPES.includes(value as ObservationScope)
    ? (value as ObservationScope)
    : "year";
}

/**
 * O estado de uma observação, derivado — nunca gravado.
 *
 *   open      escrita e ainda sem encaminhamento
 *   assigned  virou missão de alguém; a missão é que diz o andamento
 *   resolved  encerrada, com ou sem missão pelo caminho
 *
 * `resolved` vence `assigned` de propósito: resolver é a palavra final de quem
 * cuida do fechamento, mesmo que a missão gerada ainda esteja aberta (ela pode
 * ter sido cancelada, ou o assunto resolvido por fora).
 */
export type ObservationState = "open" | "assigned" | "resolved";

export interface ObservationFacts {
  taskId: string | null;
  resolvedAt: Date | null;
}

export function observationState(facts: ObservationFacts): ObservationState {
  if (facts.resolvedAt) return "resolved";
  return facts.taskId ? "assigned" : "open";
}

export const OBSERVATION_STATE_LABELS: Record<ObservationState, string> = {
  open: "Em aberto",
  assigned: "Virou missão",
  resolved: "Resolvida",
};

export interface ObservationSummary {
  total: number;
  open: number;
  assigned: number;
  resolved: number;
  /** Exige atenção: escrita e ainda sem encaminhamento nenhum. */
  pending: number;
}

export function summarizeObservations(
  observations: readonly ObservationFacts[],
): ObservationSummary {
  const summary: ObservationSummary = {
    total: observations.length,
    open: 0,
    assigned: 0,
    resolved: 0,
    pending: 0,
  };
  for (const observation of observations) {
    summary[observationState(observation)] += 1;
  }
  summary.pending = summary.open;
  return summary;
}

/**
 * O selo do card da empresa. Antes dizia só "observação" — a mesma palavra
 * para um recado já resolvido e para um pedido esperando alguém há um mês.
 */
export function observationBadge(
  summary: ObservationSummary,
): { label: string; tone: "idle" | "attention" } | null {
  if (summary.total === 0) return null;
  if (summary.pending > 0) {
    return {
      label:
        summary.pending === 1
          ? "1 observação em aberto"
          : `${summary.pending} observações em aberto`,
      tone: "attention",
    };
  }
  if (summary.assigned > 0) {
    return {
      label:
        summary.assigned === 1
          ? "1 virou missão"
          : `${summary.assigned} viraram missão`,
      tone: "idle",
    };
  }
  return { label: "observações resolvidas", tone: "idle" };
}

/**
 * Título sugerido para a missão gerada. A observação costuma ser uma frase
 * solta ("Tem rubricas para configurar em 30/08"); quem recebe a missão
 * precisa saber de que empresa se trata sem abrir nada.
 */
export function suggestedMissionTitle(input: {
  body: string;
  clientName: string;
  maxLength?: number;
}): string {
  const max = input.maxLength ?? 200;
  const corpo = input.body.trim().replace(/\s+/g, " ");
  const primeiraLinha = corpo.split(/[.\n]/)[0]?.trim() || corpo;
  const sufixo = ` — ${input.clientName}`;
  const espaco = Math.max(0, max - sufixo.length);
  const inicio =
    primeiraLinha.length > espaco
      ? `${primeiraLinha.slice(0, Math.max(0, espaco - 1)).trimEnd()}…`
      : primeiraLinha;
  return `${inicio}${sufixo}`.slice(0, max);
}
