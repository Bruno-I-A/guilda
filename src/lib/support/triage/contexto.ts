import { mascararPii } from "./mascaramento";

export const LIMITE_MENSAGENS_HISTORICO = 20;

const LIMITE_CARACTERES_MENSAGEM_ATUAL = 4_096;
const LIMITE_CARACTERES_ITEM_HISTORICO = 2_000;

export interface MensagemHistoricoClassificacao {
  autor: "cliente" | "ia" | "atendente";
  conteudo: string;
  ciclo: "atual" | "anterior";
}

export interface EntradaClassificacaoPreparada {
  textoAtualMascarado: string;
  historicoMascarado: MensagemHistoricoClassificacao[];
  conteudoParaModelo: string;
}

function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Reconhece somente aberturas sem assunto. Uma frase que contenha qualquer
 * informacao adicional permanece classificavel (por exemplo, "oi, preciso do DAS").
 */
export function ehSaudacaoSemAssunto(texto: string): boolean {
  const normalizado = normalizarTexto(texto);
  if (!normalizado) return true;

  const restante = normalizado
    .replace(/\b(?:bom dia|boa tarde|boa noite|tudo bem|como vai|e ai)\b/g, " ")
    .replace(/\b(?:oi+|ola|opa|alo|hello|hey)\b/g, " ")
    .replace(/\b(?:por favor)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return restante.length === 0;
}

/**
 * Ultima fronteira antes da chamada externa. O chamador fornece os textos
 * persistidos; esta funcao mascara cada item, limita volume e produz JSON para
 * que historico e mensagem atual nao sejam confundidos com instrucoes.
 */
export function prepararEntradaClassificacao(
  textoAtual: string,
  historico: readonly MensagemHistoricoClassificacao[],
): EntradaClassificacaoPreparada {
  const textoAtualMascarado = mascararPii(textoAtual).slice(
    0,
    LIMITE_CARACTERES_MENSAGEM_ATUAL,
  );
  const historicoMascarado = historico
    .slice(-LIMITE_MENSAGENS_HISTORICO)
    .map((mensagem) => ({
      autor: mensagem.autor,
      ciclo: mensagem.ciclo,
      conteudo: mascararPii(mensagem.conteudo).slice(
        0,
        LIMITE_CARACTERES_ITEM_HISTORICO,
      ),
    }));

  return {
    textoAtualMascarado,
    historicoMascarado,
    conteudoParaModelo: JSON.stringify({
      historico: historicoMascarado,
      mensagem_atual: textoAtualMascarado,
    }),
  };
}
