/**
 * Teste do agente no WhatsApp (decisão de 2026-11-19): uma palavra-chave no
 * começo da mensagem do cliente abre uma rodada em que a IA conversa de
 * verdade. Puro, para ser testado sem banco.
 */

function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR");
}

/** Uma palavra só, de 3 a 40 letras ou números, sem acento: é o que o banco aceita. */
export function normalizeTestKeyword(value: unknown): string | null {
  const folded = fold(String(value ?? "").trim());
  return /^[a-z0-9]{3,40}$/.test(folded) ? folded : null;
}

/**
 * A palavra abre a rodada só como primeiro termo da mensagem: "Batata, preciso
 * da guia" abre e devolve "preciso da guia"; "quero batata" não abre.
 */
export function matchTestKeyword(text: string | null, keyword: string | null): { matched: boolean; rest: string } {
  const original = text ?? "";
  if (!keyword) return { matched: false, rest: original };
  const first = /^\s*([\p{L}\p{N}]+)/u.exec(original);
  if (!first || fold(first[1]) !== keyword) return { matched: false, rest: original };
  return { matched: true, rest: original.slice(first[0].length).replace(/^[\s\p{P}]+/u, "") };
}

/** Modo do agente (2026-11-23): desligado, só teste (palavra-chave) ou todos os clientes. */
export type AgentMode = "off" | "test" | "live";
export const AGENT_MODES = ["off", "test", "live"] as const satisfies readonly AgentMode[];

/**
 * Mensagem da IA só sai à Meta com o agente ligado (teste ou todos), dentro
 * da rodada que a gerou e sem pessoa no comando. Devolve o motivo, ou null.
 */
export function agentDeliveryBlock(input: {
  payloadRound: unknown;
  roundStartedAt: Date | null;
  status: string;
  mode: AgentMode;
}): string | null {
  if (input.mode === "off") return "Agente de IA desligado: a mensagem da IA ficou na Guilda.";
  const round = typeof input.payloadRound === "string" ? new Date(input.payloadRound).getTime() : Number.NaN;
  if (!input.roundStartedAt || round !== input.roundStartedAt.getTime()) {
    return "Mensagem da IA fora da rodada do agente: ficou na Guilda.";
  }
  if (input.status === "human_active" || input.status === "resolved") {
    return "Uma pessoa assumiu a conversa: a mensagem da IA ficou na Guilda.";
  }
  return null;
}
