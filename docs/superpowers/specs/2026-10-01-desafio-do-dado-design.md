# Desafio do dado nos Fechamentos — design aprovado

Data: 2026-10-01. Aprovado em conversa com o Bruno. Escopo: transformar o dado
que sorteia a próxima empresa a fechar (aba Fechamentos da Contabilidade, commit
`9e7206b`) num jogo com prazo e XP.

## Decisões do Bruno

- **Tempo = prazo da sorteada.** Rolou, a empresa fica reservada para quem
  rolou e começa a contar o prazo.
- **Prazo de 30 minutos**, porque é o tempo real de um fechamento — e
  **configurável**.
- **XP = base + bônus no prazo.** Fechar a sorteada sempre paga a base;
  dentro do prazo paga também o bônus. Quem estoura ainda tem motivo para
  terminar.
- **Trava contra XP fabricado = teto diário** de desafios pagos por pessoa.
  Depois do teto dá para continuar jogando, sem XP.
- **Placar visível**: quem está com qual empresa, quanto falta e quem fechou
  mais hoje.
- **Desafio como registro próprio** (não missão, não só no navegador). Missão
  entupiria "Para você fazer" com ~10 itens de 30 min por dia e usaria a
  fórmula dificuldade × prioridade; só no navegador não pode pagar XP (regra
  nº 1 do projeto).

## Como o jogo funciona

1. **Rolar** — o servidor sorteia a empresa entre as elegíveis do regime
   aberto na aba (a regra de `src/domain/closing-draw.ts`: ano em aberto, sem
   período lançado, sem observação), menos as reservadas por desafios em
   andamento. O sorteio sai do servidor para ninguém escolher a empresa fácil;
   o giro do navegador continua, e assenta na empresa que o servidor devolveu.
   Com desafio em andamento, o dado da pessoa fica travado.
2. **Fechar** — a pessoa registra o período como fechado na própria aba, do
   jeito de sempre. Ao gravar, o desafio termina e a faixa mostra o resultado
   ("+30 XP · no prazo em 18 min").
3. **Estourou o prazo** — o cronômetro vira "atrasado há N min" (cor
   `--warning`); o bônus some, a base continua valendo.
4. **Travou** — registrar observação na empresa durante o desafio o encerra
   sem XP e sem castigo. A faixa avisa isso enquanto o desafio corre.
5. **Desistir** — a empresa volta para o sorteio, sem XP. A liderança da
   Contabilidade e admin/owner podem **liberar** o desafio de outra pessoa
   (vira desistência) — é o que impede uma reserva presa para sempre.
6. **Fechada por outra pessoa** — se outra pessoa fechar a empresa reservada,
   o desafio termina sem XP. Só vale o fechamento de quem rolou.
7. **Teto do dia** — passou do teto de desafios pagos no dia (horário de São
   Paulo), o desafio ainda termina e conta no placar, mas paga 0 XP.
8. **Correções** — período reaberto ou excluído depois estorna o XP do
   desafio; fechado de novo, o XP volta. O desafio continua "fechado" no
   histórico; o XP acompanha o período.

## Regras configuráveis

| Regra | Padrão | Limites |
| ----- | ------ | ------- |
| Prazo | 30 min | 5 a 240 |
| Base | 15 XP | 0 a 100 |
| Bônus no prazo | 15 XP | 0 a 100 |
| Desafios pagos por dia | 10 | 0 a 50 |

Quem ajusta: liderança da Contabilidade e admin/owner (`canDeleteClanClosing`),
num "Regras do desafio" na própria faixa. **Cada desafio congela as regras do
momento da rolada** — mudar o prazo não altera desafio em andamento (mesmo
princípio do `xp_value` congelado na criação da missão).

## Dados

### `closing_challenges`

`id`, `org_id`, `user_id`, `client_id` (FK com `ON DELETE CASCADE`, igual aos
fechamentos — a exclusão permanente de empresa já depende das cascatas), `year`,
`started_at`, `deadline_at`, regras congeladas (`time_limit_minutes`,
`base_xp`, `bonus_xp`), `status` (`active` · `completed` · `abandoned` ·
`blocked` · `taken`), `ended_at`, `closing_id` (FK simples para
`accounting_closings`, `ON DELETE SET NULL` — nunca composta com SET NULL, que
zera o `org_id`), `in_time`, `awarded_xp` (congelado na conclusão; 0 quando
bateu o teto), `capped`.

Travas no banco, por índices únicos parciais `WHERE status = 'active'`:

- `(org_id, user_id)` — um desafio em andamento por pessoa;
- `(org_id, client_id, year)` — a reserva da empresa.

Clique duplo ou duas pessoas sorteando a mesma empresa no mesmo instante batem
no índice. Rolar com desafio ativo devolve o desafio que já existe.

### `closing_challenge_settings`

Uma linha por organização (`org_id` PK) com as quatro regras,
`updated_by`, `updated_at`. Sem linha, valem os padrões do domínio.

### `xp_ledger`

Coluna `closing_challenge_id` (FK simples, `ON DELETE SET NULL`) com índice de
leitura `(org_id, closing_challenge_id)`. Motivos novos:
`closing_challenge` ("Desafio do dado") e `closing_challenge_reversal`
("Desafio do dado revertido"). Ranking e perfil somam o ledger e passam a
mostrar sozinhos; `countCompletedTasks` continua contando só missões.

### Segurança

RLS `org_isolation` nas duas tabelas novas, como as demais. GRANT para
`guilda_app`: `SELECT, INSERT, UPDATE` em `closing_challenges` (desafio não se
apaga, termina) e `SELECT, INSERT, UPDATE` em `closing_challenge_settings`.
Permissão de banco não aparece em typecheck, lint nem teste: a primeira rolada
na homologação é a prova.

## Servidor

### Porta única de escrita (`src/lib/closings/period-writes.ts`)

Hoje 13 lugares gravam período ou observação: a aba (`createClosing`,
`updateClosing`, `setClosingStatus`, `deleteClosing`, `createClosingFromTask`,
`addClosingObservation`), o MCP (`createClosingCommand`,
`updateClosingCommand`, `setClosingStatusCommand`, `deleteClosingCommand`,
`addClosingObservationCommand`), o sync da missão (`syncClosingFromTask`) e a
confirmação de Informativo. Todos passam a usar as funções da porta
(`createClosingPeriod`, `updateClosingPeriod`, `deleteClosingPeriod`,
`createClosingObservation`), que gravam e chamam o sync do desafio na mesma
transação. `updateClosingPeriod` lê a linha com lock antes de gravar porque
`updateClosing` pode trocar a empresa do período — as duas empresas são
sincronizadas.

Um teste varre `src/` e reprova INSERT/UPDATE/DELETE em `accounting_closings`
e INSERT em `closing_observations` fora da porta. É a lição do Fluxo
Societário: um caminho esquecido deixou o sistema errado em silêncio.

### Sync do desafio (`src/lib/closings/challenge-sync.ts`)

`syncClosingChallenges(tx, { orgId, clientIds })` trava com `FOR UPDATE` os
desafios `active` e `completed` das empresas, lê os fatos e pede ao domínio o
desfecho:

- período **fechado por quem rolou**, depois do início → `completed`
  (`in_time` se `completed_at <= deadline_at`; prêmio base + bônus, ou 0 se o
  teto do dia já foi atingido);
- período fechado por outra pessoa → `taken`;
- observação criada depois do início → `blocked`;
- nada disso → continua `active` (atrasado ainda paga a base).

Depois acerta o ledger pelo saldo do desafio: deve haver `awarded_xp`
enquanto o período vinculado estiver fechado por quem rolou, e 0 caso
contrário. Rodar duas vezes não paga duas vezes; reabrir estorna; fechar de
novo recredita. O lock da linha do desafio serializa conciliações
concorrentes — o mesmo desenho de `reconcileClosingYearLedger`.

### Ações (`closing-challenge-actions.ts`)

- `rollClosingChallenge({ clanId, year, group })` — gate
  `canManageClanClosings`; sorteio com `crypto.randomInt`; congela as regras;
  conflito na reserva tenta outra empresa (até 3 vezes).
- `abandonClosingChallenge({ clanId, challengeId })` — só o dono.
- `releaseClosingChallenge({ clanId, challengeId })` — liderança/admin.
- `updateClosingChallengeSettings({ clanId, ... })` — liderança/admin, Zod
  com os limites da tabela acima.

## Tela

A faixa do sorteio (`closing-draw.tsx`) vira o Desafio do dado
(`closing-challenge.tsx`), no mesmo lugar do quadro "Andamento do ano":

- **Livre** — regras em uma linha ("30 min · +15 XP ao fechar · +15 no prazo
  · 3 de 10 pagos hoje") e "Rolar o dado".
- **Rolando** — o giro de hoje, que espera a resposta do servidor (mínimo de
  ~1 s) e assenta na empresa sorteada por ele.
- **Em andamento** — empresa, cronômetro, "Abrir na lista" e "Desistir". O
  cronômetro conta a partir do `deadline_at` do servidor, corrigido pela
  diferença entre o relógio do servidor (enviado na renderização) e o do
  navegador.
- **Terminado** — o resultado ("+30 XP · no prazo em 18 min", "+15 XP ·
  atrasado", "teto do dia: sem XP", "travado por observação", "fechado por
  outra pessoa") e "Rolar de novo".
- Abaixo: **jogando agora** (pessoa · empresa · tempo) e **placar de hoje**
  (desafios fechados e XP por pessoa).
- "Regras do desafio" (diálogo) só para liderança/admin.

O desafio ativo da pessoa aparece em qualquer regime da aba; o sorteio usa o
regime aberto.

## Testes

- Domínio (Vitest): desfecho, prêmio, teto, delta de XP, sorteio,
  cronômetro, limites das regras.
- Guarda da porta única de escrita.
- Conferência visual medida (bundle de navegador com o CSS compilado), como no
  dado.
- Homologação: primeira rolada real — é onde GRANT e RLS se provam.

## Fora deste desenho

Aviso no Telegram, sequência de dias, XP por regime, espera depois de
desistir. Somar depois se o uso pedir.

> **Adendo (mesmo dia, pedido do Bruno):** o desafio ganhou ferramentas no
> MCP — `rolar_dado_fechamento`, `desistir_desafio_fechamento` e
> `consultar_desafio_fechamento` (esta com o saldo do desafio no ledger). A
> regra de rolar e desistir saiu das Server Actions para
> `src/lib/closings/challenge-commands.ts`, usada pelos dois lados; o MCP
> segue a régua das demais ferramentas de fechamento (admin/owner + escopo).

— claude, 01/10/2026
