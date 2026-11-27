import assert from "node:assert/strict";
import { test, vi } from "vitest";

vi.mock("server-only", () => ({}));
import {
  LIMITE_PERGUNTAS_ESCLARECIMENTO,
  aplicarGuardaEsclarecimento,
  aplicarGuardaRespostaDireta,
  montarSystemPrompt,
} from "./classificacao";

test("o prompt usa apenas o estado mínimo do vínculo para desambiguar a empresa", () => {
  const prompt = montarSystemPrompt([], 0, false, [], "conversa", {
    empresaSelecionada: false,
    quantidadeEmpresasVinculadas: 2,
  });
  assert.match(prompt, /quantidadeEmpresasVinculadas\":2/);
  assert.ok(prompt.includes("Nao escolha por suposicao"));
  assert.ok(prompt.includes("nao presuma qual empresa e nem peca CNPJ"));
  assert.doesNotMatch(prompt, /CNPJ.*\d{8}/);

  const selectedPrompt = montarSystemPrompt([], 0, false, [], "conversa", {
    empresaSelecionada: true,
    quantidadeEmpresasVinculadas: 1,
  });
  assert.ok(selectedPrompt.includes("nao pergunte de qual empresa sem um conflito claro"));
});

test("aplicarGuardaEsclarecimento aceita perguntas enquanto o teto não é atingido", () => {
  assert.equal(
    aplicarGuardaEsclarecimento("É para pessoa física ou jurídica?", 0),
    "É para pessoa física ou jurídica?",
  );
  assert.equal(
    aplicarGuardaEsclarecimento("Presencial ou por videoconferência?", 1),
    "Presencial ou por videoconferência?",
    "a 2ª pergunta passou a ser permitida em 28/07/2026 (antes o teto era 1)",
  );
});

test("aplicarGuardaEsclarecimento descarta qualquer pergunta ao atingir o teto", () => {
  assert.equal(
    aplicarGuardaEsclarecimento("Ainda falta saber se é PF ou PJ", LIMITE_PERGUNTAS_ESCLARECIMENTO),
    null,
  );
  assert.equal(
    aplicarGuardaEsclarecimento("qualquer coisa", LIMITE_PERGUNTAS_ESCLARECIMENTO + 5),
    null,
    "acima do teto também trava — a IA pode ignorar a instrução do prompt",
  );
});

test("aplicarGuardaEsclarecimento apara espaços em branco", () => {
  assert.equal(aplicarGuardaEsclarecimento("   É urgente?   ", 0), "É urgente?");
});

test("aplicarGuardaEsclarecimento descarta valores vazios ou não-string", () => {
  assert.equal(aplicarGuardaEsclarecimento("", 0), null);
  assert.equal(aplicarGuardaEsclarecimento("   ", 0), null);
  assert.equal(aplicarGuardaEsclarecimento(undefined, 0), null);
  assert.equal(aplicarGuardaEsclarecimento(null, 0), null);
  assert.equal(aplicarGuardaEsclarecimento(42, 0), null);
});

test("aplicarGuardaEsclarecimento limita o tamanho da pergunta a 300 caracteres", () => {
  const resultado = aplicarGuardaEsclarecimento("a".repeat(400), 0);
  assert.equal(resultado?.length, 300);
});

test("aplicarGuardaRespostaDireta apara, valida tipo e limita tamanho", () => {
  assert.equal(
    aplicarGuardaRespostaDireta("  A1 PF custa R$ 160,00 presencial.  "),
    "A1 PF custa R$ 160,00 presencial.",
  );
  assert.equal(aplicarGuardaRespostaDireta(""), null);
  assert.equal(aplicarGuardaRespostaDireta("   "), null);
  assert.equal(aplicarGuardaRespostaDireta(undefined), null);
  assert.equal(aplicarGuardaRespostaDireta(160), null);
  assert.equal(aplicarGuardaRespostaDireta("a".repeat(900))?.length, 700);
});
