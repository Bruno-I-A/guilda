import assert from "node:assert/strict";
import { test } from "vitest";
import {
  ehSaudacaoSemAssunto,
  LIMITE_MENSAGENS_HISTORICO,
  prepararEntradaClassificacao,
  type MensagemHistoricoClassificacao,
} from "./contexto";

test("identifica saudacao sem assunto sem engolir uma solicitacao real", () => {
  for (const saudacao of ["Oi", "Oiii!", "Ola, bom dia", "Boa tarde! Tudo bem?", "E ai?"]) {
    assert.equal(ehSaudacaoSemAssunto(saudacao), true, saudacao);
  }

  assert.equal(ehSaudacaoSemAssunto("Oi, preciso da segunda via do DAS"), false);
  assert.equal(ehSaudacaoSemAssunto("Bom dia, minha folha veio errada"), false);
});

test("limita, ordena e mascara individualmente as 20 mensagens mais recentes", () => {
  const historico: MensagemHistoricoClassificacao[] = Array.from(
    { length: LIMITE_MENSAGENS_HISTORICO + 5 },
    (_, indice) => ({
      autor: indice % 2 === 0 ? "cliente" : "atendente",
      ciclo: indice < 20 ? "anterior" : "atual",
      conteudo: `mensagem-${indice + 1}`,
    }),
  );
  historico[24]!.conteudo = "CPF 123.456.789-09 e CNPJ 12.345.678/0001-90";

  const preparada = prepararEntradaClassificacao(
    "cartao 1234 5678 9012 3456",
    historico,
  );

  assert.equal(preparada.historicoMascarado.length, LIMITE_MENSAGENS_HISTORICO);
  assert.equal(preparada.historicoMascarado[0]?.conteudo, "mensagem-6");
  assert.equal(preparada.historicoMascarado.at(-1)?.conteudo, "CPF *** e CNPJ ***");
  assert.equal(preparada.textoAtualMascarado, "cartao ***");
  assert.equal(preparada.conteudoParaModelo.includes("123.456.789-09"), false);
  assert.equal(preparada.conteudoParaModelo.includes("1234 5678 9012 3456"), false);
});
