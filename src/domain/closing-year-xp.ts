/**
 * XP do fechamento de ano: reconciliação em vez de crédito e estorno soltos.
 *
 * O ano de fechamento tem UM dono do XP — quem consta como `closed_by` — e o
 * ledger precisa refletir exatamente isso. Espalhar "credita ao fechar" e
 * "estorna ao reabrir" por dois caminhos de escrita (a missão vinculada ao ano
 * e o botão manual da aba Fechamentos) deixou o segundo lado sem par: o ano
 * reabria, o crédito ficava, e a unicidade parcial do ledger ainda impedia
 * creditar quem fechasse o ano depois. O primeiro ficava com XP de trabalho
 * desfeito e o segundo trabalhava de graça.
 *
 * Aqui a pergunta é outra: dado o que o ledger já registra para ESTE ano e
 * quem deve ficar com o crédito, o que falta lançar? Rodar duas vezes sem
 * mudança de estado não produz linha nenhuma — a idempotência é da forma da
 * função, não de um índice único. E o repasse sai de graça: quando a
 * reabertura promove outra missão concluída a dona do ano, o XP sai de quem
 * perdeu e entra em quem ganhou na mesma passada.
 *
 * Função pura: quem chama lê o ledger, aplica os lançamentos e responde pelo
 * lock da linha do ano (é ele que serializa duas pessoas fechando o mesmo ano).
 */

export interface ClosingYearXpHolder {
  userId: string;
  /** Saldo líquido já lançado para este ano — soma, não a última linha. */
  net: number;
}

export interface ClosingYearXpEntry {
  userId: string;
  amount: number;
  reason: "closing_year_closed" | "closing_year_reversal";
}

export function reconcileClosingYearXp(input: {
  /** Saldo por usuário no ledger deste ano; um registro por pessoa. */
  holders: readonly ClosingYearXpHolder[];
  /** Quem deve ficar com o crédito; null = ano reaberto, ninguém fica. */
  closedBy: string | null;
  /** XP do fechamento (`CLOSING_YEAR_XP`). */
  award: number;
}): ClosingYearXpEntry[] {
  const { holders, closedBy, award } = input;
  const entries: ClosingYearXpEntry[] = [];

  // Quem não é mais o dono volta a zero. Saldo já zerado por um estorno
  // anterior não gera lançamento — é o que impede o estorno duplicado quando
  // a reconciliação roda de novo sobre o mesmo estado.
  for (const holder of holders) {
    if (holder.userId === closedBy || holder.net === 0) continue;
    entries.push({
      userId: holder.userId,
      amount: -holder.net,
      reason: "closing_year_reversal",
    });
  }

  if (closedBy) {
    const net = holders.find((holder) => holder.userId === closedBy)?.net ?? 0;
    const delta = award - net;
    // Só a DIFERENÇA entra no ledger: se o dono já tem o crédito certo, nada
    // acontece. Delta negativo é estorno (o prêmio do fechamento encolheu, ou
    // o saldo dele passou do devido) e precisa do rótulo de estorno para o
    // histórico do perfil não chamar isso de fechamento.
    if (delta !== 0) {
      entries.push({
        userId: closedBy,
        amount: delta,
        reason: delta > 0 ? "closing_year_closed" : "closing_year_reversal",
      });
    }
  }

  return entries;
}
