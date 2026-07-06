# Fase 5b — Templates de campanha: design aprovado

Data: 2026-07-06. Segundo ciclo da Fase 5 (5a clientes ✓ → **5b templates** →
5c campanhas/instanciação → 5d pool/bônus).

## Decisões

- **Vários templates por regime** (sem unique (org, regime)): variações como
  "Fechamento anual" vs "trimestral" do mesmo regime. CONSEQUÊNCIA para a 5c:
  a criação de campanha precisa selecionar qual template usar por regime.
- **Qualquer membro** gerencia templates (consistente com clientes/5a).
- **UI mora na área "Campanhas"**: item novo na navegação (tab bar mobile vai
  a 7 colunas). `/campaigns` lista campanhas (estado vazio até a 5c) e tem a
  aba Templates; edição de checklist em página dedicada
  `/campaigns/templates/[id]`.
- **Delete físico permitido** (template e itens): nada os referencia — a
  instanciação da 5c COPIA os dados para `tasks`. Mudar/apagar template nunca
  altera campanhas já instanciadas.
- **Prioridade das tarefas materializadas será média (2)** — o XP estimado do
  template usa `calculateTaskXp(difficulty, 2)`. A 5c herda esta decisão.
- **Reordenação por setas ↑↓** (swap de order_index transacional), sem drag
  & drop — mobile-first, menos JS.

## Schema

- `mission_templates`: id uuid, org_id, name varchar(120), tax_regime (enum
  da 5a), created_at. Índice (org_id).
- `mission_template_items`: id uuid, org_id, template_id FK, title
  varchar(200), difficulty smallint 1–5 default 2, order_index smallint.
  Índice (org_id, template_id).
- RLS `org_isolation` em ambas (migration custom no padrão existente).

## Componentes

1. **Actions** (`src/app/(app)/campaigns/templates/actions.ts`):
   createTemplate, updateTemplate, deleteTemplate (itens na mesma transação),
   addTemplateItem (order_index = max+1), updateTemplateItem,
   deleteTemplateItem, moveTemplateItem (swap com vizinho). Zod +
   requireMemberContext + withOrgTx em todas.
2. **UI**: nav "Campanhas"; `/campaigns` (vazio 5c + tabs);
   `/campaigns/templates` (cards: nome, badge regime, nº itens, XP total
   estimado em mono ouro; criar via dialog);
   `/campaigns/templates/[id]` (renomear/regime, itens inline com pips de
   dificuldade clicáveis, editar, excluir com confirmação, setas ↑↓).

## Verificação

Vitest (suite existente verde), build, verificação manual: criar template
com 3 itens, reordenar, conferir XP estimado; screenshot.
