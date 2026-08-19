# Compromissos recorrentes por empresa-cliente: design aprovado

Data: 2026-08-19. Decisões tomadas em diálogo com o usuário (registradas
abaixo com a razão de cada escolha).

## Problema

O informativo de cliente novo traz, junto das ações pontuais, obrigações que
se repetem: "CONTABILIDADE - Fazer distribuição de lucros trimestral",
"FISCAL - controlar o Fator R". Hoje elas viram **texto**: observação no
mural, nota da carteira fiscal, ou — pior — uma missão avulsa "Configurar X"
que dá a impressão de que o assunto foi resolvido quando na verdade ele
volta todo trimestre.

Resultado: a recorrência continua morando em papel, cabeça e planilha. O
usuário quer o controle dentro da Guilda.

## O conceito que faltava

O projeto já tinha duas peças e faltava a terceira:

| Peça | O que é | Escopo |
|---|---|---|
| `mission_templates` | checklist reutilizável | por REGIME (todo cliente do Simples) |
| `accounting_closings` | ocorrência com prazo e situação | avulsa, uma por vez |
| **`client_commitments`** (nova) | **a regra recorrente** que gera ocorrências | por CLIENTE específico |

Um Compromisso é: "o Banrisul faz distribuição de lucros, trimestralmente, e
a Contabilidade responde por isso".

## Decisões

- **Linha de controle QUE VIRA missão** (não uma ou outra): é o mecanismo que
  já funciona nos fechamentos — `accounting_closings` ligado a `tasks` por
  `closingId`, com `syncClosingFromTask` mantendo os dois em sincronia. O
  compromisso replica esse padrão em vez de inventar outro.
- **Seção própria "Compromissos"**, não dentro de Fechamentos: fechamento é
  fechamento; compromisso recorrente é outra coisa, tem cadência visível e
  histórico de todos os períodos lado a lado. Como consequência boa, a seção
  serve a QUALQUER clã — o Fiscal também tem recorrência ("controlar o Fator
  R"), não só a Contabilidade.
- **Ano inteiro planejado, missão só na hora**: ao cadastrar o compromisso, as
  ocorrências do ano nascem todas (prazo = último dia do período, editável).
  É isso que dá o "controle total" — o ano visível de uma vez. Mas a MISSÃO
  só nasce quando o período chega, para não entupir a fila do clã em janeiro
  com trabalho de dezembro.
- **Geração da missão é manual, um clique** (ou em lote para as vencendo), não
  cron. O plano do ano fica visível e o vencido aparece destacado; alguém
  clica. Cron dá para adicionar depois — começar por ele seria construir
  infraestrutura antes de saber a cadência real de uso.
- **Compromisso é sempre de um cliente específico**, nunca de um regime. Para
  "todo cliente do Simples faz X" já existe `mission_templates`.
- **Nome "Compromisso"**, não "Obrigação": no vocabulário contábil brasileiro
  "obrigação (acessória)" já significa DCTF/EFD/declaração. O que chega no
  informativo é mais amplo — é o combinado com o cliente.
- **Permissão**: criar/editar compromisso e gerar missão é do líder do clã ou
  admin/owner (mesma régua de `canDistributeClanTasks` e
  `canManageFiscalPortfolio`). Membro comum enxerga, não mexe.

## Componentes

1. **Schema** (`src/db/schema/domain.ts` + migration com RLS):
   - enum `commitment_cadence`: `monthly` | `quarterly` | `semiannual` | `annual`
   - `client_commitments`: `org_id`, `clan_id`, `client_id`, `title`, `notes`,
     `cadence`, `difficulty` (alimenta o XP da missão), `active`,
     `source_informative_id` (proveniência), `created_by`, timestamps.
   - `client_commitment_periods`: `org_id`, `commitment_id`, `period_year`,
     `period_index`, `due_date`, `status`, `notes`, `completed_by`,
     `completed_at`, `task_id` (nulo até a missão nascer), timestamps.
     Único em `(org_id, commitment_id, period_year, period_index)` — regerar
     o ano é idempotente.
   - `tasks` ganha `commitment_period_id` nullable (o vínculo inverso, como
     `closing_id` já faz).
   - RLS `ENABLE` + `FORCE` + política `org_isolation` nas duas tabelas novas,
     e as duas entram no `scripts/check-rls.mjs`.

2. **Domínio puro** (`src/domain/commitments.ts` + teste):
   - `periodsForCadence(cadence, year)` → `[{ index, dueDate }]`. Mensal 1–12,
     trimestral 1–4, semestral 1–2, anual 1. Prazo = último dia do período.
   - `commitmentPeriodLabel(cadence, year, index)` → "1º tri/2026", "jan/2026",
     "1º sem/2026", "2026".
   - `canManageClanCommitments` em `guild-permissions.ts` (líder ou admin).

3. **Sincronia** (`src/lib/commitments/task-sync.ts`): espelha
   `syncClosingFromTask`. Missão vinculada concluída → período concluído
   (com `completed_by`/`completed_at`); reversão → período reaberto. Chamado
   do mesmo ponto de `transitionTask` que já chama o sync dos fechamentos.

4. **Server Actions** (`src/app/(app)/clans/[id]/commitment-actions.ts`):
   `createCommitment` (cria + gera os períodos do ano corrente),
   `updateCommitmentPeriod` (prazo, observação, concluir direto sem missão),
   `createMissionForPeriod` (gera a missão vinculada),
   `setCommitmentActive`, `generateCommitmentYear` (planejar o ano seguinte).
   Todas com Zod, sessão, `withOrgTx` e a régua de permissão acima.

5. **UI**: aba **Compromissos** em `src/lib/clan-tabs.ts`, disponível a todo
   clã (junto de Missões/Integrantes/Campanhas). `commitments-tab.tsx` (dados)
   + `commitment-board.tsx` (cliente), agrupando por empresa e mostrando a
   régua de períodos do ano — concluído, pendente, vencido — com o botão de
   gerar missão em cada período aberto.

6. **Integração com o informativo**: `informativeExtractionSchema` ganha
   `commitments: [{ sector, title, cadence, notes }]`; a regra no prompt
   reconhece linhas recorrentes de QUALQUER setor. Na prévia elas aparecem
   para conferência; ao confirmar, viram `client_commitments` com os períodos
   do ano. **Isto substitui a regra "Configurar X"** criada em 2026-08-18 —
   ela era um remendo por faltar exatamente este conceito, e sai junto.

## Fora de escopo

Cron de geração automática (o clique manual vem primeiro); compromisso por
regime (`mission_templates` já cobre); página de detalhe do cliente — hoje não
existe `/clients/[id]`, então a visão "todos os compromissos do Banrisul entre
clãs" fica para quando essa página existir.

## Verificação

Vitest nas funções puras (`periodsForCadence` nas quatro cadências, incluindo
ano bissexto e o último dia de cada período; `commitmentPeriodLabel`;
permissão) e no sync (período fecha com a missão, reabre na reversão).
`tsc`/lint/build limpos, `check:rls` cobrindo as tabelas novas, e verificação
no navegador contra o Postgres local: criar compromisso trimestral, ver o ano
planejado, gerar a missão de um período, concluí-la e confirmar que a
ocorrência fechou sozinha.
