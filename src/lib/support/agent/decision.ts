/**
 * Regras do turno do agente no teste (2026-11-19), na ordem do pipeline do
 * Scharff, que já atendeu cliente real: sem assunto, pergunta o assunto uma
 * vez; resposta da base; pergunta de esclarecimento (teto de 3); senão
 * encaminha ao clã. Pura: a gravação e as travas de estado ficam em turn.ts.
 */
import { ALWAYS_OPEN, openingPhrase, type HoursNow } from "@/domain/business-hours";
import { APP_TIME_ZONE } from "@/lib/date-time";

import { MARCADOR_PERGUNTA_ESCLARECIMENTO, type ResultadoClassificacao, type SetorValido } from "../triage/classificacao";
import { ehSaudacaoSemAssunto } from "../triage/contexto";
import { clanForSector, SECTOR_LABELS } from "../triage/sectors";

/** Leituras por rodada; passou disso, encaminha. */
export const AGENT_TURN_CAP = 6;
export const ASK_SUBJECT_TEXT = "Para eu te ajudar da melhor forma, pode me contar em poucas palavras qual é o assunto?";
/** Falha da chamada (não incerteza): encaminha na hora, como no Scharff. */
export const AI_FAILURE_REASONS: ReadonlySet<string> = new Set(["erro_api", "sem_api_key", "resposta_sem_tool_use"]);

export type AgentHandoffReason = "classified" | "ai_failure" | "turn_cap";
export type AgentDecision =
  | { kind: "wait" }
  | { kind: "ask_subject" | "answer" | "clarify"; text: string }
  | {
      kind: "handoff";
      text: string;
      sector: SetorValido;
      clanId: string | null;
      clanName: string | null;
      summary: string;
      reason: AgentHandoffReason;
      /** Pessoa (ou "carteira") que a IA indicou pelo assunto; quem decide é routing.ts. */
      suggestedAttendant: string | null;
    };

/** O que cada leitura da rodada fez, gravado em support_ai_runs.result.agent. */
export type AgentRunRecord = { kind: string; asked: boolean; discarded: string | null };
export type RoundFacts = { aiSpoke: boolean; askedSubject: boolean; questionsAsked: number; lastKind: string | null };
type Clan = { id: string; name: string; slug: string };

export function roundFacts(runs: readonly AgentRunRecord[]): RoundFacts {
  const spoken = runs.filter((run) => !run.discarded && run.kind !== "wait");
  return {
    aiSpoke: spoken.length > 0,
    askedSubject: spoken.some((run) => run.kind === "ask_subject"),
    questionsAsked: spoken.filter((run) => run.asked).length,
    lastKind: spoken.at(-1)?.kind ?? null,
  };
}

/** A fala leva uma pergunta de esclarecimento (conta para o teto de 3). */
export function askedQuestion(decision: AgentDecision): boolean {
  return decision.kind === "clarify" || (decision.kind === "answer" && decision.text.includes(MARCADOR_PERGUNTA_ESCLARECIMENTO));
}

export function greetingForHour(hour: number): "Bom dia" | "Boa tarde" | "Boa noite" {
  if (hour >= 5 && hour < 12) return "Bom dia";
  if (hour >= 12 && hour < 18) return "Boa tarde";
  return "Boa noite";
}

function hourInBrasilia(now: Date): number {
  const hour = new Intl.DateTimeFormat("en-US", { timeZone: APP_TIME_ZONE, hour: "2-digit", hourCycle: "h23" })
    .formatToParts(now)
    .find((part) => part.type === "hour")?.value;
  return Number.parseInt(hour ?? "0", 10);
}

const OUT_OF_HOURS = "Estamos fora do horário de atendimento";

function greeting(now: Date): string {
  return `${greetingForHour(hourInBrasilia(now))}!`;
}

/**
 * Cumprimenta só na primeira fala da rodada, sem nome (o do perfil nem sempre é
 * real). Fora do expediente (2026-11-23) a primeira fala diz quando a equipe volta.
 */
function opening(facts: RoundFacts, now: Date, hours: HoursNow): string {
  if (facts.aiSpoke) return "";
  if (hours.open) return `${greeting(now)} `;
  return `${greeting(now)} ${OUT_OF_HOURS} e a equipe retorna ${openingPhrase(hours.nextOpening, now)}. Enquanto isso, já adianto seu atendimento. `;
}

function handoff(input: {
  sector: SetorValido;
  summary: string;
  reason: AgentHandoffReason;
  clans: readonly Clan[];
  facts: RoundFacts;
  now: Date;
  hours: HoursNow;
  suggestedAttendant?: string | null;
}): AgentDecision {
  const clan = input.reason === "classified" ? clanForSector(input.sector, input.clans) : null;
  const back = openingPhrase(input.hours.nextOpening, input.now);
  let start: string;
  let where: string;
  if (input.hours.open) {
    start = opening(input.facts, input.now, input.hours);
    where = clan
      ? `Encaminhei ao setor ${SECTOR_LABELS[input.sector]}. Uma pessoa da equipe continua o atendimento por aqui.`
      : "Encaminhei para a nossa equipe. Uma pessoa continua o atendimento por aqui.";
  } else {
    // A volta da equipe vai no encaminhamento; na primeira fala, o aviso não se repete.
    start = input.facts.aiSpoke ? "" : `${greeting(input.now)} ${OUT_OF_HOURS}. `;
    where = clan
      ? `Encaminhei ao setor ${SECTOR_LABELS[input.sector]}. A equipe retorna ${back} e continua daqui.`
      : `Encaminhei para a nossa equipe, que retorna ${back} e continua daqui.`;
  }
  return {
    kind: "handoff",
    text: `${start}${where}`,
    sector: input.sector,
    clanId: clan?.id ?? null,
    clanName: clan?.name ?? null,
    summary: input.summary,
    reason: input.reason,
    suggestedAttendant: clan ? (input.suggestedAttendant ?? null) : null,
  };
}

/** Antes da IA: teto da rodada e mensagem sem assunto não gastam leitura. */
export function decideBeforeClassifying(input: {
  current: string;
  facts: RoundFacts;
  runsInRound: number;
  clans: readonly Clan[];
  now: Date;
  /** Expediente agora; sem ele, conta como aberto (o texto de sempre). */
  hours?: HoursNow;
}): AgentDecision | null {
  const hours = input.hours ?? ALWAYS_OPEN;
  if (input.runsInRound >= AGENT_TURN_CAP) {
    return handoff({ sector: "outro", summary: "", reason: "turn_cap", clans: input.clans, facts: input.facts, now: input.now, hours });
  }
  if (ehSaudacaoSemAssunto(input.current)) {
    return input.facts.askedSubject
      ? { kind: "wait" }
      : { kind: "ask_subject", text: `${opening(input.facts, input.now, hours)}${ASK_SUBJECT_TEXT}` };
  }
  return null;
}

export function decideAfterClassifying(input: {
  result: ResultadoClassificacao;
  facts: RoundFacts;
  clans: readonly Clan[];
  now: Date;
  hours?: HoursNow;
}): AgentDecision {
  const hours = input.hours ?? ALWAYS_OPEN;
  const { classificacao, respostaDireta, perguntaEsclarecimento } = input.result;
  const fallback = classificacao.fallback?.motivo ?? null;
  const start = opening(input.facts, input.now, hours);
  if (fallback && AI_FAILURE_REASONS.has(fallback)) {
    return handoff({ sector: "outro", summary: "", reason: "ai_failure", clans: input.clans, facts: input.facts, now: input.now, hours });
  }
  if (respostaDireta) {
    const question = perguntaEsclarecimento ? `\n\n${MARCADOR_PERGUNTA_ESCLARECIMENTO} ${perguntaEsclarecimento}` : "";
    return { kind: "answer", text: `${start}${respostaDireta}${question}` };
  }
  if (perguntaEsclarecimento) {
    return { kind: "clarify", text: `${start}${MARCADOR_PERGUNTA_ESCLARECIMENTO} ${perguntaEsclarecimento}` };
  }
  if (fallback === "confianca_baixa") {
    if (!input.facts.aiSpoke) return { kind: "ask_subject", text: `${start}${ASK_SUBJECT_TEXT}` };
    // "ok, obrigado" depois de uma resposta: não há o que encaminhar.
    if (input.facts.lastKind === "answer") return { kind: "wait" };
  }
  return handoff({
    sector: classificacao.setor_sugerido,
    summary: classificacao.resumo,
    reason: "classified",
    clans: input.clans,
    facts: input.facts,
    now: input.now,
    hours,
    suggestedAttendant: classificacao.atendente_sugerido ?? null,
  });
}
