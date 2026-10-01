# Desafio do dado — plano de implementação

> **Para agentes:** executar tarefa a tarefa (superpowers:executing-plans). Os
> passos usam checkbox (`- [ ]`). Desenho em
> `docs/superpowers/specs/2026-10-01-desafio-do-dado-design.md`.

**Objetivo:** o dado da aba Fechamentos vira um jogo — rolar reserva a empresa
e abre um prazo; fechar o período paga base + bônus no prazo, com teto diário.

**Arquitetura:** regra pura em `src/domain/closing-challenge.ts`; duas tabelas
novas (desafios e regras) com RLS; uma porta única de escrita de períodos e
observações (`src/lib/closings/period-writes.ts`) que chama o sync do desafio
na mesma transação; XP acertado pelo saldo do desafio no `xp_ledger`, como o
fechamento de ano.

**Stack:** Next.js 15 (Server Actions), Drizzle + Postgres (RLS, `guilda_app`),
Zod, Vitest, Tailwind v4.

**Convenções do repositório:** commits na `develop`, em português sem acento,
terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Antes
do push: `npx tsc --noEmit -p tsconfig.json`, `npx vitest run`, `npm run lint`,
`npm run build`. Push só no fim (cada push publica a homologação).

---

## Mapa de arquivos

| Arquivo | Papel |
| ------- | ----- |
| `src/domain/closing-challenge.ts` (+ `.test.ts`) | Regra pura: regras padrão e limites, prazo, pool, desfecho, prêmio, XP retido, delta do ledger, cronômetro, texto do resultado |
| `src/db/schema/domain.ts` | Enum + `closing_challenges` + `closing_challenge_settings`; `xp_ledger.closing_challenge_id` |
| `src/db/migrations/0078_closing-challenges.sql` | Gerada pelo drizzle-kit + RLS/FORCE/policy/GRANT à mão |
| `src/lib/closings-ui.ts` | Regimes de cada grupo e grupo de cada regime (dados puros) |
| `src/lib/closings/gate.ts` | Gates de autorização dos Fechamentos (saem de `closing-actions.ts`) |
| `src/lib/closings/challenge-rules.ts` | Lê as regras salvas; `START_OF_TODAY_SP` |
| `src/lib/closings/challenge-sync.ts` | `syncClosingChallenges`: desfecho + acerto do ledger |
| `src/lib/closings/period-writes.ts` (+ `.guard.test.ts`) | Porta única de escrita |
| `src/lib/closings/challenge-pool.ts` | Empresas sorteáveis no servidor |
| `src/lib/closings/challenge-board.ts` | Dados da faixa: regras, meu desafio, jogando agora, placar |
| `src/app/(app)/clans/[id]/closing-challenge-actions.ts` | Rolar, desistir, liberar, ajustar regras |
| `src/app/(app)/clans/[id]/closing-challenge.tsx` | Faixa do desafio (substitui `closing-draw.tsx`) |
| `src/app/(app)/clans/[id]/closings-tab.tsx`, `page.tsx` | Carregam os dados e passam permissões |
| `src/app/(app)/profile/page.tsx` | Rótulos dos motivos novos no histórico de XP |
| `CLAUDE.md` | Decisão registrada |

---

### Tarefa 1: regra pura do desafio

**Arquivos:** criar `src/domain/closing-challenge.ts` e
`src/domain/closing-challenge.test.ts`.

- [ ] **Passo 1: escrever os testes** (`src/domain/closing-challenge.test.ts`)

```ts
import { describe, expect, test } from "vitest";

import {
  CHALLENGE_RULE_LIMITS,
  challengeAward,
  challengeClock,
  challengeDeadline,
  challengeHeldXp,
  challengePool,
  challengeResult,
  challengeXpEntry,
  DEFAULT_CHALLENGE_RULES,
  settleActiveChallenge,
} from "./closing-challenge";

const inicio = new Date("2026-10-01T13:00:00Z");
const depois = (min: number) => new Date(inicio.getTime() + min * 60_000);

describe("desfecho do desafio em andamento", () => {
  const base = { challenger: "ana", startedAt: inicio, observationsSinceStart: 0 };

  test("período fechado por quem rolou, depois do início, conclui", () => {
    const desfecho = settleActiveChallenge({
      ...base,
      completedPeriods: [{ id: "p1", completedBy: "ana", completedAt: depois(18) }],
    });
    expect(desfecho).toEqual({ status: "completed", closingId: "p1", completedAt: depois(18) });
  });

  test("com dois períodos, vale o primeiro fechado", () => {
    const desfecho = settleActiveChallenge({
      ...base,
      completedPeriods: [
        { id: "tarde", completedBy: "ana", completedAt: depois(40) },
        { id: "cedo", completedBy: "ana", completedAt: depois(10) },
      ],
    });
    expect(desfecho).toMatchObject({ status: "completed", closingId: "cedo" });
  });

  test("fechado por outra pessoa encerra sem XP", () => {
    const desfecho = settleActiveChallenge({
      ...base,
      completedPeriods: [{ id: "p1", completedBy: "bruno", completedAt: depois(5) }],
    });
    expect(desfecho).toEqual({ status: "taken" });
  });

  test("o fechamento de quem rolou vence o de outra pessoa", () => {
    const desfecho = settleActiveChallenge({
      ...base,
      completedPeriods: [
        { id: "outro", completedBy: "bruno", completedAt: depois(5) },
        { id: "meu", completedBy: "ana", completedAt: depois(9) },
      ],
    });
    expect(desfecho).toMatchObject({ status: "completed", closingId: "meu" });
  });

  test("período fechado ANTES de rolar não conta", () => {
    const desfecho = settleActiveChallenge({
      ...base,
      completedPeriods: [{ id: "antigo", completedBy: "ana", completedAt: depois(-60) }],
    });
    expect(desfecho).toEqual({ status: "active" });
  });

  test("observação depois do início trava o desafio", () => {
    expect(
      settleActiveChallenge({ ...base, completedPeriods: [], observationsSinceStart: 1 }),
    ).toEqual({ status: "blocked" });
  });

  test("fechou e anotou: o trabalho feito vence a observação", () => {
    const desfecho = settleActiveChallenge({
      ...base,
      observationsSinceStart: 2,
      completedPeriods: [{ id: "p1", completedBy: "ana", completedAt: depois(12) }],
    });
    expect(desfecho.status).toBe("completed");
  });

  test("sem fato novo, continua em andamento — atrasado ainda vale a base", () => {
    expect(settleActiveChallenge({ ...base, completedPeriods: [] })).toEqual({ status: "active" });
  });
});

describe("prêmio", () => {
  const regras = { baseXp: 15, bonusXp: 15, dailyPaidCap: 10 };

  test("no prazo paga base + bônus", () => {
    expect(challengeAward({ ...regras, inTime: true, paidToday: 0 })).toEqual({
      awardedXp: 30,
      capped: false,
    });
  });

  test("fora do prazo paga só a base", () => {
    expect(challengeAward({ ...regras, inTime: false, paidToday: 3 })).toEqual({
      awardedXp: 15,
      capped: false,
    });
  });

  test("bateu o teto do dia: termina, mas não paga", () => {
    expect(challengeAward({ ...regras, inTime: true, paidToday: 10 })).toEqual({
      awardedXp: 0,
      capped: true,
    });
  });
});

describe("XP retido e lançamento no ledger", () => {
  test("concluído com o período ainda fechado por quem rolou segura o prêmio", () => {
    expect(
      challengeHeldXp({ status: "completed", awardedXp: 30, linkedPeriodClosedByChallenger: true }),
    ).toBe(30);
  });

  test("período reaberto: o desafio não segura nada", () => {
    expect(
      challengeHeldXp({ status: "completed", awardedXp: 30, linkedPeriodClosedByChallenger: false }),
    ).toBe(0);
  });

  test("desafio que não concluiu nunca segura XP", () => {
    for (const status of ["active", "abandoned", "blocked", "taken"] as const) {
      expect(challengeHeldXp({ status, awardedXp: 30, linkedPeriodClosedByChallenger: true })).toBe(0);
    }
  });

  test("lança só a diferença, com o rótulo certo", () => {
    expect(challengeXpEntry({ net: 0, held: 30 })).toEqual({
      amount: 30,
      reason: "closing_challenge",
    });
    expect(challengeXpEntry({ net: 30, held: 0 })).toEqual({
      amount: -30,
      reason: "closing_challenge_reversal",
    });
    expect(challengeXpEntry({ net: 30, held: 30 })).toBeNull();
  });
});

describe("sorteio e prazo", () => {
  test("o pool tira as inelegíveis e as reservadas", () => {
    const empresas = [
      { id: "livre", yearClosed: false, periodCount: 0, observationCount: 0 },
      { id: "reservada", yearClosed: false, periodCount: 0, observationCount: 0 },
      { id: "com-periodo", yearClosed: false, periodCount: 1, observationCount: 0 },
    ];
    expect(challengePool(empresas, new Set(["reservada"])).map((e) => e.id)).toEqual(["livre"]);
  });

  test("o prazo soma os minutos ao início", () => {
    expect(challengeDeadline(inicio, 30)).toEqual(depois(30));
  });

  test("as regras padrão cabem nos limites", () => {
    for (const [chave, valor] of Object.entries(DEFAULT_CHALLENGE_RULES)) {
      const limite = CHALLENGE_RULE_LIMITS[chave as keyof typeof CHALLENGE_RULE_LIMITS];
      expect(valor).toBeGreaterThanOrEqual(limite.min);
      expect(valor).toBeLessThanOrEqual(limite.max);
    }
  });
});

describe("cronômetro", () => {
  const prazo = depois(30).getTime();

  test("conta o que falta em mm:ss", () => {
    expect(challengeClock(prazo, inicio.getTime())).toEqual({ late: false, label: "30:00" });
    expect(challengeClock(prazo, depois(29).getTime() + 30_500)).toEqual({
      late: false,
      label: "00:30",
    });
  });

  test("passou do prazo vira atraso em minutos", () => {
    expect(challengeClock(prazo, prazo + 10_000)).toEqual({
      late: true,
      label: "atrasado há 1 min",
    });
    expect(challengeClock(prazo, prazo + 5 * 60_000)).toEqual({
      late: true,
      label: "atrasado há 5 min",
    });
  });
});

describe("resultado", () => {
  const fatos = {
    inTime: true,
    awardedXp: 30,
    capped: false,
    startedAt: inicio,
    endedAt: depois(18),
    releasedByOther: false,
  };

  test("no prazo mostra o XP e o tempo", () => {
    expect(challengeResult({ ...fatos, status: "completed" })).toEqual({
      xp: 30,
      text: "no prazo em 18 min",
    });
  });

  test("fora do prazo mostra a base", () => {
    expect(
      challengeResult({ ...fatos, status: "completed", inTime: false, awardedXp: 15, endedAt: depois(42) }),
    ).toEqual({ xp: 15, text: "fora do prazo em 42 min" });
  });

  test("teto do dia: fechada, sem XP", () => {
    expect(
      challengeResult({ ...fatos, status: "completed", awardedXp: 0, capped: true }),
    ).toEqual({ xp: null, text: "fechada em 18 min · teto do dia, sem XP" });
  });

  test("os finais sem XP dizem por quê", () => {
    expect(challengeResult({ ...fatos, status: "blocked" }).text).toBe(
      "travado por observação · sem XP",
    );
    expect(challengeResult({ ...fatos, status: "taken" }).text).toBe(
      "fechada por outra pessoa · sem XP",
    );
    expect(challengeResult({ ...fatos, status: "abandoned" }).text).toBe("você desistiu · sem XP");
    expect(challengeResult({ ...fatos, status: "abandoned", releasedByOther: true }).text).toBe(
      "liberado pela liderança · sem XP",
    );
  });
});
```

- [ ] **Passo 2: rodar e ver falhar** — `npx vitest run src/domain/closing-challenge.test.ts`
  (esperado: falha por módulo inexistente).

- [ ] **Passo 3: implementar** (`src/domain/closing-challenge.ts`)

```ts
/**
 * Desafio do dado nos Fechamentos (funções puras).
 *
 * Desenho aprovado em docs/superpowers/specs/2026-10-01-desafio-do-dado-design.md.
 * Rolou, a empresa fica reservada para quem rolou e corre um prazo; fechar o
 * período paga a base, e dentro do prazo paga também o bônus. O teto diário
 * é a trava contra XP fabricado: o fechamento é registrado pela própria
 * pessoa, e sem teto "rolar e marcar fechado" viraria fábrica de XP.
 */

import { isClosingDrawEligible, type ClosingDrawFacts } from "./closing-draw";

export type ChallengeStatus = "active" | "completed" | "abandoned" | "blocked" | "taken";

export const CHALLENGE_STATUSES = [
  "active",
  "completed",
  "abandoned",
  "blocked",
  "taken",
] as const satisfies readonly ChallengeStatus[];

export interface ChallengeRules {
  timeLimitMinutes: number;
  baseXp: number;
  bonusXp: number;
  dailyPaidCap: number;
}

/** Os 30 minutos são o tempo real de um fechamento, segundo o Bruno. */
export const DEFAULT_CHALLENGE_RULES: ChallengeRules = {
  timeLimitMinutes: 30,
  baseXp: 15,
  bonusXp: 15,
  dailyPaidCap: 10,
};

export const CHALLENGE_RULE_LIMITS: Record<keyof ChallengeRules, { min: number; max: number }> = {
  timeLimitMinutes: { min: 5, max: 240 },
  baseXp: { min: 0, max: 100 },
  bonusXp: { min: 0, max: 100 },
  dailyPaidCap: { min: 0, max: 50 },
};

export function challengeDeadline(startedAt: Date, timeLimitMinutes: number): Date {
  return new Date(startedAt.getTime() + timeLimitMinutes * 60_000);
}

/** Empresas que podem sair no dado: as elegíveis que ninguém reservou. */
export function challengePool<T extends { id: string } & ClosingDrawFacts>(
  companies: readonly T[],
  reservedIds: ReadonlySet<string>,
): T[] {
  return companies.filter(
    (company) => isClosingDrawEligible(company) && !reservedIds.has(company.id),
  );
}

interface CompletedPeriodFact {
  id: string;
  completedBy: string | null;
  completedAt: Date | null;
}

export interface ChallengeFacts {
  challenger: string;
  startedAt: Date;
  /** Períodos FECHADOS da empresa no ano do desafio. */
  completedPeriods: readonly CompletedPeriodFact[];
  /** Observações da empresa no ano do desafio criadas desde o início. */
  observationsSinceStart: number;
}

export type ChallengeOutcome =
  | { status: "active" }
  | { status: "completed"; closingId: string; completedAt: Date }
  | { status: "taken" }
  | { status: "blocked" };

/**
 * Desfecho de um desafio EM ANDAMENTO, olhando só fatos posteriores à rolada.
 *
 * O fechamento de quem rolou vence tudo: se a pessoa anotou uma observação e
 * mesmo assim fechou, o trabalho foi feito. Atraso não muda o estado — fora do
 * prazo o desafio continua valendo a base.
 */
export function settleActiveChallenge(facts: ChallengeFacts): ChallengeOutcome {
  const desdeOInicio = facts.completedPeriods.filter(
    (period): period is CompletedPeriodFact & { completedAt: Date } =>
      period.completedAt !== null &&
      period.completedAt.getTime() >= facts.startedAt.getTime(),
  );
  const meu = desdeOInicio
    .filter((period) => period.completedBy === facts.challenger)
    .sort((a, b) => a.completedAt.getTime() - b.completedAt.getTime())[0];
  if (meu) {
    return { status: "completed", closingId: meu.id, completedAt: meu.completedAt };
  }
  if (desdeOInicio.length > 0) return { status: "taken" };
  if (facts.observationsSinceStart > 0) return { status: "blocked" };
  return { status: "active" };
}

/** Quanto o desafio paga ao concluir. Passou do teto, termina sem XP. */
export function challengeAward(input: {
  inTime: boolean;
  baseXp: number;
  bonusXp: number;
  paidToday: number;
  dailyPaidCap: number;
}): { awardedXp: number; capped: boolean } {
  if (input.paidToday >= input.dailyPaidCap) return { awardedXp: 0, capped: true };
  return {
    awardedXp: input.baseXp + (input.inTime ? input.bonusXp : 0),
    capped: false,
  };
}

/**
 * XP que o desafio deve estar segurando agora: o prêmio congelado, enquanto o
 * período que o concluiu continuar fechado por quem rolou. Reabrir estorna,
 * fechar de novo devolve — o mesmo raciocínio do fechamento de ano.
 */
export function challengeHeldXp(input: {
  status: ChallengeStatus;
  awardedXp: number | null;
  linkedPeriodClosedByChallenger: boolean;
}): number {
  if (input.status !== "completed" || !input.linkedPeriodClosedByChallenger) return 0;
  return input.awardedXp ?? 0;
}

export type ChallengeXpReason = "closing_challenge" | "closing_challenge_reversal";

/** O que falta lançar para o saldo do desafio no ledger bater com o devido. */
export function challengeXpEntry(input: {
  net: number;
  held: number;
}): { amount: number; reason: ChallengeXpReason } | null {
  const amount = input.held - input.net;
  if (amount === 0) return null;
  return { amount, reason: amount > 0 ? "closing_challenge" : "closing_challenge_reversal" };
}

/** Cronômetro da faixa: mm:ss enquanto há prazo, minutos de atraso depois. */
export function challengeClock(
  deadlineMs: number,
  nowMs: number,
): { late: boolean; label: string } {
  const restante = deadlineMs - nowMs;
  if (restante >= 0) {
    const segundos = Math.ceil(restante / 1000);
    const minutos = Math.floor(segundos / 60);
    return {
      late: false,
      label: `${String(minutos).padStart(2, "0")}:${String(segundos % 60).padStart(2, "0")}`,
    };
  }
  const atraso = Math.max(1, Math.floor(-restante / 60_000));
  return { late: true, label: `atrasado há ${atraso} min` };
}

export interface ChallengeResultFacts {
  status: Exclude<ChallengeStatus, "active">;
  inTime: boolean | null;
  awardedXp: number | null;
  capped: boolean;
  startedAt: Date;
  endedAt: Date | null;
  /** Desistência registrada pela liderança, não por quem rolou. */
  releasedByOther: boolean;
}

/** O que a faixa diz quando o desafio terminou; `xp` só quando pagou. */
export function challengeResult(facts: ChallengeResultFacts): {
  xp: number | null;
  text: string;
} {
  switch (facts.status) {
    case "completed": {
      const minutos = facts.endedAt
        ? Math.max(1, Math.round((facts.endedAt.getTime() - facts.startedAt.getTime()) / 60_000))
        : null;
      const tempo = minutos === null ? "" : ` em ${minutos} min`;
      if (facts.capped || !facts.awardedXp) {
        return { xp: null, text: `fechada${tempo} · teto do dia, sem XP` };
      }
      return {
        xp: facts.awardedXp,
        text: `${facts.inTime ? "no prazo" : "fora do prazo"}${tempo}`,
      };
    }
    case "blocked":
      return { xp: null, text: "travado por observação · sem XP" };
    case "taken":
      return { xp: null, text: "fechada por outra pessoa · sem XP" };
    case "abandoned":
      return {
        xp: null,
        text: facts.releasedByOther ? "liberado pela liderança · sem XP" : "você desistiu · sem XP",
      };
  }
}
```

  Observação: com base e bônus em 0 (regra configurável), o desafio conclui
  com `awardedXp = 0` e cai no texto do teto — aceitável, ninguém configura
  um jogo sem prêmio.

- [ ] **Passo 4: rodar e ver passar** — `npx vitest run src/domain/closing-challenge.test.ts`.
- [ ] **Passo 5: commit** — `git add src/domain/closing-challenge.ts src/domain/closing-challenge.test.ts`
  e `git commit -m "feat: regra pura do desafio do dado"` (com a linha de coautoria).

---

### Tarefa 2: schema e migração

**Arquivos:** `src/db/schema/domain.ts`; gerar `src/db/migrations/0078_closing-challenges.sql`.

- [ ] **Passo 1: coluna no ledger.** Em `xpLedger` (depois de `closingYearId`):

```ts
    closingChallengeId: uuid("closing_challenge_id").references(
      () => closingChallenges.id,
      { onDelete: "set null" },
    ),
```

  e, na lista de índices do `xpLedger`, depois de `xp_ledger_closing_year_idx`:

```ts
    // Mesmo papel do índice do ano: o sync do desafio soma o ledger por
    // desafio antes de decidir o que lançar.
    index("xp_ledger_closing_challenge_idx").on(t.orgId, t.closingChallengeId),
```

  Atualizar o comentário do ledger com os motivos `closing_challenge` /
  `closing_challenge_reversal`.

- [ ] **Passo 2: tabelas novas** (depois do bloco de `closingObservations` e seus tipos):

```ts
export const closingChallengeStatus = pgEnum("closing_challenge_status", [
  "active",
  "completed",
  "abandoned",
  "blocked",
  "taken",
]);

/**
 * Desafio do dado: quem rolou, qual empresa, o prazo e como terminou. As
 * regras ficam congeladas na rolada (mudar o prazo não mexe em desafio em
 * andamento). Os dois índices parciais são as travas do jogo no próprio
 * banco: um desafio em andamento por pessoa e uma pessoa por empresa.
 */
export const closingChallenges = pgTable(
  "closing_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    year: smallint("year").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }).notNull(),
    timeLimitMinutes: smallint("time_limit_minutes").notNull(),
    baseXp: smallint("base_xp").notNull(),
    bonusXp: smallint("bonus_xp").notNull(),
    status: closingChallengeStatus("status").notNull().default("active"),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /** Quem encerrou à mão (desistência ou liberação pela liderança). */
    endedBy: text("ended_by").references(() => user.id),
    /** FK simples: composta com SET NULL zeraria o org_id. */
    closingId: uuid("closing_id").references(() => accountingClosings.id, {
      onDelete: "set null",
    }),
    inTime: boolean("in_time"),
    awardedXp: smallint("awarded_xp"),
    capped: boolean("capped").notNull().default(false),
  },
  (t) => [
    uniqueIndex("closing_challenges_active_user_uidx")
      .on(t.orgId, t.userId)
      .where(sql`status = 'active'`),
    uniqueIndex("closing_challenges_active_client_uidx")
      .on(t.orgId, t.clientId, t.year)
      .where(sql`status = 'active'`),
    index("closing_challenges_org_client_idx").on(t.orgId, t.clientId),
    index("closing_challenges_org_ended_idx").on(t.orgId, t.endedAt),
  ],
);

export const closingChallengesRelations = relations(closingChallenges, ({ one }) => ({
  user: one(user, { fields: [closingChallenges.userId], references: [user.id] }),
  client: one(clients, { fields: [closingChallenges.clientId], references: [clients.id] }),
  closing: one(accountingClosings, {
    fields: [closingChallenges.closingId],
    references: [accountingClosings.id],
  }),
}));

export type ClosingChallenge = typeof closingChallenges.$inferSelect;

/** Regras do desafio por organização; sem linha, valem os padrões do domínio. */
export const closingChallengeSettings = pgTable(
  "closing_challenge_settings",
  {
    orgId: text("org_id")
      .primaryKey()
      .references(() => organization.id),
    timeLimitMinutes: smallint("time_limit_minutes").notNull(),
    baseXp: smallint("base_xp").notNull(),
    bonusXp: smallint("bonus_xp").notNull(),
    dailyPaidCap: smallint("daily_paid_cap").notNull(),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => user.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Os mesmos limites de CHALLENGE_RULE_LIMITS: o Zod barra antes, isto é
    // a defesa em profundidade.
    check(
      "closing_challenge_settings_limits",
      sql`${t.timeLimitMinutes} between 5 and 240 and ${t.baseXp} between 0 and 100 and ${t.bonusXp} between 0 and 100 and ${t.dailyPaidCap} between 0 and 50`,
    ),
  ],
);
```

- [ ] **Passo 3: gerar a migração** — `npm run db:generate -- --name closing-challenges`.
  Conferir que o arquivo novo é `0078_closing-challenges.sql` e que ele cria o
  enum, as duas tabelas, a coluna do ledger, os FKs e os índices (o
  drizzle-kit já reportou diff errado antes — ler o SQL inteiro).

- [ ] **Passo 4: acrescentar à mão, no fim do SQL gerado:**

```sql
--> statement-breakpoint
ALTER TABLE "closing_challenges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "closing_challenges" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "closing_challenges"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "closing_challenge_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "closing_challenge_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "closing_challenge_settings"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
-- Desafio não se apaga, termina: sem DELETE, e UPDATE só no que o desfecho muda.
GRANT SELECT, INSERT ON "closing_challenges" TO guilda_app;--> statement-breakpoint
GRANT UPDATE ("status", "ended_at", "ended_by", "closing_id", "in_time", "awarded_xp", "capped") ON "closing_challenges" TO guilda_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "closing_challenge_settings" TO guilda_app;
```

- [ ] **Passo 5: `npx tsc --noEmit -p tsconfig.json`** (esperado: sem erro).
- [ ] **Passo 6: commit** — schema + SQL + `meta/` gerados:
  `git commit -m "feat: tabelas do desafio do dado"`.

---

### Tarefa 3: gates dos Fechamentos num módulo próprio

As ações do desafio precisam do mesmo gate das ações de fechamento, e arquivo
`"use server"` só pode exportar ações. Mover, sem mudar comportamento.

**Arquivos:** criar `src/lib/closings/gate.ts`; modificar
`src/app/(app)/clans/[id]/closing-actions.ts` (linhas 45–95 saem).

- [ ] **Passo 1: criar `src/lib/closings/gate.ts`**

```ts
import "server-only";

import type { OrgTx } from "@/db/org-tx";
import {
  canDeleteClanClosing,
  canManageClanClosings,
  type ClosingActorFacts,
} from "@/domain/guild-permissions";
import { err } from "@/lib/action-context";
import { isActiveClanMember, loadClanScopedFacts } from "@/lib/clans/facts";
import { lockActiveClansForMembershipRead } from "@/lib/clans/locks";
import { CONTABILIDADE_CLAN_SLUG } from "@/lib/clans/rules";

/**
 * Gates de autorização dos Fechamentos — compartilhados pelas ações da aba e
 * pelas do desafio do dado. Toda decisão sai de `canManageClanClosings` /
 * `canDeleteClanClosing`, com os fatos carregados aqui do banco.
 */

export type ClosingMemberContext = {
  orgId: string;
  userId: string;
  role: Parameters<typeof loadClanScopedFacts>[4];
};

/**
 * Prova que o clã informado é a Contabilidade e devolve os fatos de
 * autorização. O mutex de leitura de vínculo é o mesmo das demais mesas:
 * fecha a janela entre validar a participação e gravar.
 */
export async function requireClosingActor(
  tx: OrgTx,
  ctx: ClosingMemberContext,
  clanId: string,
): Promise<{ ok: true; facts: ClosingActorFacts } | { ok: false; error: string }> {
  await lockActiveClansForMembershipRead(tx, ctx.orgId);
  const { clan, facts } = await loadClanScopedFacts(tx, ctx.orgId, clanId, ctx.userId, ctx.role);
  if (!clan) return err("Clã não encontrado.");
  if (clan.slug !== CONTABILIDADE_CLAN_SLUG) {
    return err("Os fechamentos pertencem ao clã Contabilidade.");
  }
  const activeMember = await isActiveClanMember(tx, ctx.orgId, clan.id, ctx.userId);
  return { ok: true, facts: { ...facts, isActiveClanMember: activeMember } };
}

const NAO_AUTORIZADO =
  "Apenas quem integra a Contabilidade, sua liderança ou um admin pode alterar fechamentos.";

/** Gate da rotina diária — usado por tudo, menos a exclusão. */
export async function requireClosingManager(
  tx: OrgTx,
  ctx: ClosingMemberContext,
  clanId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const gate = await requireClosingActor(tx, ctx, clanId);
  if (!gate.ok) return gate;
  if (!canManageClanClosings(gate.facts)) return err(NAO_AUTORIZADO);
  return { ok: true };
}

/** Gate da liderança: excluir fechamento, liberar desafio, mudar regras. */
export async function requireClosingLeadership(
  tx: OrgTx,
  ctx: ClosingMemberContext,
  clanId: string,
  message: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const gate = await requireClosingActor(tx, ctx, clanId);
  if (!gate.ok) return gate;
  if (!canDeleteClanClosing(gate.facts)) return err(message);
  return { ok: true };
}
```

- [ ] **Passo 2: em `closing-actions.ts`** remover `MemberContext`,
  `requireClosingActor`, `NAO_AUTORIZADO` e `requireClosingManager` (e os
  imports que só eles usavam: `isActiveClanMember`, `loadClanScopedFacts`,
  `lockActiveClansForMembershipRead`, `canManageClanClosings`,
  `ClosingActorFacts` — conferir com o tsc) e importar
  `requireClosingActor, requireClosingManager` de `@/lib/closings/gate`.
  `deleteClosing` continua usando `requireClosingActor` + `canDeleteClanClosing`.
  `MemberContext` usado mais abaixo no arquivo vira `ClosingMemberContext`.
- [ ] **Passo 3: `npx tsc --noEmit -p tsconfig.json` e `npx vitest run`** (esperado: limpo, 805+ testes).
- [ ] **Passo 4: commit** — `git commit -m "refactor: gates dos Fechamentos num modulo proprio"`.

---

### Tarefa 4: regras salvas e sync do desafio

**Arquivos:** criar `src/lib/closings/challenge-rules.ts` e
`src/lib/closings/challenge-sync.ts`.

- [ ] **Passo 1: `challenge-rules.ts`**

```ts
import "server-only";

import { eq, sql } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { DEFAULT_CHALLENGE_RULES, type ChallengeRules } from "@/domain/closing-challenge";

/** Regras da organização; sem linha salva, valem os padrões do domínio. */
export async function loadChallengeRules(tx: OrgTx, orgId: string): Promise<ChallengeRules> {
  const [row] = await tx
    .select({
      timeLimitMinutes: schema.closingChallengeSettings.timeLimitMinutes,
      baseXp: schema.closingChallengeSettings.baseXp,
      bonusXp: schema.closingChallengeSettings.bonusXp,
      dailyPaidCap: schema.closingChallengeSettings.dailyPaidCap,
    })
    .from(schema.closingChallengeSettings)
    .where(eq(schema.closingChallengeSettings.orgId, orgId));
  return row ?? DEFAULT_CHALLENGE_RULES;
}

/**
 * Meia-noite de hoje em São Paulo, como timestamptz: o "hoje" do teto e do
 * placar. Calculado no banco para não depender do fuso do servidor da app.
 */
export const START_OF_TODAY_SP = sql`(date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')`;
```

- [ ] **Passo 2: `challenge-sync.ts`**

```ts
import "server-only";

import { and, asc, count, eq, gt, gte, inArray, lte, sql } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import {
  challengeAward,
  challengeHeldXp,
  challengeXpEntry,
  settleActiveChallenge,
  type ChallengeRules,
} from "@/domain/closing-challenge";

import { loadChallengeRules, START_OF_TODAY_SP } from "./challenge-rules";

/**
 * Acerta os desafios das empresas depois de uma escrita em período ou
 * observação: decide o desfecho de quem está em andamento e alinha o ledger
 * de quem concluiu.
 *
 * Só a porta única (`period-writes.ts`) chama isto, na mesma transação da
 * escrita. CONCORRÊNCIA: o FOR UPDATE nas linhas dos desafios serializa duas
 * conciliações do mesmo desafio — o ledger é somado sem lock próprio, igual a
 * `reconcileClosingYearLedger`.
 */
export async function syncClosingChallenges(
  tx: OrgTx,
  input: { orgId: string; clientIds: readonly string[] },
): Promise<void> {
  const clientIds = [...new Set(input.clientIds)];
  if (clientIds.length === 0) return;

  const challenges = await tx
    .select()
    .from(schema.closingChallenges)
    .where(
      and(
        eq(schema.closingChallenges.orgId, input.orgId),
        inArray(schema.closingChallenges.clientId, clientIds),
        inArray(schema.closingChallenges.status, ["active", "completed"]),
      ),
    )
    .orderBy(asc(schema.closingChallenges.startedAt))
    .for("update");
  if (challenges.length === 0) return;

  let rules: ChallengeRules | null = null;
  for (const challenge of challenges) {
    const periods = await tx
      .select({
        id: schema.accountingClosings.id,
        status: schema.accountingClosings.status,
        completedBy: schema.accountingClosings.completedBy,
        completedAt: schema.accountingClosings.completedAt,
      })
      .from(schema.accountingClosings)
      .where(
        and(
          eq(schema.accountingClosings.orgId, input.orgId),
          eq(schema.accountingClosings.clientId, challenge.clientId),
          gte(schema.accountingClosings.dueDate, `${challenge.year}-01-01`),
          lte(schema.accountingClosings.dueDate, `${challenge.year}-12-31`),
        ),
      );

    let current = challenge;
    if (challenge.status === "active") {
      const [observations] = await tx
        .select({ value: count() })
        .from(schema.closingObservations)
        .where(
          and(
            eq(schema.closingObservations.orgId, input.orgId),
            eq(schema.closingObservations.clientId, challenge.clientId),
            eq(schema.closingObservations.year, challenge.year),
            gte(schema.closingObservations.createdAt, challenge.startedAt),
          ),
        );
      const outcome = settleActiveChallenge({
        challenger: challenge.userId,
        startedAt: challenge.startedAt,
        completedPeriods: periods.filter((period) => period.status === "completed"),
        observationsSinceStart: observations.value,
      });

      if (outcome.status === "completed") {
        rules ??= await loadChallengeRules(tx, input.orgId);
        const inTime = outcome.completedAt.getTime() <= challenge.deadlineAt.getTime();
        const award = challengeAward({
          inTime,
          baseXp: challenge.baseXp,
          bonusXp: challenge.bonusXp,
          paidToday: await countPaidToday(tx, input.orgId, challenge.userId),
          dailyPaidCap: rules.dailyPaidCap,
        });
        [current] = await tx
          .update(schema.closingChallenges)
          .set({
            status: "completed",
            endedAt: outcome.completedAt,
            closingId: outcome.closingId,
            inTime,
            awardedXp: award.awardedXp,
            capped: award.capped,
          })
          .where(
            and(
              eq(schema.closingChallenges.orgId, input.orgId),
              eq(schema.closingChallenges.id, challenge.id),
            ),
          )
          .returning();
      } else if (outcome.status !== "active") {
        [current] = await tx
          .update(schema.closingChallenges)
          .set({ status: outcome.status, endedAt: new Date() })
          .where(
            and(
              eq(schema.closingChallenges.orgId, input.orgId),
              eq(schema.closingChallenges.id, challenge.id),
            ),
          )
          .returning();
      }
    }

    const linked = current.closingId
      ? periods.find((period) => period.id === current.closingId)
      : undefined;
    const held = challengeHeldXp({
      status: current.status,
      awardedXp: current.awardedXp,
      linkedPeriodClosedByChallenger:
        linked?.status === "completed" && linked.completedBy === current.userId,
    });
    const [ledger] = await tx
      .select({ net: sql<number>`coalesce(sum(${schema.xpLedger.amount}), 0)::int` })
      .from(schema.xpLedger)
      .where(
        and(
          eq(schema.xpLedger.orgId, input.orgId),
          eq(schema.xpLedger.closingChallengeId, current.id),
        ),
      );
    const entry = challengeXpEntry({ net: ledger.net, held });
    if (entry) {
      await tx.insert(schema.xpLedger).values({
        orgId: input.orgId,
        userId: current.userId,
        closingChallengeId: current.id,
        amount: entry.amount,
        reason: entry.reason,
      });
    }
  }
}

/** Desafios que já pagaram XP hoje (dia de São Paulo) para esta pessoa. */
async function countPaidToday(tx: OrgTx, orgId: string, userId: string): Promise<number> {
  const [row] = await tx
    .select({ value: count() })
    .from(schema.closingChallenges)
    .where(
      and(
        eq(schema.closingChallenges.orgId, orgId),
        eq(schema.closingChallenges.userId, userId),
        eq(schema.closingChallenges.status, "completed"),
        gt(schema.closingChallenges.awardedXp, 0),
        gte(schema.closingChallenges.endedAt, START_OF_TODAY_SP),
      ),
    );
  return row.value;
}
```

  Período que mudou de empresa ou de ano some de `periods` do desafio antigo —
  `linked` fica indefinido e o XP é estornado. Período excluído zera o
  `closing_id` pelo FK; mesmo efeito.

- [ ] **Passo 3: `npx tsc --noEmit -p tsconfig.json`** e commit:
  `git commit -m "feat: sync do desafio do dado com o ledger"`.

---

### Tarefa 5: porta única de escrita

**Arquivos:** criar `src/lib/closings/period-writes.ts` e
`src/lib/closings/period-writes.guard.test.ts`; modificar `closing-actions.ts`,
`src/lib/closings/task-sync.ts`, `src/lib/informatives/confirm.ts`,
`src/lib/mcp/operational-commands.ts`.

- [ ] **Passo 1: o teste de guarda** (`period-writes.guard.test.ts`)

```ts
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "vitest";

/**
 * Toda escrita em período e toda observação nova precisam passar pela porta
 * única, que chama o sync do desafio do dado. Um caminho esquecido deixaria
 * desafio sem desfecho e XP errado em silêncio — foi assim com o Fluxo
 * Societário, que tinha cinco portas e uma ficou sem a regra.
 */
const SRC = path.resolve(process.cwd(), "src");
const PORTA = path.join(SRC, "lib", "closings", "period-writes.ts");
const ESCRITAS = [
  /\.(insert|update|delete)\(\s*schema\.accountingClosings\s*\)/,
  /\.insert\(\s*schema\.closingObservations\s*\)/,
];

function arquivos(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entrada) => {
    const caminho = path.join(dir, entrada.name);
    if (entrada.isDirectory()) return arquivos(caminho);
    return /\.tsx?$/.test(entrada.name) && !/\.test\.tsx?$/.test(entrada.name) ? [caminho] : [];
  });
}

test("só a porta única grava períodos e cria observações", () => {
  const foraDaPorta = arquivos(SRC)
    .filter((arquivo) => arquivo !== PORTA)
    .filter((arquivo) => {
      const codigo = readFileSync(arquivo, "utf8");
      return ESCRITAS.some((escrita) => escrita.test(codigo));
    })
    .map((arquivo) => path.relative(SRC, arquivo).replaceAll("\\", "/"));
  expect(foraDaPorta).toEqual([]);
});
```

- [ ] **Passo 2: rodar e ver falhar** — `npx vitest run src/lib/closings/period-writes.guard.test.ts`
  (esperado: lista `app/(app)/clans/[id]/closing-actions.ts`,
  `lib/closings/task-sync.ts`, `lib/informatives/confirm.ts`,
  `lib/mcp/operational-commands.ts`).

- [ ] **Passo 3: a porta** (`src/lib/closings/period-writes.ts`)

```ts
import "server-only";

import { and, eq, type SQL } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";

import { syncClosingChallenges } from "./challenge-sync";

/**
 * Porta única de escrita dos Fechamentos: todo INSERT/UPDATE/DELETE de
 * período e todo INSERT de observação passam por aqui, e cada um termina
 * chamando o sync do desafio do dado na mesma transação. O teste
 * `period-writes.guard.test.ts` reprova escrita direta fora deste arquivo.
 */

type NewClosing = typeof schema.accountingClosings.$inferInsert;
type ClosingPatch = Partial<Omit<NewClosing, "id" | "orgId">>;
type NewObservation = typeof schema.closingObservations.$inferInsert;

export async function createClosingPeriod(
  tx: OrgTx,
  values: NewClosing,
): Promise<schema.AccountingClosing> {
  const [created] = await tx.insert(schema.accountingClosings).values(values).returning();
  await syncClosingChallenges(tx, { orgId: values.orgId, clientIds: [created.clientId] });
  return created;
}

/**
 * Lê a linha com lock antes de gravar porque a edição pode trocar a empresa
 * (ou o ano) do período: as duas empresas precisam do sync. `where` soma
 * condições às de organização e id — devolve null quando nada foi gravado.
 */
export async function updateClosingPeriod(
  tx: OrgTx,
  input: { orgId: string; closingId: string; where?: SQL; set: ClosingPatch },
): Promise<schema.AccountingClosing | null> {
  const [before] = await tx
    .select({ clientId: schema.accountingClosings.clientId })
    .from(schema.accountingClosings)
    .where(
      and(
        eq(schema.accountingClosings.orgId, input.orgId),
        eq(schema.accountingClosings.id, input.closingId),
      ),
    )
    .for("update");
  if (!before) return null;

  const [updated] = await tx
    .update(schema.accountingClosings)
    .set(input.set)
    .where(
      and(
        eq(schema.accountingClosings.orgId, input.orgId),
        eq(schema.accountingClosings.id, input.closingId),
        input.where,
      ),
    )
    .returning();
  if (!updated) return null;

  await syncClosingChallenges(tx, {
    orgId: input.orgId,
    clientIds: [before.clientId, updated.clientId],
  });
  return updated;
}

export async function deleteClosingPeriod(
  tx: OrgTx,
  input: { orgId: string; closingId: string },
): Promise<{ id: string; clientId: string } | null> {
  const [deleted] = await tx
    .delete(schema.accountingClosings)
    .where(
      and(
        eq(schema.accountingClosings.orgId, input.orgId),
        eq(schema.accountingClosings.id, input.closingId),
      ),
    )
    .returning({
      id: schema.accountingClosings.id,
      clientId: schema.accountingClosings.clientId,
    });
  if (!deleted) return null;
  await syncClosingChallenges(tx, { orgId: input.orgId, clientIds: [deleted.clientId] });
  return deleted;
}

/** Observação nova encerra o desafio em andamento da empresa como travado. */
export async function createClosingObservation(
  tx: OrgTx,
  values: NewObservation,
): Promise<schema.ClosingObservation> {
  const [created] = await tx.insert(schema.closingObservations).values(values).returning();
  await syncClosingChallenges(tx, { orgId: values.orgId, clientIds: [created.clientId] });
  return created;
}
```

- [ ] **Passo 4: migrar os 13 caminhos** (cada um troca a escrita direta pela
  função da porta; o resto da função fica igual):
  1. `closing-actions.ts` `createClosing`: `const created = await createClosingPeriod(tx, { …mesmos valores… });`
  2. `updateClosing`: `await updateClosingPeriod(tx, { orgId: ctx.orgId, closingId: closing.id, set: { …mesmo set… } });`
  3. `setClosingStatus`: `const row = await updateClosingPeriod(tx, { orgId: ctx.orgId, closingId: parsed.data.closingId, set: { …mesmo set… } });` — `row.title`/`row.clientId` continuam disponíveis.
  4. `deleteClosing`: `const deleted = await deleteClosingPeriod(tx, { orgId: ctx.orgId, closingId: parsed.data.closingId }); if (!deleted) return err("Fechamento não encontrado.");`
  5. `createClosingFromTask`: `const created = await createClosingPeriod(tx, { …mesmos valores… });`
  6. `addClosingObservation`: `const created = await createClosingObservation(tx, { …mesmos valores… });`
  7–8. `task-sync.ts`: os dois UPDATEs viram
     `updateClosingPeriod(tx, { orgId: task.orgId, closingId: task.closingId, where: ne(schema.accountingClosings.status, "completed"), set: {…} })`
     e `updateClosingPeriod(tx, { orgId: task.orgId, closingId: task.closingId, where: eq(schema.accountingClosings.completedByTaskId, task.id), set: replacement ? {…} : {…} })`.
  9. `informatives/confirm.ts`: `const createdClosing = await createClosingPeriod(tx, { …mesmos valores… });`
  10. MCP `createClosingCommand`: `const created = await createClosingPeriod(tx, {…});` (o resultado usa `created.id` e `created.updatedAt`).
  11. MCP `updateClosingCommand`: `await updateClosingPeriod(tx, { orgId: input.actor.orgId, closingId: closing.id, set: {…} });`
  12. MCP `setClosingStatusCommand`: idem, com o set de status.
  13. MCP `deleteClosingCommand` e `addClosingObservationCommand`: `deleteClosingPeriod` / `createClosingObservation`.

  Remover imports que ficarem sem uso (o tsc e o lint apontam).

- [ ] **Passo 5: rodar a guarda e a suíte** — `npx vitest run` (esperado: guarda passa, todos os testes passam) e `npx tsc --noEmit -p tsconfig.json`.
- [ ] **Passo 6: commit** — `git commit -m "refactor: porta unica de escrita dos Fechamentos chama o sync do desafio"`.

---

### Tarefa 6: ações do desafio

**Arquivos:** modificar `src/lib/closings-ui.ts`; criar
`src/lib/closings/challenge-pool.ts` e
`src/app/(app)/clans/[id]/closing-challenge-actions.ts`.

- [ ] **Passo 1: regimes por grupo em `closings-ui.ts`** (dados puros, sem drizzle):

```ts
/** Regimes cadastrais que cada grupo da aba Fechamentos reúne. */
export const CLOSING_GROUP_REGIMES: Record<ClosingGroup, readonly string[]> = {
  mei: ["mei"],
  simples: ["simples"],
  presumido_association: ["presumido", "association"],
  real: ["real"],
};

/** O grupo da aba onde uma empresa deste regime aparece. */
export function closingGroupForRegime(taxRegime: string): ClosingGroup {
  const entry = (Object.entries(CLOSING_GROUP_REGIMES) as [ClosingGroup, readonly string[]][])
    .find(([, regimes]) => regimes.includes(taxRegime));
  return entry?.[0] ?? "simples";
}
```

- [ ] **Passo 2: `challenge-pool.ts`**

```ts
import "server-only";

import { and, asc, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { challengePool } from "@/domain/closing-challenge";
import { CLOSING_GROUP_REGIMES, type ClosingGroup } from "@/lib/closings-ui";

/**
 * Empresas que o servidor pode sortear: as do regime aberto na aba, com o ano
 * em aberto, sem período e sem observação no ano, e sem reserva de outro
 * desafio. A regra de elegibilidade é a mesma do dado (`closing-draw`).
 */
export async function loadChallengePool(
  tx: OrgTx,
  input: { orgId: string; year: number; group: ClosingGroup },
): Promise<{ id: string; name: string }[]> {
  const clients = await tx
    .select({ id: schema.clients.id, name: schema.clients.name })
    .from(schema.clients)
    .where(
      and(
        eq(schema.clients.orgId, input.orgId),
        eq(schema.clients.active, true),
        inArray(schema.clients.taxRegime, [...CLOSING_GROUP_REGIMES[input.group]]),
      ),
    )
    .orderBy(asc(schema.clients.name));
  if (clients.length === 0) return [];
  const ids = clients.map((client) => client.id);

  const [withPeriods, withObservations, closedYears, reserved] = [
    await tx
      .selectDistinct({ clientId: schema.accountingClosings.clientId })
      .from(schema.accountingClosings)
      .where(
        and(
          eq(schema.accountingClosings.orgId, input.orgId),
          inArray(schema.accountingClosings.clientId, ids),
          gte(schema.accountingClosings.dueDate, `${input.year}-01-01`),
          lte(schema.accountingClosings.dueDate, `${input.year}-12-31`),
        ),
      ),
    await tx
      .selectDistinct({ clientId: schema.closingObservations.clientId })
      .from(schema.closingObservations)
      .where(
        and(
          eq(schema.closingObservations.orgId, input.orgId),
          inArray(schema.closingObservations.clientId, ids),
          eq(schema.closingObservations.year, input.year),
        ),
      ),
    await tx
      .select({ clientId: schema.accountingClosingYears.clientId })
      .from(schema.accountingClosingYears)
      .where(
        and(
          eq(schema.accountingClosingYears.orgId, input.orgId),
          eq(schema.accountingClosingYears.year, input.year),
          isNotNull(schema.accountingClosingYears.closedAt),
          inArray(schema.accountingClosingYears.clientId, ids),
        ),
      ),
    await tx
      .select({ clientId: schema.closingChallenges.clientId })
      .from(schema.closingChallenges)
      .where(
        and(
          eq(schema.closingChallenges.orgId, input.orgId),
          eq(schema.closingChallenges.year, input.year),
          eq(schema.closingChallenges.status, "active"),
        ),
      ),
  ];
  const periodos = new Set(withPeriods.map((row) => row.clientId));
  const observacoes = new Set(withObservations.map((row) => row.clientId));
  const fechados = new Set(closedYears.map((row) => row.clientId));

  return challengePool(
    clients.map((client) => ({
      ...client,
      yearClosed: fechados.has(client.id),
      periodCount: periodos.has(client.id) ? 1 : 0,
      observationCount: observacoes.has(client.id) ? 1 : 0,
    })),
    new Set(reserved.map((row) => row.clientId)),
  ).map(({ id, name }) => ({ id, name }));
}
```

  (As quatro consultas ficam em sequência de propósito: o node-postgres não
  paraleliza dentro de uma transação.)

- [ ] **Passo 3: `closing-challenge-actions.ts`**

```ts
"use server";

import { randomInt } from "node:crypto";

import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { withOrgTx, type OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { CHALLENGE_RULE_LIMITS, challengeDeadline } from "@/domain/closing-challenge";
import { pickClosingDraw } from "@/domain/closing-draw";
import { err, requireMemberContext, type ActionResult } from "@/lib/action-context";
import { loadChallengePool } from "@/lib/closings/challenge-pool";
import { loadChallengeRules } from "@/lib/closings/challenge-rules";
import { requireClosingLeadership, requireClosingManager } from "@/lib/closings/gate";

/**
 * Ações do Desafio do dado. O sorteio é do servidor: se o navegador mandasse
 * a empresa, daria para escolher a fácil. As travas (um desafio por pessoa,
 * uma pessoa por empresa) são índices únicos parciais — clique duplo e duas
 * pessoas sorteando ao mesmo tempo batem no banco, não em sorte.
 */

const clanIdField = { clanId: z.uuid("Clã inválido.") };
const LIDERANCA = "Apenas a liderança da Contabilidade ou um admin pode fazer isso.";

const rollSchema = z.object({
  ...clanIdField,
  year: z.number().int().min(2000).max(2100),
  group: z.enum(["mei", "simples", "presumido_association", "real"]),
});

type RolledChallenge = { id: string; clientId: string; clientName: string };

async function activeChallengeOf(
  tx: OrgTx,
  orgId: string,
  userId: string,
): Promise<RolledChallenge | null> {
  const [row] = await tx
    .select({
      id: schema.closingChallenges.id,
      clientId: schema.closingChallenges.clientId,
      clientName: schema.clients.name,
    })
    .from(schema.closingChallenges)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.closingChallenges.clientId))
    .where(
      and(
        eq(schema.closingChallenges.orgId, orgId),
        eq(schema.closingChallenges.userId, userId),
        eq(schema.closingChallenges.status, "active"),
      ),
    );
  return row ?? null;
}

export async function rollClosingChallenge(
  input: z.input<typeof rollSchema>,
): Promise<ActionResult<RolledChallenge>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsed = rollSchema.safeParse(input);
  if (!parsed.success) return err("Dados inválidos.");
  const data = parsed.data;

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult<RolledChallenge>> => {
    const gate = await requireClosingManager(tx, ctx, data.clanId);
    if (!gate.ok) return gate;

    // Rolar com desafio em andamento devolve o que já existe: é o clique duplo.
    const existing = await activeChallengeOf(tx, ctx.orgId, ctx.userId);
    if (existing) return { ok: true, data: existing };

    const rules = await loadChallengeRules(tx, ctx.orgId);
    let pool = await loadChallengePool(tx, {
      orgId: ctx.orgId,
      year: data.year,
      group: data.group,
    });
    // Quem desistiu e rola de novo não recebe a mesma empresa, se houver outra.
    const [last] = await tx
      .select({
        clientId: schema.closingChallenges.clientId,
        status: schema.closingChallenges.status,
      })
      .from(schema.closingChallenges)
      .where(
        and(
          eq(schema.closingChallenges.orgId, ctx.orgId),
          eq(schema.closingChallenges.userId, ctx.userId),
        ),
      )
      .orderBy(desc(schema.closingChallenges.startedAt))
      .limit(1);
    const previousId = last?.status === "abandoned" ? last.clientId : null;

    for (let tentativa = 0; tentativa < 3; tentativa += 1) {
      const pick = pickClosingDraw(pool, previousId, () => randomInt(1_000_000) / 1_000_000);
      if (!pick) return err(`Nenhuma empresa livre para sortear em ${data.year}.`);

      const startedAt = new Date();
      const [created] = await tx
        .insert(schema.closingChallenges)
        .values({
          orgId: ctx.orgId,
          userId: ctx.userId,
          clientId: pick.id,
          year: data.year,
          startedAt,
          deadlineAt: challengeDeadline(startedAt, rules.timeLimitMinutes),
          timeLimitMinutes: rules.timeLimitMinutes,
          baseXp: rules.baseXp,
          bonusXp: rules.bonusXp,
        })
        .onConflictDoNothing()
        .returning({ id: schema.closingChallenges.id });
      if (created) {
        return { ok: true, data: { id: created.id, clientId: pick.id, clientName: pick.name } };
      }
      // Conflito: ou outra aba desta pessoa rolou agora, ou outra pessoa
      // reservou esta empresa no mesmo instante.
      const mine = await activeChallengeOf(tx, ctx.orgId, ctx.userId);
      if (mine) return { ok: true, data: mine };
      pool = pool.filter((company) => company.id !== pick.id);
    }
    return err("Não consegui reservar uma empresa agora. Tente rolar de novo.");
  });

  if (result.ok) revalidatePath("/clans/[id]", "page");
  return result;
}

const endSchema = z.object({ ...clanIdField, challengeId: z.uuid("Desafio inválido.") });

export async function abandonClosingChallenge(
  input: z.input<typeof endSchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsed = endSchema.safeParse(input);
  if (!parsed.success) return err("Dados inválidos.");

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult> => {
    const gate = await requireClosingManager(tx, ctx, parsed.data.clanId);
    if (!gate.ok) return gate;
    const [ended] = await tx
      .update(schema.closingChallenges)
      .set({ status: "abandoned", endedAt: new Date(), endedBy: ctx.userId })
      .where(
        and(
          eq(schema.closingChallenges.orgId, ctx.orgId),
          eq(schema.closingChallenges.id, parsed.data.challengeId),
          eq(schema.closingChallenges.userId, ctx.userId),
          eq(schema.closingChallenges.status, "active"),
        ),
      )
      .returning({ id: schema.closingChallenges.id });
    if (!ended) return err("Este desafio não está mais em andamento.");
    return { ok: true };
  });

  if (result.ok) revalidatePath("/clans/[id]", "page");
  return result;
}

/** Liderança libera a reserva de outra pessoa — vira desistência, sem XP. */
export async function releaseClosingChallenge(
  input: z.input<typeof endSchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsed = endSchema.safeParse(input);
  if (!parsed.success) return err("Dados inválidos.");

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult> => {
    const gate = await requireClosingLeadership(tx, ctx, parsed.data.clanId, LIDERANCA);
    if (!gate.ok) return gate;
    const [ended] = await tx
      .update(schema.closingChallenges)
      .set({ status: "abandoned", endedAt: new Date(), endedBy: ctx.userId })
      .where(
        and(
          eq(schema.closingChallenges.orgId, ctx.orgId),
          eq(schema.closingChallenges.id, parsed.data.challengeId),
          eq(schema.closingChallenges.status, "active"),
        ),
      )
      .returning({ id: schema.closingChallenges.id });
    if (!ended) return err("Este desafio não está mais em andamento.");
    return { ok: true };
  });

  if (result.ok) revalidatePath("/clans/[id]", "page");
  return result;
}

function ruleField(key: keyof typeof CHALLENGE_RULE_LIMITS, label: string) {
  const { min, max } = CHALLENGE_RULE_LIMITS[key];
  return z
    .number({ error: `${label}: informe um número.` })
    .int(`${label}: use um número inteiro.`)
    .min(min, `${label}: o mínimo é ${min}.`)
    .max(max, `${label}: o máximo é ${max}.`);
}

const settingsSchema = z.object({
  ...clanIdField,
  timeLimitMinutes: ruleField("timeLimitMinutes", "Prazo"),
  baseXp: ruleField("baseXp", "XP ao fechar"),
  bonusXp: ruleField("bonusXp", "Bônus no prazo"),
  dailyPaidCap: ruleField("dailyPaidCap", "Desafios pagos por dia"),
});

export async function updateClosingChallengeSettings(
  input: z.input<typeof settingsSchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Regras inválidas.");
  const { clanId, ...rules } = parsed.data;

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult> => {
    const gate = await requireClosingLeadership(tx, ctx, clanId, LIDERANCA);
    if (!gate.ok) return gate;
    const now = new Date();
    await tx
      .insert(schema.closingChallengeSettings)
      .values({ orgId: ctx.orgId, ...rules, updatedBy: ctx.userId, updatedAt: now })
      .onConflictDoUpdate({
        target: schema.closingChallengeSettings.orgId,
        set: { ...rules, updatedBy: ctx.userId, updatedAt: now },
      });
    return { ok: true };
  });

  if (result.ok) revalidatePath("/clans/[id]", "page");
  return result;
}
```

- [ ] **Passo 4: `npx tsc --noEmit -p tsconfig.json`, `npm run lint`** e commit:
  `git commit -m "feat: acoes do desafio do dado"`.

---

### Tarefa 7: dados da faixa, aba e página

**Arquivos:** criar `src/lib/closings/challenge-board.ts`; modificar
`closings-tab.tsx`, `page.tsx`.

- [ ] **Passo 1: `challenge-board.ts`**

```ts
import "server-only";

import { and, desc, eq, gte, or, sql } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import type { ChallengeRules } from "@/domain/closing-challenge";

import { loadChallengeRules, START_OF_TODAY_SP } from "./challenge-rules";

export interface ChallengeBoardData {
  rules: ChallengeRules;
  paidToday: number;
  mine: {
    id: string;
    clientId: string;
    clientName: string;
    taxRegime: string;
    year: number;
    status: schema.ClosingChallenge["status"];
    startedAt: Date;
    deadlineAt: Date;
    endedAt: Date | null;
    endedBy: string | null;
    inTime: boolean | null;
    awardedXp: number | null;
    capped: boolean;
  } | null;
  playing: {
    id: string;
    userId: string;
    userName: string;
    clientId: string;
    clientName: string;
    year: number;
    deadlineAt: Date;
  }[];
  scoreboard: { userId: string; userName: string; closed: number; xp: number }[];
}

/**
 * Tudo que a faixa do desafio mostra: as regras, o desafio da pessoa (em
 * andamento, ou o último que terminou hoje), quem está jogando agora e o
 * placar do dia. O placar só conta desafio cujo período continua fechado por
 * quem rolou — o mesmo critério do XP retido.
 */
export async function loadChallengeBoard(
  tx: OrgTx,
  input: { orgId: string; viewerId: string },
): Promise<ChallengeBoardData> {
  const rules = await loadChallengeRules(tx, input.orgId);
  const challenge = schema.closingChallenges;

  const [mine] = await tx
    .select({
      id: challenge.id,
      clientId: challenge.clientId,
      clientName: schema.clients.name,
      taxRegime: schema.clients.taxRegime,
      year: challenge.year,
      status: challenge.status,
      startedAt: challenge.startedAt,
      deadlineAt: challenge.deadlineAt,
      endedAt: challenge.endedAt,
      endedBy: challenge.endedBy,
      inTime: challenge.inTime,
      awardedXp: challenge.awardedXp,
      capped: challenge.capped,
    })
    .from(challenge)
    .innerJoin(schema.clients, eq(schema.clients.id, challenge.clientId))
    .where(
      and(
        eq(challenge.orgId, input.orgId),
        eq(challenge.userId, input.viewerId),
        or(eq(challenge.status, "active"), gte(challenge.endedAt, START_OF_TODAY_SP)),
      ),
    )
    .orderBy(desc(challenge.startedAt))
    .limit(1);

  const playing = await tx
    .select({
      id: challenge.id,
      userId: challenge.userId,
      userName: schema.user.name,
      clientId: challenge.clientId,
      clientName: schema.clients.name,
      year: challenge.year,
      deadlineAt: challenge.deadlineAt,
    })
    .from(challenge)
    .innerJoin(schema.user, eq(schema.user.id, challenge.userId))
    .innerJoin(schema.clients, eq(schema.clients.id, challenge.clientId))
    .where(and(eq(challenge.orgId, input.orgId), eq(challenge.status, "active")))
    .orderBy(challenge.deadlineAt);

  const closed = sql<number>`count(*)::int`;
  const xp = sql<number>`coalesce(sum(${challenge.awardedXp}), 0)::int`;
  const scoreboard = await tx
    .select({ userId: challenge.userId, userName: schema.user.name, closed, xp })
    .from(challenge)
    .innerJoin(schema.user, eq(schema.user.id, challenge.userId))
    .innerJoin(
      schema.accountingClosings,
      and(
        eq(schema.accountingClosings.id, challenge.closingId),
        eq(schema.accountingClosings.status, "completed"),
        eq(schema.accountingClosings.completedBy, challenge.userId),
      ),
    )
    .where(
      and(
        eq(challenge.orgId, input.orgId),
        eq(challenge.status, "completed"),
        gte(challenge.endedAt, START_OF_TODAY_SP),
      ),
    )
    .groupBy(challenge.userId, schema.user.name)
    .orderBy(desc(closed), desc(xp))
    .limit(5);

  // Conta como o teto conta: desafio concluído que pagou, mesmo que o
  // período tenha sido reaberto depois (quem reabre não ganha vaga no teto).
  const [paid] = await tx
    .select({ value: sql<number>`count(*)::int` })
    .from(challenge)
    .where(
      and(
        eq(challenge.orgId, input.orgId),
        eq(challenge.userId, input.viewerId),
        eq(challenge.status, "completed"),
        sql`${challenge.awardedXp} > 0`,
        gte(challenge.endedAt, START_OF_TODAY_SP),
      ),
    );

  return { rules, paidToday: paid.value, mine: mine ?? null, playing, scoreboard };
}
```

- [ ] **Passo 2: `closings-tab.tsx`** — novos props `viewerId: string` e
  `canConfigureChallenge: boolean`; dentro do `withOrgTx` chamar
  `loadChallengeBoard(tx, { orgId, viewerId })`; trocar o bloco do dado
  (`drawCandidates`/`ClosingDraw`) por:

```tsx
  const reservedThisYear = new Set(
    board.playing.filter((item) => item.year === year).map((item) => item.clientId),
  );
  const challengeCandidates = allCompanies
    .filter(
      (company) =>
        !reservedThisYear.has(company.id) &&
        isClosingDrawEligible({
          yearClosed: Boolean(company.yearClosedAt),
          periodCount: company.closings.length,
          observationCount: company.observations.length,
        }),
    )
    .map((company) => ({ id: company.id, name: company.name }));
  const mine = board.mine
    ? {
        id: board.mine.id,
        clientName: board.mine.clientName,
        // A empresa do desafio pode ser de outro regime ou ano que o aberto.
        href: href({
          year: board.mine.year,
          group: closingGroupForRegime(board.mine.taxRegime),
          q: board.mine.clientName,
          yearStatus: "all",
          periodStatus: "all",
          periodMonth: "all",
          observationStatus: "all",
        }),
        status: board.mine.status,
        startedAt: board.mine.startedAt.toISOString(),
        deadlineAt: board.mine.deadlineAt.toISOString(),
        endedAt: board.mine.endedAt?.toISOString() ?? null,
        inTime: board.mine.inTime,
        awardedXp: board.mine.awardedXp,
        capped: board.mine.capped,
        releasedByOther: Boolean(board.mine.endedBy && board.mine.endedBy !== viewerId),
      }
    : null;
```

  e passar para o quadro:

```tsx
        draw={
          <ClosingChallenge
            key={`${group}-${year}`}
            clanId={clanId}
            year={year}
            group={group}
            candidates={challengeCandidates}
            rules={board.rules}
            paidToday={board.paidToday}
            serverNow={new Date().toISOString()}
            mine={mine}
            playing={board.playing.map((item) => ({
              id: item.id,
              userName: item.userName,
              clientName: item.clientName,
              deadlineAt: item.deadlineAt.toISOString(),
              isMine: item.userId === viewerId,
            }))}
            scoreboard={board.scoreboard}
            canPlay={canManage}
            canConfigure={canConfigureChallenge}
          />
        }
```

  `new Date()` no corpo do Server Component reprova no lint (aprendizado do
  Cerebro): calcular `serverNow` dentro do `withOrgTx`
  (`const serverNow = new Date().toISOString()` junto das consultas) e
  passar a variável.

- [ ] **Passo 3: `page.tsx`** — importar `canDeleteClanClosing` e passar
  `viewerId={session.user.id}` e
  `canConfigureChallenge={canDeleteClanClosing(clanFacts)}` ao `ClosingsTab`.

- [ ] **Passo 4: `npx tsc --noEmit -p tsconfig.json`** (falha até a Tarefa 8
  criar o componente — fazer as Tarefas 7 e 8 no mesmo commit).

---

### Tarefa 8: a faixa do desafio

**Arquivos:** criar `src/app/(app)/clans/[id]/closing-challenge.tsx`; apagar
`closing-draw.tsx`; modificar `src/app/(app)/profile/page.tsx`.

- [ ] **Passo 1: o componente** — reaproveita de `closing-draw.tsx` o
  `DieFace`, os `PIPS`, `otherFace` e `otherCandidate`; o resto:

```tsx
"use client";

import { Dices, Settings2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CHALLENGE_RULE_LIMITS,
  challengeClock,
  challengeResult,
  type ChallengeRules,
  type ChallengeStatus,
} from "@/domain/closing-challenge";
import { DRAW_LANDING_DELAY_MS, DRAW_ROLL_DELAYS_MS } from "@/domain/closing-draw";
import type { ClosingGroup } from "@/lib/closings-ui";
import { cn } from "@/lib/utils";

import {
  abandonClosingChallenge,
  releaseClosingChallenge,
  rollClosingChallenge,
  updateClosingChallengeSettings,
} from "./closing-challenge-actions";

export interface ChallengeCandidate {
  id: string;
  name: string;
}

export interface MyChallengeView {
  id: string;
  clientName: string;
  href: string;
  status: ChallengeStatus;
  startedAt: string;
  deadlineAt: string;
  endedAt: string | null;
  inTime: boolean | null;
  awardedXp: number | null;
  capped: boolean;
  releasedByOther: boolean;
}

export interface PlayingView {
  id: string;
  userName: string;
  clientName: string;
  deadlineAt: string;
  isMine: boolean;
}

export interface ScoreView {
  userId: string;
  userName: string;
  closed: number;
  xp: number;
}

type DieState = "idle" | "rolling" | "landed";

/* PIPS, otherFace, otherCandidate e DieFace: copiados de closing-draw.tsx,
   com DieFace recebendo `state: DieState`. */

/**
 * Relógio da faixa corrigido pelo relógio do servidor: o prazo é gravado no
 * banco, e o computador de quem joga pode estar adiantado ou atrasado.
 */
function useServerNow(serverNow: string, running: boolean): number {
  const [now, setNow] = useState(() => Date.parse(serverNow));
  useEffect(() => {
    if (!running) return;
    const offset = Date.parse(serverNow) - Date.now();
    const id = window.setInterval(() => setNow(Date.now() + offset), 1000);
    return () => window.clearInterval(id);
  }, [serverNow, running]);
  return now;
}

const RULE_FIELDS = [
  { key: "timeLimitMinutes", label: "Prazo (minutos)" },
  { key: "baseXp", label: "XP ao fechar" },
  { key: "bonusXp", label: "Bônus no prazo (XP)" },
  { key: "dailyPaidCap", label: "Desafios pagos por dia" },
] as const;

function RulesDialog({ clanId, rules }: { clanId: string; rules: ChallengeRules }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function save(formData: FormData) {
    const values = Object.fromEntries(
      RULE_FIELDS.map((field) => [field.key, Number(formData.get(field.key))]),
    ) as Record<(typeof RULE_FIELDS)[number]["key"], number>;
    startTransition(async () => {
      const result = await updateClosingChallengeSettings({ clanId, ...values });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Regras do desafio salvas.");
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="touch-target"
          aria-label="Regras do desafio"
        >
          <Settings2 aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Regras do desafio</DialogTitle>
          <DialogDescription>
            Valem para as próximas roladas. Desafio em andamento segue as regras de
            quando foi rolado.
          </DialogDescription>
        </DialogHeader>
        <form action={save} className="grid gap-3">
          {RULE_FIELDS.map((field) => {
            const limits = CHALLENGE_RULE_LIMITS[field.key];
            return (
              <div key={field.key} className="grid gap-1.5">
                <Label htmlFor={`challenge-${field.key}`}>{field.label}</Label>
                <Input
                  id={`challenge-${field.key}`}
                  name={field.key}
                  type="number"
                  inputMode="numeric"
                  min={limits.min}
                  max={limits.max}
                  defaultValue={rules[field.key]}
                  required
                />
              </div>
            );
          })}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              Salvar regras
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Desafio do dado: rolar reserva a empresa e abre o prazo; fechar o período
 * na lista conclui (o servidor decide pelo sync da porta única). O giro
 * espera a resposta do servidor e assenta na empresa sorteada por ele.
 */
export function ClosingChallenge({
  clanId,
  year,
  group,
  candidates,
  rules,
  paidToday,
  serverNow,
  mine,
  playing,
  scoreboard,
  canPlay,
  canConfigure,
}: {
  clanId: string;
  year: number;
  group: ClosingGroup;
  candidates: readonly ChallengeCandidate[];
  rules: ChallengeRules;
  paidToday: number;
  serverNow: string;
  mine: MyChallengeView | null;
  playing: readonly PlayingView[];
  scoreboard: readonly ScoreView[];
  canPlay: boolean;
  canConfigure: boolean;
}) {
  const [rolling, setRolling] = useState(false);
  const [shown, setShown] = useState<ChallengeCandidate | null>(null);
  const [face, setFace] = useState(5);
  const [tick, setTick] = useState(0);
  const [landed, setLanded] = useState(false);
  const [pending, startTransition] = useTransition();
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const pendingTimers = timers.current;
    return () => pendingTimers.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const active = mine?.status === "active" ? mine : null;
  const finished = mine && mine.status !== "active" ? mine : null;
  const now = useServerNow(serverNow, Boolean(active) || playing.length > 0);
  const dieState: DieState = rolling ? "rolling" : landed ? "landed" : "idle";

  function spin(step: number) {
    setShown((current) => otherCandidate(candidates, current));
    setFace(otherFace);
    setTick((value) => value + 1);
    const delay = DRAW_ROLL_DELAYS_MS[Math.min(step, DRAW_ROLL_DELAYS_MS.length - 1)];
    timers.current.push(window.setTimeout(() => spin(step + 1), delay));
  }

  function roll() {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const startedAt = Date.now();
    const minimum = reduce
      ? 0
      : DRAW_ROLL_DELAYS_MS.reduce((sum, delay) => sum + delay, 0) + DRAW_LANDING_DELAY_MS;
    setRolling(true);
    if (!reduce && candidates.length > 0) spin(0);
    startTransition(async () => {
      const result = await rollClosingChallenge({ clanId, year, group });
      const wait = minimum - (Date.now() - startedAt);
      if (wait > 0) await new Promise((resolve) => window.setTimeout(resolve, wait));
      timers.current.splice(0).forEach((timer) => window.clearTimeout(timer));
      setRolling(false);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setShown({ id: result.data.clientId, name: result.data.clientName });
      setFace(1 + Math.floor(Math.random() * 6));
      setLanded(true);
    });
  }

  function abandon(challengeId: string) {
    startTransition(async () => {
      const result = await abandonClosingChallenge({ clanId, challengeId });
      if (!result.ok) toast.error(result.error);
    });
  }

  function release(challengeId: string) {
    startTransition(async () => {
      const result = await releaseClosingChallenge({ clanId, challengeId });
      if (!result.ok) toast.error(result.error);
      else toast.success("Empresa liberada para o sorteio.");
    });
  }

  const total = candidates.length;
  const rulesLine = `${rules.timeLimitMinutes} min · +${rules.baseXp} XP ao fechar · +${rules.bonusXp} no prazo · ${paidToday} de ${rules.dailyPaidCap} pagos hoje`;
  const result = finished && finished.status !== "active"
    ? challengeResult({
        status: finished.status,
        inTime: finished.inTime,
        awardedXp: finished.awardedXp,
        capped: finished.capped,
        startedAt: new Date(finished.startedAt),
        endedAt: finished.endedAt ? new Date(finished.endedAt) : null,
        releasedByOther: finished.releasedByOther,
      })
    : null;
  const clock = active ? challengeClock(Date.parse(active.deadlineAt), now) : null;

  return (
    <section
      aria-label="Desafio do dado"
      className={cn(
        "panel-cut grid min-w-0 grid-cols-1 gap-3 border bg-card/40 p-3",
        active ? "border-primary/40" : "border-border/70",
      )}
    >
      <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
        <DieFace face={face} state={dieState} />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1">
            <p className="hud-label">Desafio do dado</p>
            {canConfigure ? <RulesDialog clanId={clanId} rules={rules} /> : null}
          </div>
          {rolling ? (
            <p
              key={tick}
              aria-hidden
              className="truncate font-semibold text-muted-foreground motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-100"
            >
              {shown?.name ?? "…"}
            </p>
          ) : active && clock ? (
            <>
              <p className="truncate font-semibold">{active.clientName}</p>
              <p
                className={cn(
                  "font-mono text-sm tabular-nums",
                  clock.late ? "text-warning" : "text-primary",
                )}
              >
                {clock.late ? clock.label : `${clock.label} restantes`}
              </p>
            </>
          ) : finished && result ? (
            <>
              <p className="truncate font-semibold">{finished.clientName}</p>
              <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                {result.xp ? <span className="chip-loot">+{result.xp} XP</span> : null}
                {result.text}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {total === 0
                ? `Nenhuma empresa livre sem período nem observação em ${year}.`
                : `${total} ${total === 1 ? "empresa" : "empresas"} no sorteio de ${year}. A sorteada fica reservada para você.`}
            </p>
          )}
        </div>
        <div className="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-1 sm:justify-end">
          {active && !rolling ? (
            <>
              <Button asChild size="sm">
                <Link href={active.href}>Abrir na lista</Link>
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => abandon(active.id)}
              >
                Desistir
              </Button>
            </>
          ) : canPlay ? (
            <Button
              type="button"
              size="sm"
              variant={finished ? "outline" : "default"}
              onClick={roll}
              disabled={rolling || pending || total === 0}
              aria-busy={rolling}
            >
              <Dices aria-hidden />
              {finished ? "Rolar de novo" : "Rolar o dado"}
            </Button>
          ) : null}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{rulesLine}</p>
      {active ? (
        <p className="text-xs text-muted-foreground">
          Registre o período como fechado na lista para concluir. Observação nesta
          empresa encerra o desafio sem XP.
        </p>
      ) : null}

      {playing.length > 0 || scoreboard.length > 0 ? (
        <div className="grid min-w-0 grid-cols-1 gap-3 border-t border-border/50 pt-3 sm:grid-cols-2">
          <div className="grid min-w-0 grid-cols-1 content-start gap-1">
            <p className="hud-label">Jogando agora</p>
            {playing.length === 0 ? (
              <p className="text-xs text-muted-foreground">Ninguém com desafio aberto.</p>
            ) : (
              <ul className="grid min-w-0 grid-cols-1 divide-y divide-border/40">
                {playing.map((item) => {
                  const itemClock = challengeClock(Date.parse(item.deadlineAt), now);
                  return (
                    <li key={item.id} className="flex min-w-0 items-center justify-between gap-2 py-1 text-sm">
                      <span className="min-w-0 truncate">
                        {item.userName} · {item.clientName}
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        <span
                          className={cn(
                            "font-mono text-xs tabular-nums",
                            itemClock.late ? "text-warning" : "text-muted-foreground",
                          )}
                        >
                          {itemClock.label}
                        </span>
                        {canConfigure && !item.isMine ? (
                          <Button
                            type="button"
                            size="xs"
                            variant="ghost"
                            className="touch-target"
                            disabled={pending}
                            onClick={() => release(item.id)}
                          >
                            Liberar
                          </Button>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="grid min-w-0 grid-cols-1 content-start gap-1">
            <p className="hud-label">Placar de hoje</p>
            {scoreboard.length === 0 ? (
              <p className="text-xs text-muted-foreground">Ninguém fechou desafio hoje.</p>
            ) : (
              <ol className="grid min-w-0 grid-cols-1 divide-y divide-border/40">
                {scoreboard.map((row) => (
                  <li key={row.userId} className="flex min-w-0 items-center justify-between gap-2 py-1 text-sm">
                    <span className="min-w-0 truncate">{row.userName}</span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        {row.closed} {row.closed === 1 ? "fechada" : "fechadas"}
                      </span>
                      {row.xp > 0 ? <span className="chip-loot">+{row.xp} XP</span> : null}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      ) : null}

      <p className="sr-only" aria-live="polite">
        {active
          ? `Desafio em andamento: ${active.clientName}.`
          : finished && result
            ? `${finished.clientName}: ${result.xp ? `+${result.xp} XP, ` : ""}${result.text}.`
            : ""}
      </p>
    </section>
  );
}
```

- [ ] **Passo 2:** `git rm "src/app/(app)/clans/[id]/closing-draw.tsx"` (o
  `DieFace` e os auxiliares agora moram no componente novo). As funções
  `isClosingDrawEligible`, `pickClosingDraw` e os ritmos continuam em
  `src/domain/closing-draw.ts`, usados pelo servidor e pelo giro.

- [ ] **Passo 3: rótulos do perfil** — em `src/app/(app)/profile/page.tsx`,
  no `REASON_LABELS`:

```ts
  closing_challenge: "Desafio do dado",
  closing_challenge_reversal: "Desafio do dado revertido",
```

- [ ] **Passo 4:** `npx tsc --noEmit -p tsconfig.json`, `npx vitest run`,
  `npm run lint`, `npm run build` — tudo limpo.
- [ ] **Passo 5: commit** — `git commit -m "feat: faixa do desafio do dado com prazo, placar e regras"`.

---

### Tarefa 9: registro e conferência

- [ ] **Passo 1: `CLAUDE.md`** — seção nova depois de "Desfazer: janela de
  arrependimento", resumindo: rolar reserva a empresa (sorteio no servidor);
  fechar o período paga base + bônus no prazo, regras congeladas na rolada;
  teto diário é a trava de farm aceita pelo Bruno; observação trava, outra
  pessoa fechando encerra, reabrir estorna; toda escrita de período passa pela
  porta única (`period-writes.ts`) — não escrever direto, a guarda reprova.
- [ ] **Passo 2: banco local, se o Docker subir** (`npm run db:up`,
  `npm run db:migrate`, `npm run check:rls`): a migração aplica, as duas
  tabelas aparecem com RLS forçado. Sem Docker, a prova é a homologação.
- [ ] **Passo 3: conferência visual medida** — bundle de navegador do
  `ClosingOverview` com o `ClosingChallenge` e dados falsos (as ações
  trocadas por stubs no esbuild), CSS compilado do build, nos estados livre,
  rolando, em andamento (no prazo e atrasado) e terminado; medir que nada
  passa da faixa em 375, 870 e 1100px e que o giro assenta na empresa
  devolvida pelo stub.
- [ ] **Passo 4: os quatro portões** e `git push origin develop`; acompanhar o
  pipeline da homologação.
- [ ] **Passo 5: na homologação, com o Bruno logado:** rolar, fechar o período
  da sorteada, ver o XP no perfil; rolar e desistir; anotar observação
  (travado). É aqui que GRANT e RLS se provam.
- [ ] **Passo 6:** Cerebro (nota do projeto) e CRM (`registrar_sessao`).

---

## Autorrevisão

- **Cobertura do desenho:** rolar com sorteio no servidor (T6), reserva e um
  desafio por pessoa (T2 índices + T6), prazo e cronômetro (T1 + T8), base +
  bônus e teto (T1 + T4), observação trava e outra pessoa encerra (T1 + T4),
  desistir e liberar (T6 + T8), reabrir estorna (T4), regras configuráveis e
  congeladas (T2 + T6 + T8), placar e jogando agora (T7 + T8), porta única e
  guarda (T5), RLS/GRANT (T2), perfil (T8), CLAUDE.md (T9).
- **Nomes conferidos:** `settleActiveChallenge`, `challengeAward`,
  `challengeHeldXp`, `challengeXpEntry`, `challengeClock`, `challengeResult`,
  `challengePool`, `challengeDeadline`, `syncClosingChallenges`,
  `loadChallengeRules`, `START_OF_TODAY_SP`, `loadChallengePool`,
  `loadChallengeBoard`, `createClosingPeriod`, `updateClosingPeriod`,
  `deleteClosingPeriod`, `createClosingObservation`, `requireClosingActor`,
  `requireClosingManager`, `requireClosingLeadership`.
