/**
 * Atribuições nominais dentro de um clã: quem responde por uma etapa do
 * trabalho recorrente.
 *
 * Não confundir com as rotas de Informativo (`clan_informative_routes`), que
 * decidem para onde vão as missões DEPOIS que um Informativo é confirmado.
 * Aqui é quem EXECUTA a etapa — e por isso a unicidade é por (clã, atribuição):
 * cada trabalho tem um dono, não uma fila.
 *
 * Os valores espelham a pgEnum `clan_duty` em `src/db/schema/domain.ts`; o
 * domínio não importa o schema (mesma convenção de `COMPANY_FLOW_KINDS`).
 */
export const CLAN_DUTIES = ["company_flow", "informative"] as const;
export type ClanDuty = (typeof CLAN_DUTIES)[number];

export const CLAN_DUTY_LABELS: Record<ClanDuty, string> = {
  company_flow: "Atende os Fluxos",
  informative: "Gera os Informativos",
};

export const CLAN_DUTY_DESCRIPTIONS: Record<ClanDuty, string> = {
  company_flow:
    "Recebe a missão assim que um Fluxo novo chega ao clã. Sem alguém aqui, o Fluxo cai na fila e qualquer integrante pode assumir.",
  informative:
    "Recebe a missão de redigir o Informativo quando o Societário devolve o Fluxo com o resultado.",
};

export function isClanDuty(value: unknown): value is ClanDuty {
  return (
    typeof value === "string" && (CLAN_DUTIES as readonly string[]).includes(value)
  );
}

/**
 * Quem responde por uma atribuição, se houver alguém.
 *
 * A ausência é um estado legítimo e é o caso mais comum numa organização nova:
 * o chamador precisa ter um caminho de degradação (a fila aberta, no caso do
 * Fluxo), nunca travar por falta de configuração.
 */
export function findDutyHolder<T extends { duty: ClanDuty; userId: string }>(
  duties: readonly T[],
  duty: ClanDuty,
): T | null {
  return duties.find((entry) => entry.duty === duty) ?? null;
}
