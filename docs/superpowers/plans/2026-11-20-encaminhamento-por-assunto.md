# Encaminhamento por assunto dentro do clã — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** quando o agente encaminha ao clã, escolher uma pessoa (assunto da pessoa → responsável da Carteira → líder), atribuir a conversa a ela e avisar só quem foi escolhido.

**Architecture:** regras por clã em `support_routing_topics` (texto livre por pessoa e, no Fiscal, assuntos da Carteira). No teste do agente a lista vai ao prompt como o roster do Scharff (`blocoRoster`/`atendente_sugerido`, já portados e sem uso); a escolha final é uma função pura (`chooseRecipient`) que confere vínculo de clã, Carteira e líderes. `applyAgentDecision` grava a atribuição, o evento e a fila de avisos só para os escolhidos.

**Tech Stack:** Next.js 16, Drizzle + Postgres com RLS forçado, Zod, Vitest + PGlite.

Desenho: `docs/superpowers/specs/2026-11-20-encaminhamento-por-assunto-design.md`. Testes nesta máquina: `npx vitest run <arquivos> --maxWorkers=1 --no-file-parallelism`.

---

## Mapa de arquivos

| Arquivo | Papel |
|---|---|
| `src/domain/support-routing.ts` (novo) | Puro: `chooseRecipient`, `buildRoutingRoster`, `PORTFOLIO_ROSTER_ID` |
| `src/lib/support/triage/sectors.ts` | `sectorForClan` (inverso de `clanForSector`) |
| `src/lib/support/triage/classificacao.ts` | `OpcoesClassificacao.roster` |
| `src/lib/support/agent/routing.ts` (novo) | Ler/gravar regras, montar roster, resolver destinatários |
| `src/lib/support/agent/decision.ts` | Encaminhamento carrega `suggestedAttendant` |
| `src/lib/support/agent/turn.ts` | Roster no prompt; atribuição, evento e aviso pelo `chooseRecipient` |
| `src/lib/support/triage/shadow.ts` | `defaultClassifier` passa o roster |
| `src/lib/whatsapp/member-notifications.ts` | Aviso para uma lista de pessoas, não para o clã inteiro |
| `src/db/schema/support.ts`, `0107_support-routing-topics.sql`, `_journal.json` | Tabela nova |
| `src/app/(app)/atendimento/configuracoes/{routing-panel.tsx,routing-actions.ts,page.tsx}` | Cartão "Quem atende cada assunto" |

---

### Task 1: escolha da pessoa (puro)

**Files:** Create `src/domain/support-routing.ts`, `src/domain/support-routing.test.ts`; modify `src/lib/support/triage/sectors.ts` (+ teste em `sectors.test.ts`).

- [ ] Teste:

```ts
import { describe, expect, test } from "vitest";

import { buildRoutingRoster, chooseRecipient, PORTFOLIO_ROSTER_ID } from "./support-routing";

const maria = { userId: "maria", name: "Maria Souza", isLeader: false };
const joao = { userId: "joao", name: "João Lima", isLeader: true };
const ana = { userId: "ana", name: "Ana Costa", isLeader: false };

describe("quem recebe a conversa encaminhada", () => {
  test("pessoa indicada pela IA, se ainda é do clã", () => {
    expect(chooseRecipient({ suggested: "maria", members: [maria, joao], portfolioOwnerId: null })).toEqual({ assigneeUserId: "maria", notifyUserIds: ["maria"], label: "Maria Souza" });
    expect(chooseRecipient({ suggested: "fulano", members: [maria, joao], portfolioOwnerId: null })).toEqual({ assigneeUserId: "joao", notifyUserIds: ["joao"], label: "João Lima" });
  });

  test("Carteira vai ao responsável da empresa; sem ele, ao líder", () => {
    expect(chooseRecipient({ suggested: PORTFOLIO_ROSTER_ID, members: [maria, joao, ana], portfolioOwnerId: "ana" }).assigneeUserId).toBe("ana");
    expect(chooseRecipient({ suggested: PORTFOLIO_ROSTER_ID, members: [maria, joao], portfolioOwnerId: null }).assigneeUserId).toBe("joao");
    // Responsável que saiu do clã não recebe.
    expect(chooseRecipient({ suggested: PORTFOLIO_ROSTER_ID, members: [maria, joao], portfolioOwnerId: "ana" }).assigneeUserId).toBe("joao");
  });

  test("sem pessoa: líder único recebe; vários líderes são avisados; sem líder, o clã inteiro", () => {
    expect(chooseRecipient({ suggested: null, members: [maria, joao], portfolioOwnerId: null }).assigneeUserId).toBe("joao");
    const twoLeaders = [maria, joao, { ...ana, isLeader: true }];
    expect(chooseRecipient({ suggested: null, members: twoLeaders, portfolioOwnerId: null })).toEqual({ assigneeUserId: null, notifyUserIds: ["joao", "ana"], label: null });
    expect(chooseRecipient({ suggested: null, members: [maria, ana], portfolioOwnerId: null })).toEqual({ assigneeUserId: null, notifyUserIds: ["maria", "ana"], label: null });
  });
});

describe("lista enviada à IA", () => {
  test("pessoas com assunto escrito e a Carteira, com o setor do clã e o primeiro nome", () => {
    expect(
      buildRoutingRoster([
        { sector: "fiscal", members: [maria, joao], rules: [{ userId: "maria", topics: "parcelamento" }, { userId: null, topics: "guias de imposto" }, { userId: "saiu", topics: "x" }] },
        { sector: null, members: [ana], rules: [{ userId: "ana", topics: "folha" }] },
      ]),
    ).toEqual([
      { id: "maria", primeiroNome: "Maria", setores: ["fiscal"], atribuicoes: "parcelamento" },
      { id: PORTFOLIO_ROSTER_ID, primeiroNome: "Responsável da empresa (carteira)", setores: ["fiscal"], atribuicoes: "guias de imposto" },
    ]);
  });
});
```

- [ ] Implementação:

```ts
/**
 * Encaminhamento por assunto dentro do clã (2026-11-20): a IA indica a pessoa
 * pela lista de assuntos (roster do Scharff); aqui se decide quem recebe.
 * Puro, sem banco.
 */
import type { AtendenteRoster, SetorValido } from "@/lib/support/triage/classificacao";

/** Entrada especial do roster: o responsável da empresa na Carteira. */
export const PORTFOLIO_ROSTER_ID = "carteira";

export type RoutingMember = { userId: string; name: string; isLeader: boolean };
export type RoutingChoice = { assigneeUserId: string | null; notifyUserIds: string[]; label: string | null };

export function chooseRecipient(input: { suggested: string | null; members: readonly RoutingMember[]; portfolioOwnerId: string | null }): RoutingChoice {
  const member = (id: string | null) => (id ? input.members.find((m) => m.userId === id) : undefined);
  const person = input.suggested === PORTFOLIO_ROSTER_ID ? member(input.portfolioOwnerId) : member(input.suggested);
  if (person) return { assigneeUserId: person.userId, notifyUserIds: [person.userId], label: person.name };
  const leaders = input.members.filter((m) => m.isLeader);
  if (leaders.length === 1) return { assigneeUserId: leaders[0].userId, notifyUserIds: [leaders[0].userId], label: leaders[0].name };
  const notify = leaders.length > 1 ? leaders : input.members;
  return { assigneeUserId: null, notifyUserIds: notify.map((m) => m.userId), label: null };
}

/** Lista que vai ao prompt: só quem é do clã e tem assunto escrito, com o setor do clã. */
export function buildRoutingRoster(
  clans: readonly { sector: SetorValido | null; members: readonly RoutingMember[]; rules: readonly { userId: string | null; topics: string }[] }[],
): AtendenteRoster[] {
  return clans.flatMap((clan) => {
    if (!clan.sector || clan.sector === "outro") return [];
    const setores = [clan.sector];
    return clan.rules.flatMap((rule): AtendenteRoster[] => {
      if (rule.userId === null) return [{ id: PORTFOLIO_ROSTER_ID, primeiroNome: "Responsável da empresa (carteira)", setores, atribuicoes: rule.topics }];
      const person = clan.members.find((m) => m.userId === rule.userId);
      return person ? [{ id: person.userId, primeiroNome: person.name.split(/\s+/)[0] ?? person.name, setores, atribuicoes: rule.topics }] : [];
    });
  });
}
```

- [ ] `sectors.ts`: `sectorForClan(clan, clans)` devolve o setor cujo `clanForSector` é esse clã, ou null. Teste: Fiscal → "fiscal"; clã sem setor → null.
- [ ] `npx vitest run src/domain/support-routing.test.ts src/lib/support/triage/sectors.test.ts` → PASS; commit.

### Task 2: banco

- `support_routing_topics` no schema e na migração `0107_support-routing-topics.sql` (escrita à mão, entrada no journal):

```sql
CREATE TABLE "support_routing_topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"clan_id" uuid NOT NULL,
	"user_id" text,
	"topics" varchar(500) NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_routing_topics_topics_check" CHECK (length(btrim("topics")) > 0)
);
-- FKs: org (cascade), (org_id, clan_id) -> clans (cascade),
-- (org_id, clan_id, user_id) -> clan_memberships (cascade: quem sai do cla leva a regra),
-- updated_by -> user. Indices unicos parciais: pessoa por cla; Carteira por cla.
-- RLS org_isolation (ENABLE + FORCE) e GRANT SELECT, INSERT, UPDATE, DELETE.
```

- Teste de banco (Task 5) confere a cascata e o RLS.

### Task 3: repositório das regras

`src/lib/support/agent/routing.ts`:
- `loadRoutingSettings(tx, orgId)`: clãs ativos com integrantes (nome, líder), regras e se é o clã da Carteira (`FISCAL_CLAN_SLUG`).
- `loadRoutingRoster(tx, orgId)`: `buildRoutingRoster` com o setor de cada clã (`sectorForClan`).
- `resolveHandoffRecipients(tx, { orgId, clanId, suggested, clientId })`: integrantes do clã (com vínculo na organização), responsável da Carteira da empresa (só no clã da Carteira) e `chooseRecipient`.
- `saveClanRoutingTopics(tx, { orgId, actorId, clanId, people, portfolioTopics, now })`: só integrantes do clã; texto vazio apaga; Carteira só no clã da Carteira.

### Task 4: agente

- `OpcoesClassificacao.roster`; `defaultClassifier` passa `options.roster ?? []`.
- Encaminhamento classificado carrega `suggestedAttendant` (`classificacao.atendente_sugerido`).
- `runAgentTurn` passa o roster no modo conversa.
- `applyAgentDecision` no encaminhamento com clã: `resolveHandoffRecipients`, grava `assigned_user_id`, evento "encaminhou para Fiscal · Maria", e aviso só para `notifyUserIds`.
- `enqueueMemberSupportHandoffNotifications` recebe `userIds` em vez de `clanId` (filtra quem tem WhatsApp ligado e vínculo na organização).

### Task 5: testes de banco (agent.db.test.ts)

- Sem líder e sem regra, o clã inteiro recebe (teste atual continua).
- Parcelamento → Maria: atribuída, só ela avisada; a IA recebeu o roster com Maria e a Carteira.
- Guia com empresa vinculada → responsável da Carteira; sem empresa → líder.
- Assunto não identificado → líder.
- Quem sai do clã perde a regra.

### Task 6: tela

Cartão "Quem atende cada assunto" (`routing-panel.tsx`, `routing-actions.ts`, só admin), no padrão do `agent-test-panel.tsx`; medido renderizado como o anterior.

### Task 7: documentação e verificação

CLAUDE.md, tsc, lint, testes, build, commit, PR com OK do Bruno.
