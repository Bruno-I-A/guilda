import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ResultadoClassificacao, SetorValido } from "../triage/classificacao";
import {
  AGENT_TURN_CAP,
  ASK_SUBJECT_TEXT,
  askedQuestion,
  decideAfterClassifying,
  decideBeforeClassifying,
  greetingForHour,
  roundFacts,
  type RoundFacts,
} from "./decision";

const NOW = new Date("2026-11-19T12:00:00Z"); // 09:00 em Brasília
const CLANS = [{ id: "clan-fiscal", name: "Fiscal", slug: "fiscal" }];
const FIRST: RoundFacts = { aiSpoke: false, askedSubject: false, questionsAsked: 0, lastKind: null };
const SPOKE: RoundFacts = { aiSpoke: true, askedSubject: false, questionsAsked: 1, lastKind: "clarify" };

function result(partial: {
  setor?: SetorValido;
  confianca?: number;
  fallback?: string;
  perguntaEsclarecimento?: string;
  respostaDireta?: string;
}): ResultadoClassificacao {
  return {
    classificacao: {
      setor_sugerido: partial.setor ?? "fiscal",
      urgencia: "media",
      confianca: partial.confianca ?? 0.9,
      resumo: "Cliente pede a guia do DAS",
      ...(partial.fallback ? { fallback: { motivo: partial.fallback } } : {}),
    },
    perguntaEsclarecimento: partial.perguntaEsclarecimento ?? null,
    respostaDireta: partial.respostaDireta ?? null,
    fontesConhecimento: [],
    modelo: "teste",
    tokensEntrada: 1,
    tokensSaida: 1,
  };
}

describe("fatos da rodada", () => {
  test("ignora descartadas e esperas, conta perguntas e guarda a última fala", () => {
    expect(roundFacts([])).toEqual(FIRST);
    expect(
      roundFacts([
        { kind: "ask_subject", asked: false, discarded: null },
        { kind: "clarify", asked: true, discarded: "nova_mensagem" },
        { kind: "wait", asked: false, discarded: null },
        { kind: "answer", asked: true, discarded: null },
      ]),
    ).toEqual({ aiSpoke: true, askedSubject: true, questionsAsked: 1, lastKind: "answer" });
  });

  test("cumprimento pelo horário", () => {
    expect(greetingForHour(9)).toBe("Bom dia");
    expect(greetingForHour(14)).toBe("Boa tarde");
    expect(greetingForHour(20)).toBe("Boa noite");
    expect(greetingForHour(3)).toBe("Boa noite");
  });
});

describe("antes de chamar a IA", () => {
  test("só a palavra ou um oi: cumprimenta e pergunta o assunto uma vez", () => {
    expect(decideBeforeClassifying({ current: "", facts: FIRST, runsInRound: 0, clans: CLANS, now: NOW })).toEqual({
      kind: "ask_subject",
      text: `Bom dia! ${ASK_SUBJECT_TEXT}`,
    });
    expect(
      decideBeforeClassifying({
        current: "oi, tudo bem?",
        facts: { ...FIRST, aiSpoke: true, askedSubject: true, lastKind: "ask_subject" },
        runsInRound: 1,
        clans: CLANS,
        now: NOW,
      }),
    ).toEqual({ kind: "wait" });
  });

  test("pedido com assunto vai para a IA", () => {
    expect(decideBeforeClassifying({ current: "preciso da guia do DAS", facts: FIRST, runsInRound: 0, clans: CLANS, now: NOW })).toBeNull();
  });

  test("no teto da rodada encaminha para a equipe sem chamar a IA", () => {
    expect(
      decideBeforeClassifying({ current: "preciso da guia", facts: SPOKE, runsInRound: AGENT_TURN_CAP, clans: CLANS, now: NOW }),
    ).toMatchObject({
      kind: "handoff",
      reason: "turn_cap",
      clanId: null,
      text: "Encaminhei para a nossa equipe. Uma pessoa continua o atendimento por aqui.",
    });
  });
});

describe("depois da leitura", () => {
  test("resposta da base, com a pergunta junto quando houver", () => {
    expect(
      decideAfterClassifying({ result: result({ respostaDireta: "O certificado A1 custa R$ 150." }), facts: FIRST, clans: CLANS, now: NOW }),
    ).toEqual({ kind: "answer", text: "Bom dia! O certificado A1 custa R$ 150." });
    const both = decideAfterClassifying({
      result: result({ respostaDireta: "Custa R$ 150.", perguntaEsclarecimento: "Prefere presencial ou por vídeo?" }),
      facts: SPOKE,
      clans: CLANS,
      now: NOW,
    });
    expect(both).toEqual({ kind: "answer", text: "Custa R$ 150.\n\nSó preciso confirmar: Prefere presencial ou por vídeo?" });
    expect(askedQuestion(both)).toBe(true);
    expect(askedQuestion({ kind: "answer", text: "Custa R$ 150." })).toBe(false);
  });

  test("pergunta de esclarecimento", () => {
    const decision = decideAfterClassifying({ result: result({ perguntaEsclarecimento: "De qual empresa?" }), facts: FIRST, clans: CLANS, now: NOW });
    expect(decision).toEqual({ kind: "clarify", text: "Bom dia! Só preciso confirmar: De qual empresa?" });
    expect(askedQuestion(decision)).toBe(true);
  });

  test("confiança baixa: pergunta o assunto na primeira fala, espera depois de uma resposta, encaminha no resto", () => {
    const vague = result({ setor: "outro", confianca: 0.2, fallback: "confianca_baixa" });
    expect(decideAfterClassifying({ result: vague, facts: FIRST, clans: CLANS, now: NOW })).toEqual({
      kind: "ask_subject",
      text: `Bom dia! ${ASK_SUBJECT_TEXT}`,
    });
    expect(decideAfterClassifying({ result: vague, facts: { ...SPOKE, lastKind: "answer" }, clans: CLANS, now: NOW })).toEqual({ kind: "wait" });
    expect(decideAfterClassifying({ result: vague, facts: SPOKE, clans: CLANS, now: NOW })).toMatchObject({
      kind: "handoff",
      reason: "classified",
      clanId: null,
    });
  });

  test("encaminha ao clã do setor, sem cumprimento depois da primeira fala", () => {
    expect(decideAfterClassifying({ result: result({}), facts: SPOKE, clans: CLANS, now: NOW })).toEqual({
      kind: "handoff",
      text: "Encaminhei ao setor Fiscal. Uma pessoa da equipe continua o atendimento por aqui.",
      sector: "fiscal",
      clanId: "clan-fiscal",
      clanName: "Fiscal",
      summary: "Cliente pede a guia do DAS",
      reason: "classified",
      suggestedAttendant: null,
    });
  });

  test("leva a pessoa que a IA indicou pelo assunto, só quando há clã", () => {
    const withPerson = { ...result({}), classificacao: { ...result({}).classificacao, atendente_sugerido: "maria" } };
    expect(decideAfterClassifying({ result: withPerson, facts: SPOKE, clans: CLANS, now: NOW })).toMatchObject({ kind: "handoff", suggestedAttendant: "maria" });
    const noClan = { ...withPerson, classificacao: { ...withPerson.classificacao, setor_sugerido: "contabil" as const } };
    expect(decideAfterClassifying({ result: noClan, facts: SPOKE, clans: CLANS, now: NOW })).toMatchObject({ kind: "handoff", clanId: null, suggestedAttendant: null });
  });

  test("setor sem clã vai para a equipe", () => {
    expect(decideAfterClassifying({ result: result({ setor: "contabil" }), facts: FIRST, clans: CLANS, now: NOW })).toMatchObject({
      kind: "handoff",
      clanId: null,
      text: "Bom dia! Encaminhei para a nossa equipe. Uma pessoa continua o atendimento por aqui.",
    });
  });

  test("falha da IA encaminha para a equipe e nunca prende a conversa", () => {
    for (const motivo of ["erro_api", "sem_api_key", "resposta_sem_tool_use"]) {
      expect(
        decideAfterClassifying({
          result: result({ setor: "outro", confianca: 0, fallback: motivo, respostaDireta: "x" }),
          facts: SPOKE,
          clans: CLANS,
          now: NOW,
        }),
      ).toMatchObject({ kind: "handoff", reason: "ai_failure", clanId: null });
    }
  });
});
