import type { TaskStatus } from "./task-state";

/**
 * Ponte entre a missão e o fechamento (funções puras).
 *
 * O balanço de uma empresa era registrado duas vezes: a pessoa fazia a missão,
 * escrevia o retorno com caixa e resultado, e depois alguém repetia os mesmos
 * números no período da aba Fechamentos. Não é coincidência que batam — é o
 * mesmo trabalho, anotado em dois lugares.
 *
 * O elo em si já existia e estava inalcançável: `syncClosingFromTask` fecha o
 * período quando a missão vinculada conclui, e reabre quando ela é revertida.
 * O que faltava era alguém preencher `tasks.closing_id`.
 */

/**
 * Estados da missão em que o TRABALHO está feito, para efeito de fechamento.
 * `awaiting_approval` entra porque a entrega já traz o balanço pronto — a
 * aprovação é o aceite de quem pediu, não a execução.
 *
 * Mora aqui, com nome, porque a regra é usada em dois lugares distantes: ao
 * gerar o período a partir da missão e ao sincronizá-lo nas transições. Duas
 * cópias da mesma lista é como elas divergem sem ninguém ver.
 */
export const TASK_STATUSES_THAT_CLOSE_PERIOD = [
  "completed",
  "awaiting_approval",
] as const satisfies readonly TaskStatus[];

export function taskClosesPeriod(status: TaskStatus): boolean {
  return (TASK_STATUSES_THAT_CLOSE_PERIOD as readonly TaskStatus[]).includes(status);
}

export interface ClosingFigures {
  cashBalance: string | null;
  periodResult: string | null;
  shareholderLoan: string | null;
}

/** Rótulos que a equipe usa no retorno, por campo do fechamento. */
const FIGURE_LABELS: Record<keyof ClosingFigures, readonly string[]> = {
  cashBalance: ["caixa", "saldo em caixa", "saldo de caixa", "disponibilidade"],
  periodResult: ["resultado", "lucro", "prejuizo", "resultado do periodo"],
  shareholderLoan: [
    "emprestimo",
    "mutuo",
    "conta socio",
    "conta corrente socio",
    "socio",
  ],
};

/**
 * Tira os pontos de milhar VALIDANDO o agrupamento: "182.498" é 182498, mas
 * "1.2.3" não é número nenhum. Sem esta checagem, um texto quase-numérico
 * virava um valor plausível e errado dentro de um balanço.
 */
function semMilhar(inteiro: string): string | null {
  if (!inteiro.includes(".")) return /^\d+$/.test(inteiro) ? inteiro : null;
  const grupos = inteiro.split(".");
  const cabeca = grupos[0];
  if (!/^\d{1,3}$/.test(cabeca)) return null;
  if (!grupos.slice(1).every((grupo) => /^\d{3}$/.test(grupo))) return null;
  return grupos.join("");
}

function semAcento(valor: string): string {
  return valor.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");
}

/**
 * "182.498,91" → "182498.91". Devolve null para o que não for um número
 * brasileiro completo: preferimos campo vazio a número errado num balanço.
 */
export function parseBrazilianAmount(raw: string): string | null {
  const limpo = raw.trim().replace(/^R\$\s*/i, "").trim();
  if (!/^-?[\d.,]+$/.test(limpo)) return null;

  const negativo = limpo.startsWith("-");
  const corpo = negativo ? limpo.slice(1) : limpo;
  if (!/\d/.test(corpo)) return null;

  const temVirgula = corpo.includes(",");
  const temPonto = corpo.includes(".");

  let inteiro = corpo;
  let decimais = "";

  if (temVirgula) {
    // Vírgula é o decimal: tudo antes dela é milhar.
    const partes = corpo.split(",");
    if (partes.length !== 2) return null;
    const cabeca = semMilhar(partes[0]);
    decimais = partes[1];
    if (!cabeca || !/^\d{1,2}$/.test(decimais)) return null;
    inteiro = cabeca;
  } else if (temPonto) {
    // Sem vírgula, o ponto pode ser milhar ("182.498") ou decimal ("182.49").
    // Grupos de três dígitos são milhar; qualquer outra coisa é decimal.
    const partes = corpo.split(".");
    const agrupado =
      partes.length > 1 && partes.slice(1).every((parte) => /^\d{3}$/.test(parte));
    if (agrupado) {
      const junto = semMilhar(corpo);
      if (!junto) return null;
      inteiro = junto;
    } else {
      if (partes.length !== 2) return null;
      inteiro = partes[0];
      decimais = partes[1];
      if (!/^\d{1,2}$/.test(decimais)) return null;
    }
  }

  if (!/^\d+$/.test(inteiro)) return null;
  const valor = decimais ? `${inteiro}.${decimais}` : inteiro;
  return negativo ? `-${valor}` : valor;
}

/**
 * Lê caixa, resultado e conta de sócio do retorno da missão.
 *
 * Deliberadamente conservador: só aceita linha com RÓTULO reconhecido seguido
 * de separador (`-`, `:` ou `=`) e um número. Texto corrido não vira valor —
 * num balanço, campo vazio que a pessoa preenche é melhor que número
 * adivinhado que ela não confere.
 */
export function parseClosingFigures(note: string | null | undefined): ClosingFigures {
  const vazio: ClosingFigures = {
    cashBalance: null,
    periodResult: null,
    shareholderLoan: null,
  };
  if (!note) return vazio;

  const resultado = { ...vazio };
  for (const linha of note.split(/\r?\n/)) {
    const separado = linha.match(/^\s*([^:\-=]+?)\s*[:\-=]\s*(.+?)\s*$/);
    if (!separado) continue;
    const rotulo = semAcento(separado[1]);
    const valor = parseBrazilianAmount(separado[2]);
    if (!valor) continue;

    for (const [campo, rotulos] of Object.entries(FIGURE_LABELS) as [
      keyof ClosingFigures,
      readonly string[],
    ][]) {
      if (resultado[campo]) continue;
      if (rotulos.some((candidato) => rotulo === candidato || rotulo.startsWith(`${candidato} `))) {
        resultado[campo] = valor;
        break;
      }
    }
  }
  return resultado;
}

/**
 * Título sugerido para o período criado a partir da missão. A missão costuma
 * dizer o trabalho ("Fazer Balanço Marieli Calgarotto"); o período quer o
 * trabalho sem o verbo e sem repetir a empresa, que já é a dona da linha.
 */
export function suggestedClosingTitle(input: {
  taskTitle: string;
  clientName: string;
  maxLength?: number;
}): string {
  const max = input.maxLength ?? 160;
  const empresa = semAcento(input.clientName);
  let titulo = input.taskTitle.trim().replace(/\s+/g, " ");

  // Tira o verbo de comando que abre a missão.
  titulo = titulo.replace(/^(fazer|elaborar|montar|realizar|preparar|gerar)\s+/i, "");

  // Tira o nome da empresa, com ou sem travessão antes.
  const semEmpresa = titulo
    .split(/\s+/)
    .reduce<string[]>((palavras, palavra) => {
      const limpa = semAcento(palavra.replace(/^—\s*/, ""));
      if (limpa && empresa.includes(limpa) && limpa.length > 2) return palavras;
      palavras.push(palavra);
      return palavras;
    }, [])
    .join(" ")
    .replace(/\s*—\s*$/, "")
    .trim();

  // Tirar a empresa só vale se o que sobra ainda nomeia um trabalho. "Empresa
  // X" menos "Empresa X" vira "X", que não diz nada — nesse caso o título
  // original serve melhor que o resto.
  const final = semEmpresa.length >= 3 ? semEmpresa : titulo;
  return (final.charAt(0).toUpperCase() + final.slice(1)).slice(0, max);
}
