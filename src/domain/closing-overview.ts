/**
 * Visão geral dos Fechamentos (funções puras): o quadro de andamento do ano e
 * a leitura de saúde financeira das empresas.
 *
 * A aba respondia "quantas empresas encerraram o ano", mas no meio do ano essa
 * pergunta tem resposta quase sempre zero. A que importa em setembro é outra:
 * quem já tem fechamento, quem ainda não tem nenhum, e quem está mais atrasado.
 * E os números que a equipe lança em cada período (caixa, resultado,
 * empréstimo de sócio) ficavam só dentro de cada card — ninguém via, de uma
 * vez, quais empresas estão no vermelho.
 */

import { ACCOUNTING_PERIOD_MONTHS } from "./accounting-period";

export type ClosingStage = "none" | "partial" | "closed";

export const CLOSING_STAGE_LABELS: Record<ClosingStage, string> = {
  none: "Nenhum período fechado",
  partial: "Com fechamento, ano em aberto",
  closed: "Ano encerrado",
};

export interface OverviewClosing {
  status: string;
  periodMonth: number | null;
  /** YYYY-MM-DD. */
  dueDate: string;
  cashBalance: string | null;
  periodResult: string | null;
  shareholderLoan: string | null;
}

export interface OverviewCompany {
  id: string;
  name: string;
  yearClosedAt: string | null;
  closings: readonly OverviewClosing[];
}

/**
 * Em que etapa do ano a empresa está. As três são exclusivas, com precedência:
 * ano encerrado vence tudo (mesmo sem período lançado), e período pendente NÃO
 * conta como fechamento — lançado não é fechado.
 */
export function closingStage(company: OverviewCompany): ClosingStage {
  if (company.yearClosedAt) return "closed";
  return company.closings.some((closing) => closing.status === "completed")
    ? "partial"
    : "none";
}

/**
 * O período fechado mais recente do ano — a foto atual da empresa. Ordena pelo
 * mês de referência; período sem mês fica atrás de qualquer mês conhecido, e o
 * vencimento desempata.
 */
export function latestCompletedClosing(
  closings: readonly OverviewClosing[],
): OverviewClosing | null {
  let melhor: OverviewClosing | null = null;
  for (const closing of closings) {
    if (closing.status !== "completed") continue;
    if (!melhor) {
      melhor = closing;
      continue;
    }
    const mesAtual = closing.periodMonth ?? 0;
    const mesMelhor = melhor.periodMonth ?? 0;
    if (
      mesAtual > mesMelhor ||
      (mesAtual === mesMelhor && closing.dueDate > melhor.dueDate)
    ) {
      melhor = closing;
    }
  }
  return melhor;
}

export function monthShortLabel(month: number | null): string {
  if (month === null) return "sem mês";
  const nome = ACCOUNTING_PERIOD_MONTHS[month - 1];
  return nome ? nome.slice(0, 3) : "sem mês";
}

export interface BoardPartialEntry {
  company: OverviewCompany;
  /** Mês do período fechado mais recente; null quando nenhum tem mês. */
  latestMonth: number | null;
}

export interface ClosingBoard {
  none: OverviewCompany[];
  partial: BoardPartialEntry[];
  closed: OverviewCompany[];
}

/**
 * Distribui as empresas nas três colunas.
 *
 * A coluna do meio vem da MAIS ATRASADA para a mais adiantada: é a ordem que
 * pede ação. Empresa sem mês registrado vai para o fim dela — não dá para
 * dizer que está atrasada sem saber até onde foi.
 */
export function buildClosingBoard(companies: readonly OverviewCompany[]): ClosingBoard {
  const board: ClosingBoard = { none: [], partial: [], closed: [] };
  for (const company of companies) {
    const stage = closingStage(company);
    if (stage === "none") board.none.push(company);
    else if (stage === "closed") board.closed.push(company);
    else {
      board.partial.push({
        company,
        latestMonth: latestCompletedClosing(company.closings)?.periodMonth ?? null,
      });
    }
  }

  const porNome = (a: OverviewCompany, b: OverviewCompany) =>
    a.name.localeCompare(b.name, "pt-BR");
  board.none.sort(porNome);
  board.closed.sort(
    (a, b) => (b.yearClosedAt ?? "").localeCompare(a.yearClosedAt ?? "") || porNome(a, b),
  );
  board.partial.sort((a, b) => {
    if (a.latestMonth === null && b.latestMonth !== null) return 1;
    if (b.latestMonth === null && a.latestMonth !== null) return -1;
    return (a.latestMonth ?? 0) - (b.latestMonth ?? 0) || porNome(a.company, b.company);
  });
  return board;
}

/**
 * Abaixo disto o caixa é "baixo". Valor único para a carteira inteira é uma
 * simplificação consciente: não há base de comparação por empresa no cadastro.
 * Caixa NEGATIVO é o sinal inequívoco e sempre aparece primeiro; o limite só
 * decide o que entra como alerta mais brando.
 */
export const LOW_CASH_THRESHOLD = 10_000;

export interface HealthEntry {
  company: OverviewCompany;
  value: number;
  /** Mês do período de onde o valor foi lido. */
  month: number | null;
}

export interface ClosingHealth {
  loss: HealthEntry[];
  cash: HealthEntry[];
  loan: HealthEntry[];
  /** Empresas com ao menos um período fechado — só essas têm números. */
  analyzed: number;
}

function valor(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const numero = Number(raw);
  return Number.isFinite(numero) ? numero : null;
}

export interface SeriesPoint {
  month: number;
  cash: number | null;
  result: number | null;
  loan: number | null;
}

/**
 * A evolução de uma empresa no ano: um ponto por mês com período FECHADO.
 * Período sem mês fica de fora (não tem lugar no eixo), e dois períodos no
 * mesmo mês valem pelo de vencimento mais tarde — a última palavra do mês.
 * Campo vazio continua vazio: zero no gráfico seria um valor que ninguém lançou.
 */
export function closingSeries(closings: readonly OverviewClosing[]): SeriesPoint[] {
  const porMes = new Map<number, OverviewClosing>();
  for (const closing of closings) {
    if (closing.status !== "completed" || closing.periodMonth === null) continue;
    const atual = porMes.get(closing.periodMonth);
    if (!atual || closing.dueDate > atual.dueDate) porMes.set(closing.periodMonth, closing);
  }
  return [...porMes.entries()]
    .sort(([a], [b]) => a - b)
    .map(([month, closing]) => ({
      month,
      cash: valor(closing.cashBalance),
      result: valor(closing.periodResult),
      loan: valor(closing.shareholderLoan),
    }));
}

/**
 * Lê a saúde de cada empresa no período fechado MAIS RECENTE. Prejuízo antigo
 * que já virou lucro não é alerta; o que importa é a foto de agora.
 */
export function analyzeClosingHealth(
  companies: readonly OverviewCompany[],
  options: { lowCashThreshold?: number } = {},
): ClosingHealth {
  const limite = options.lowCashThreshold ?? LOW_CASH_THRESHOLD;
  const health: ClosingHealth = { loss: [], cash: [], loan: [], analyzed: 0 };

  for (const company of companies) {
    const atual = latestCompletedClosing(company.closings);
    if (!atual) continue;
    health.analyzed += 1;
    const month = atual.periodMonth;

    const resultado = valor(atual.periodResult);
    if (resultado !== null && resultado < 0) {
      health.loss.push({ company, value: resultado, month });
    }
    const caixa = valor(atual.cashBalance);
    if (caixa !== null && caixa < limite) {
      health.cash.push({ company, value: caixa, month });
    }
    const emprestimo = valor(atual.shareholderLoan);
    if (emprestimo !== null && emprestimo > 0) {
      health.loan.push({ company, value: emprestimo, month });
    }
  }

  // Pior primeiro em cada lista.
  health.loss.sort((a, b) => a.value - b.value);
  health.cash.sort((a, b) => a.value - b.value);
  health.loan.sort((a, b) => b.value - a.value);
  return health;
}
