import { expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  classificarMensagem,
  type OpcoesClassificacao,
} from "./classificacao";
import type { SupportKnowledgeSource } from "./knowledge";

const SOURCE: SupportKnowledgeSource = {
  id: "kb-prazo",
  title: "Prazo aprovado",
  question: "Qual e o prazo?",
  answer: "O prazo aprovado e de dois dias uteis.",
  sector: "fiscal",
  keywords: ["prazo"],
  version: 4,
};

function fakeAnthropic(fontesIds: string[]) {
  return {
    messages: {
      create: async () => ({
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "tool-1",
            name: "classificar_triagem",
            input: {
              setor_sugerido: "fiscal",
              urgencia: "baixa",
              confianca: 0.95,
              resumo: "Cliente pergunta o prazo",
              resposta_direta: "O prazo e de dois dias uteis.",
              fontes_ids: fontesIds,
            },
          },
        ],
        usage: { input_tokens: 10, output_tokens: 8 },
      }),
    },
  } as unknown as NonNullable<OpcoesClassificacao["anthropic"]>;
}

test("descarta resposta direta que nao cita fonte recuperada", async () => {
  const result = await classificarMensagem("Qual e o prazo?", [], [], 0, null, {
    modelo: "teste",
    knowledge: [SOURCE],
    anthropic: fakeAnthropic(["fonte-inventada"]),
  });

  expect(result.respostaDireta).toBeNull();
  expect(result.fontesConhecimento).toEqual([]);
});

test("preserva resposta sustentada por fonte valida com id e versao", async () => {
  const result = await classificarMensagem("Qual e o prazo?", [], [], 0, null, {
    modelo: "teste",
    knowledge: [SOURCE],
    anthropic: fakeAnthropic([SOURCE.id]),
  });

  expect(result.respostaDireta).toBe("O prazo e de dois dias uteis.");
  expect(result.fontesConhecimento).toEqual([
    { id: SOURCE.id, title: SOURCE.title, version: SOURCE.version },
  ]);
});
