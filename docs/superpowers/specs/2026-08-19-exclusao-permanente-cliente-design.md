# Exclusão permanente de empresa-cliente: design aprovado

Data: 2026-08-19. Decisões tomadas em diálogo com o usuário, com dois pontos
verificados empiricamente contra o Postgres local (não bastava supor).

## Problema

`clients` hoje só tem soft-delete (`active = false`, via `setClientActive`) —
decisão documentada no CLAUDE.md: "Sem DELETE: cliente sai de cena com
`active = false`". Mas o usuário cadastrou várias empresas de teste, já com
missões concluídas contra elas, e precisa removê-las de vez: empresa, missões,
fechamentos, carteira, compromissos — "tudo relacionado".

Isso tensiona com uma segunda regra inegociável do projeto: **XP é ledger
imutável**. Se a exclusão apaga a missão concluída, e a missão tem lançamento
de XP vinculado (`xp_ledger.task_id`), apagar esse vínculo às cegas mudaria
retroativamente nível e ranking de quem trabalhou na empresa.

A resposta do usuário resolveu a tensão: ele não quer *contornar* a
imutabilidade, quer o oposto — apagar empresa e missão **preservando** o XP já
creditado, só descartando o rastro de onde ele veio.

## Verificado empiricamente (não assumido)

Duas perguntas técnicas decidiam se este design era viável, e as duas só o
Postgres de verdade responde — não `tsc`, não teste unitário:

1. **`ON DELETE CASCADE` funciona numa tabela com `DELETE` revogado do role da
   aplicação?** Sim. Testado contra `guilda_app` com uma tabela filha com
   `DELETE` revogado (mesma configuração de `task_transfers`): o cascade
   apagou a linha filha mesmo assim. A ação de cascata roda com a autoridade
   da própria constraint (definida pelo owner), não do role que disparou o
   `DELETE` do pai.
2. **`ON DELETE SET NULL` funciona numa tabela com `UPDATE` revogado?** Sim,
   pelo mesmo motivo — testado contra uma tabela com `UPDATE`/`DELETE`
   revogados (mesma configuração de `xp_ledger`): o `parent_id` virou `null`,
   o resto da linha (o `amount`) ficou intacto.

Isso significa: a exclusão inteira pode ser um único `DELETE FROM clients`,
com o Postgres propagando tudo — sem precisar de função `SECURITY DEFINER`
nem de um DELETE manual em N passos como o de `deleteTask`.

## Decisões

- **Mecanismo: mudar o `ON DELETE` de cada FK que aponta para `clients`** (e,
  em cascata, as que apontam para `tasks`), em vez de um DELETE explícito
  multi-tabela em código. Mais simples, atômico, e o Postgres resolve a ordem
  de dependência sozinho — inclusive quando uma tabela nova passar a referenciar
  `clients` no futuro, desde que a FK declare o comportamento certo.
- **`xp_ledger.task_id` e `xp_ledger.closing_year_id` viram `ON DELETE SET
  NULL`**, não cascade. É o núcleo do pedido: o lançamento de XP nunca é
  tocado, só perde o vínculo. A tela de perfil já tem fallback pronto pra isso
  (`taskTitle ?? closingTitle ?? REASON_LABELS[reason]` — mostra "Missão
  concluída" genérico) — não precisa mudar nada ali.
- **`task_transfers` vira `ON DELETE CASCADE` a partir de `tasks`** — abre uma
  exceção pontual à regra "insert-only" que motivou bloquear `deleteTask` para
  missão já transferida. É uma exceção CONSCIENTE e ESCOPADA: só este fluxo
  (exclusão de empresa inteira, atrás de admin/owner + confirmação por nome)
  tem esse poder; `deleteTask` continua bloqueando missão transferida como
  hoje, porque ali a garantia de "nunca perde histórico de transferência"
  ainda vale.
- **`guild_notices.client_id` vira `ON DELETE SET NULL`**, não cascade: aviso
  já publicado no mural é comunicação que a Guilda já confirmou/leu, diferente
  de missão ou fechamento (trabalho interno). O texto do aviso já cita o nome
  da empresa como texto estático, então continua legível sem o vínculo.
- **Cascade puro** (a linha desaparece com o pai) para: `tasks`, `task_events`,
  `task_assignee_suggestions` (já tinha), `accounting_closings`,
  `accounting_closing_years`, `fiscal_portfolios`, `fiscal_portfolio_events`,
  `client_commitments`, `client_commitment_periods` (já tinha, a partir de
  `client_commitments`).
- **Permissão: admin/owner**, mais restrito que a desativação (que qualquer
  membro faz hoje) — o tamanho do estrago pede régua mais alta.
- **Confirmação: digitar o nome exato da empresa**, depois de ver um resumo
  (quantas missões, fechamentos, compromissos, se a carteira está com
  alguém). Mesmo padrão do GitHub para apagar repositório.
- **Não exige desativar antes de excluir**: digitar o nome já é a barreira
  principal; exigir "desative primeiro" só atrapalharia limpar dado de teste
  sem acrescentar proteção real.
- **`guild_notices` não é apagado**, só perde o vínculo — decisão acima.
- **Sem auditoria nova** (não registra "quem excluiu, quando"): é ferramenta
  de limpeza de teste, não valeu a complexidade agora. Fácil adicionar depois
  se precisar.

## Componentes

1. **Migration**: altera o `onDelete` das FKs listadas acima em
   `src/db/schema/domain.ts` (a maioria hoje é "no action", implícito por
   ausência de `onDelete`) e gera a migration correspondente. Sem mudança de
   RLS — as políticas de `org_isolation` já existem em todas essas tabelas.
   `check:rls` continua cobrindo o que já cobre; nada novo a adicionar lá,
   porque nenhuma tabela nova nasce.

2. **Server Action** `deleteClientPermanently` (`src/app/(app)/clients/actions.ts`):
   - Sessão + `isAdminRole` (não usa `canManageFiscalPortfolio`/liderança de
     clã — é ação de organização, não de clã específico).
   - Zod: `clientId` (uuid) + `confirmName` (string).
   - Dentro de `withOrgTx`: trava a linha do cliente (`FOR UPDATE`), confere
     `confirmName.trim() === client.name` (comparação exata), e só então
     `DELETE FROM clients WHERE id = $1 AND org_id = $2`.
   - Antes do delete, dentro da MESMA transação, uma query de contagem
     (missões, fechamentos, compromissos, se tem carteira) alimenta a
     mensagem de sucesso — não precisa de uma query separada fora da
     transação, porque tudo ainda existe até o DELETE rodar.

3. **UI**: em `/clients`, um botão de exclusão permanente por linha (visível
   só para admin/owner), abrindo um dialog com:
   - Resumo carregado antes de abrir (mesma contagem que a action usa) —
     "vai apagar N missões, M fechamentos, P compromissos" + aviso de que XP
     já creditado é preservado, mas o rastro (nome da missão) não.
   - Campo de texto que precisa bater com o nome exato da empresa para
     habilitar o botão "Excluir permanentemente".

## Fora de escopo

Auditoria de quem excluiu; exigir desativação prévia; exclusão em lote (uma
empresa por vez); qualquer mudança na regra de `deleteTask` (continua
bloqueando missão transferida — a exceção é só deste fluxo).

## Verificação

Os dois testes de mecanismo (CASCADE / SET NULL sob privilégio revogado) já
foram feitos contra o Postgres local antes de aprovar o design — repetir
sobre as tabelas reais depois da migration, não sobre tabelas de teste
descartáveis. Fluxo completo no navegador: criar empresa de teste, gerar
missão, concluir (creditando XP), excluir a empresa, confirmar que a missão
sumiu, o XP continua no perfil (com "Missão concluída" genérico no
histórico), e a empresa não aparece mais em `/clients`. `tsc`/lint/build
limpos. `check:rls` sem regressão nas tabelas existentes.
