# Guilda — Gestão de Tarefas Gamificada (nome provisório, fácil de trocar)

Plataforma multi-tenant de gestão de tarefas com sistema de recompensa (XP e níveis).
Cada empresa (organização/tenant) tem seus usuários, tarefas e leaderboard isolados.
Projeto de portfólio: qualidade de código e segurança são requisitos, não opcionais.

O produto tem DOIS modos de uso, construídos em ordem:
1. **Tarefas ad-hoc + gamificação** (Fases 1–4) — o núcleo, construído e validado primeiro.
2. **Campanhas / processo recorrente** (Fase 5) — orquestração de fechamento de N
   empresas-cliente via templates por regime. Só depois da equipe usar o núcleo.

NOMENCLATURA (decisão de 2026-07-06): na UI, tarefas se chamam **"missões"**
(rename apenas de texto visível — código, schema e URLs continuam em inglês:
`tasks`, `/tasks` etc.). O guarda-chuva da Fase 5 se chama **"Campanha"** na UI
(as tabelas continuam `missions`/`mission_*`), para não colidir com as missões
do dia a dia.

ATENÇÃO à distinção de duas entidades diferentes chamadas "empresa":
- **organization** = o TENANT (a conta dona do sistema; a contabilidade). Já modelada.
- **client** = as ~250 EMPRESAS-CLIENTE que são OBJETO do trabalho (Fase 5). Não são
  usuárias do sistema. Nunca confundir as duas.

## Stack

- **Next.js 15+ (App Router) + TypeScript estrito** — full-stack, único deploy
- **Drizzle ORM + PostgreSQL** (banco em VPS própria, já provisionado)
- **better-auth** com plugin de organizations (auth, sessões, membros, convites, papéis)
- **Tailwind CSS + shadcn/ui** — mobile-first, o app precisa funcionar bem no celular
- **Zod** para validação de todo input externo
- **Vitest** para testes da lógica de XP/níveis e do fluxo de aprovação
- Deploy: Docker (output standalone do Next) atrás de Caddy/Nginx com HTTPS na VPS

## Regras inegociáveis

1. **Todo cálculo de XP e nível acontece no servidor.** Nunca aceitar valores de XP,
   nível ou status vindos do cliente.
2. **Toda tabela de domínio tem `org_id`.** Nenhuma query roda sem filtro de organização.
3. **Row Level Security ativo no Postgres** em todas as tabelas de domínio, com política
   baseada em `current_setting('app.org_id')` setado por transação. A aplicação filtra
   por `org_id` E o banco garante o isolamento (defesa em profundidade).
4. **XP é um ledger imutável.** Nunca fazer UPDATE em saldo de XP. Crédito e estorno
   são sempre novos registros em `xp_ledger`.
5. Mutações via Server Actions com validação Zod + verificação de sessão + verificação
   de papel/permissão em cada action. Nunca confiar que "a UI não deixa".
6. Senhas e sessões: delegadas ao better-auth (não reimplementar).
7. Rate limiting nas rotas de auth (login, registro, convite).

## Modelo de domínio

### Tabelas (além das do better-auth: user, session, organization, member, invitation)

```sql
-- Enum de status do ciclo de vida da tarefa
CREATE TYPE task_status AS ENUM (
  'pending',            -- criada, ainda não iniciada
  'in_progress',        -- responsável começou
  'awaiting_approval',  -- responsável marcou como feita; aguarda aprovação
  'completed',          -- aprovada; XP creditado
  'rejected',           -- aprovador devolveu; volta a in_progress após ajuste
  'cancelled'
);

CREATE TABLE tasks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        text NOT NULL REFERENCES organization(id),
  creator_id    text NOT NULL REFERENCES "user"(id),
  assignee_id   text NOT NULL REFERENCES "user"(id),
  title         varchar(200) NOT NULL,
  description   text,
  priority      smallint NOT NULL DEFAULT 2,       -- 1 baixa, 2 média, 3 alta
  difficulty    smallint NOT NULL DEFAULT 2,       -- 1 a 5, define o XP
  xp_value      integer NOT NULL,                  -- congelado na criação (ver fórmula)
  status        task_status NOT NULL DEFAULT 'pending',
  due_date      timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);
CREATE INDEX ON tasks (org_id, assignee_id, status);
CREATE INDEX ON tasks (org_id, due_date);

-- Histórico de transições de status (auditoria)
CREATE TABLE task_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      text NOT NULL REFERENCES organization(id),
  task_id     uuid NOT NULL REFERENCES tasks(id),
  actor_id    text NOT NULL REFERENCES "user"(id),
  from_status task_status,
  to_status   task_status NOT NULL,
  note        text,                                -- ex.: motivo da rejeição
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Ledger imutável de XP (NUNCA sofre UPDATE/DELETE)
CREATE TABLE xp_ledger (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      text NOT NULL REFERENCES organization(id),
  user_id     text NOT NULL REFERENCES "user"(id),
  task_id     uuid REFERENCES tasks(id),
  amount      integer NOT NULL,                    -- positivo = crédito, negativo = estorno
  reason      varchar(50) NOT NULL,                -- 'task_completed', 'reversal', 'bonus', 'mission_completed'
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON xp_ledger (org_id, user_id);
```

### RLS (aplicar em tasks, task_events, xp_ledger)

```sql
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON tasks
  USING (org_id = current_setting('app.org_id', true));
-- Repetir para task_events e xp_ledger.
-- A aplicação seta `SET LOCAL app.org_id = $1` no início de cada transação,
-- usando um role de banco NÃO-superuser (RLS não se aplica a superuser/owner
-- sem FORCE — usar role dedicado para a aplicação).
```

## Regras de negócio da gamificação

- **XP da tarefa** definido na criação e congelado:
  `xp_value = difficulty * 20 + (priority - 1) * 10`
  (dificuldade 1–5 → 20 a 100 XP base; prioridade adiciona 0/10/20).
- **Fluxo de aprovação para tarefas de terceiros**: o responsável marca a tarefa
  como feita (`awaiting_approval`); só o **criador da tarefa** ou um **admin/owner**
  pode aprovar (→ `completed`, credita XP) ou rejeitar (→ `rejected`, com nota
  obrigatória). **Auto-tarefa (criador == responsável) NÃO passa por aprovação**:
  o responsável conclui direto (`in_progress → completed`, credita XP) — decisão
  de 2026-07-06 que substitui a regra anterior de exigir outro admin; o risco de
  farm de XP foi aceito conscientemente (reavaliar se o ranking degradar).
- **Crédito de XP é transacional e idempotente**: dentro da mesma transação da
  transição para `completed`, inserir no `xp_ledger`. Constraint de unicidade parcial
  `(task_id) WHERE reason = 'task_completed'` impede crédito duplo.
- **Nível**: derivado do XP total. Fórmula: XP necessário para o nível `n` é
  `floor(100 * n^1.5)` acumulado. Implementar `levelFromXp(totalXp)` puro e testado.
- **Leaderboard**: soma do ledger por usuário na org, período selecionável
  (semana / mês / geral). Query agregada, sem cache na v1.
- **Reversão**: se um admin reverter uma conclusão, inserir lançamento negativo no
  ledger (`reason = 'reversal'`) — nunca deletar o crédito original.

## Papéis (por organização, via better-auth member.role)

- **owner/admin**: tudo + aprovar qualquer tarefa + gerenciar membros e convites
- **member**: criar tarefas (para si ou colegas da org), atualizar as suas,
  aprovar tarefas que criou

## Estrutura por clã (decisões de 2026-08-18)

O clã deixou de ser um diretório da Guilda e virou o **espaço de trabalho** da
pessoa. Consequências, todas já implementadas:

- **Visibilidade**: member enxerga apenas os clãs em que tem vínculo; admin/owner
  veem todos. Quem tem um clã só é levado direto para ele em `/clans`
  (`src/domain/clan-access.ts`, puro e testado). Clã alheio responde 404, não 403.
- **A composição do clã (entrar, sair, liderança, clã principal) mudou para
  `/settings`, restrita a admin/owner.** Isto REVOGA a Decisão 7 da Mesa do Líder
  (o líder gerenciava os integrantes do próprio clã): como o vínculo passou a
  definir o que a pessoa vê, ele virou organograma. O líder continua dono do dia
  a dia — distribui missões e remaneja a carteira.
- **A página do clã tem abas**: Missões (a Mesa do Líder de sempre), Integrantes
  (leitura) e mais uma seção específica do clã quando existe — **Carteira** no
  Fiscal, **Fechamentos** na Contabilidade. Missões/Integrantes valem para todo
  clã; as outras são específicas porque o trabalho tem forma diferente em cada
  área, e enfiá-las em todo clã encheria a navegação de aba morta. A tabela
  aba→clã dono vive em `src/lib/clan-tabs.ts`.
- **Navegação do clã em dois grupos (2026-09-03)**: *Espaço da área* (as
  abas próprias do clã, primeiro e com moldura em `--primary`) e *Mesa do
  clã* (Missões, Integrantes). Motivo: a equipe achava o clã
  confuso e o Societário não achava o Fluxo numa fileira de sete rótulos
  iguais. O cabeçalho mostra a formação (avatares + líder) em toda aba, e a
  aba ativa tem uma frase de descrição (`CLAN_TAB_DESCRIPTIONS`). Títulos de
  seção dentro do clã são `<h2>` reais. Mudança só visual; nenhuma função
  mudou.
- **`/closings` saiu da navegação global** e virou a aba Fechamentos da
  Contabilidade. A rota sobrevive apenas como **redirecionamento** (o botão
  "Abrir fechamentos" das notificações do Telegram aponta para ela). Como
  Fechamentos passou a viver em rota dinâmica, quem revalida usa
  `revalidatePath("/clans/[id]", "page")`.

### Carteira (só do clã Fiscal)

`fiscal_portfolios (org_id, client_id, user_id, assigned_by, notes)` com unicidade
em `(org_id, client_id)`: **um responsável fiscal por empresa**. A carteira de uma
pessoa é o conjunto das suas linhas — não existe entidade "carteira" com nome
próprio, porque o que o escritório move é a EMPRESA, não o pacote. A ausência de
linha é o estado que mais importa na tela: a empresa sem responsável.

Escopo deliberadamente fiscal: Contabilidade trabalha por `accounting_closings` e
os demais clãs por informativo. **Se outro clã pedir carteira, aí sim generalizar**
para `(clan_id, client_id, user_id)` — não antes.

`fiscal_portfolio_events` guarda os repasses (de quem, para quem, por quem). Existe
porque "essa empresa não é minha" é discussão real.

Empresa presa a quem saiu do clã não some da tela: ganha bloco próprio com o nome
de quem a deixou para trás.

### Campanhas de clã — aba REMOVIDA em 2026-09-03

A aba Campanhas (e a aba **Dados da empresa** do Societário) saiu de todos os
clãs a pedido do Bruno: o guarda-chuva mensal não estava sendo usado, e a
consulta avulsa de CNPJ já existe dentro do próprio Fluxo. Foram apagados
`campaigns-tab.tsx`, `campaign-board.tsx`, `campaign-actions.ts`,
`company-data-tab.tsx` e a action `lookupCompanyDataCnpj`.

A tabela `clan_campaigns` CONTINUA no schema — `fiscal_control_periods.campaign_id`
aponta para ela — mas hoje ninguém escreve nela: sem a aba, não há caminho de
criação. Abrir a competência do Fiscal nunca dependeu de campanha
(`openFiscalControlPeriod` tem `campaignId` opcional). Se a ideia voltar, ela
volta com o modelo de `missions`/`mission_submissions` da Fase 5, não com a aba
antiga — não recriar a aba sem o Bruno pedir.

## Lista de missões: Avulsas × Informativos (decisão de 2026-09-03)

`/tasks` deixou de ser uma lista única com quatro filtros (origem, escopo,
status, prazo). A **origem virou o eixo principal** (`?view=standalone` ou
`?view=informative`), porque as duas populações têm forma diferente:

- **Avulsas** (`tasks.informative_id` NULL): pedido de uma pessoa para outra.
  Na visão pessoal são divididas pelo **papel do leitor** em cada missão —
  Para você fazer / Para você aprovar / Você pediu / Entregues, aguardando
  quem pediu / Encerradas — e não por status: papel é o que decide a próxima
  ação. Escopos amplos (clã, pessoa, Guilda) ficam aberto/encerrado,
  atrasadas no topo. **Criação só pelo formulário completo** (`/tasks/new`):
  um compositor de uma linha (`@pessoa !alta ~sexta #3`) foi implementado e
  **removido no mesmo dia a pedido do Bruno** — ele quer um único caminho
  completo, não um atalho. Não reintroduzir sem ele pedir.
- **Retorno para quem pediu** (2026-09-03): missão criada para outra pessoa
  termina em **entrega com retorno escrito obrigatório** (`awaiting_approval`
  exige nota). Quem pediu vê o retorno na lista ("Para você aprovar") e no
  detalhe, aprova com comentário opcional (vai para o histórico e para quem
  entregou), e é avisado no Telegram quando o trabalho começa, quando a
  entrega chega (com o retorno no texto) e, no outro sentido, quem entregou
  recebe a aprovação com o comentário. "Você pediu" mostra a última
  movimentação de cada pedido.
- **Informativos** (`informative_id` preenchido): lidas como **pacote por
  empresa**, com o progresso do conjunto (`src/domain/mission-triage.ts`).
  Criar aqui é preparar um Informativo (`/informativos`), nunca uma missão
  solta.

O único filtro que sobrou é o recorte de pessoas (`scope`: minhas / meus
clãs / um clã / uma pessoa / Guilda). Status, prazo e origem viraram
estrutura. Toda linha de missão passa pela `<MissionRow>` (`frame="flat"`
dentro do pacote).

## Design e UX (decisões já tomadas — não redecidir do zero)

**Antes de escrever qualquer tela, leia `docs/design-system.md`.** Ele é
normativo: escala tipográfica, tokens de cor, os componentes de chrome que já
existem (`PageHeader`, `SegmentedNav`, `MissionRow`) e o checklist de PR. Esta
seção guarda o PORQUÊ das decisões; aquele arquivo guarda o COMO aplicá-las.
Se você está prestes a copiar classes de outra tela, o componente já existe.

- **Direção estética**: dark, denso, "espaço próprio" — explicitamente NÃO
  corporativo/sério. O objetivo é não parecer "trabalho", e sim algo que estimule
  o uso voluntário. Estilo viking "Gelo e Ferro" (spec em
  `docs/superpowers/specs/2026-07-06-viking-theme-design.md`): paleta fria
  azul-gelo/prata, títulos em Cinzel, tipografia mono para números de XP/nível,
  ouro EXCLUSIVO para recompensa. **Sem brilho/glow/neon** (decisão de 2026-07-06,
  substitui a ideia anterior de "acentos neon"). Dark é o tema único, sem toggle.

- **Escala tipográfica (2026-08-26)**: "títulos em Cinzel" vale para os DOIS
  passos de display, não para todo heading — `h1` 24px Cinzel, `h2` 18px Cinzel,
  `h3` 15px Geist (sans de propósito: Cinzel nesse tamanho fica ilegível),
  `h4`+ 11px mono maiúsculo. A escala mora no `@layer base` do `globals.css`, e
  o nível semântico já traz o tamanho — heading não leva classe de tamanho no
  call site. **`.hud-label` é RÓTULO, nunca heading**: título de seção é `<h2>`;
  etiqueta de dado é `.hud-label`. Detalhes e histórico nos adendos do spec.

- **Ornamento (2026-08-26)**: a regra original do spec ("textura só nas telas de
  vitrine; dashboard e tarefas limpas") foi INVERTIDA na prática e o código está
  certo — o dashboard virou a vitrine. Não remova `texture-iron` do dashboard
  nem do formulário de missão.

- **Grafo estilo Obsidian foi CONSIDERADO E REJEITADO.** Motivo: tarefas de
  trabalho não têm relação orgânica entre si (dependência real só existiria nas
  Campanhas da Fase 5, e mesmo assim é hierárquica, não uma rede). Um grafo aqui
  esconderia a informação que mais importa ("o que vence hoje", "o que é meu")
  atrás de uma visualização bonita mas pouco funcional. NÃO reintroduzir essa
  ideia sem antes revisitar esta nota.

- **Tela principal (uso diário)**: lista/board simples e rápido — prioriza
  escaneabilidade (o que é meu, o que está atrasado, o que preciso aprovar).
  Baixa fricção de leitura acima de tudo.

- **Tela de perfil/progresso (a peça de "vitrine")**: aqui sim vale investir em
  algo visualmente marcante — metáfora de árvore de habilidades / constelação
  de RPG (referência: skill trees de Path of Exile, Hades), NÃO grafo de notas.
  A diferença importa: skill tree comunica progressão e direção (o que já foi
  desbloqueado, o que vem a seguir), que é honesto sobre o que a tela representa
  (o progresso do usuário) — diferente do grafo, que sugeriria conexões entre
  tarefas que não existem no schema.

- **Criação de tarefa — "liberdade" significa baixa fricção com campos
  estruturados, NÃO texto livre não-estruturado.** Campos opcionais que não
  bloqueiam o salvamento, edição inline sem modal pesado. Nunca sacrificar
  estrutura (prioridade, dificuldade, prazo como campos reais) em nome de
  liberdade — sem estrutura, XP e leaderboard não têm o que calcular.
  A ideia de "criação em uma linha com parsing de atalhos (@pessoa,
  !prioridade, ~prazo)" foi **testada e rejeitada pelo Bruno em 2026-09-03**:
  o caminho de criação é um só, o formulário completo.

- **Sequenciamento**: não aplicar mudanças visuais em paralelo com mudanças de
  schema/backend da mesma sessão de trabalho — risco de diffs conflitantes sem
  branch separada. Terminar e revisar a mudança estrutural em andamento antes de
  pedir a implementação visual.

## Plano de execução (uma fase por vez — não avançar sem a anterior funcionando)

### Fase 1 — Fundação
Scaffold Next.js + TS + Tailwind + shadcn/ui. Drizzle configurado apontando pro
Postgres. better-auth com email/senha + plugin organizations: registro cria org,
convite por link/código, papéis. Middleware de proteção de rotas. Layout base
responsivo com navegação.

### Fase 2 — Tarefas
Schema `tasks` + `task_events` com migrations + RLS. CRUD completo: criar (para si
ou colega da org), listar (minhas / criadas por mim / todas com filtros de status e
prazo), editar, cancelar. Máquina de estados com validação de transições no servidor.
Fluxo de aprovação/rejeição com nota.

### Fase 3 — Gamificação
`xp_ledger` + crédito transacional na aprovação. `levelFromXp` com testes unitários
(Vitest) cobrindo bordas. Perfil do usuário: nível, XP total, barra de progresso pro
próximo nível. Leaderboard da org por período. Feedback visual ao ganhar XP.

### Fase 4 — Produção
Rate limiting no auth. Headers de segurança (CSP, HSTS). Página de erro e estados
vazios decentes. Seed de demonstração. Dockerfile (standalone) + docker-compose +
proxy reverso com HTTPS na VPS. README de portfólio com screenshots e decisões de
arquitetura (RLS, ledger, máquina de estados).

### Fase 5 — Campanhas (processo recorrente) — SÓ após Fases 1–4 validadas em uso real

Objetivo: orquestrar trabalho recorrente e padronizado sobre ~250 empresas-cliente
(ex.: fechamento anual/trimestral), sem criar tudo na mão.

**Não começar esta fase sem antes revisar as decisões de pool/XP com dados reais de uso
do núcleo.** As travas abaixo são requisito, não sugestão.

Novas entidades:

```sql
-- Empresas-cliente (objeto do trabalho, NÃO usuárias). Cadastro estável, popular via CSV 1x.
CREATE TABLE clients (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      text NOT NULL REFERENCES organization(id),
  name        varchar(200) NOT NULL,
  tax_regime  varchar(30) NOT NULL,   -- 'simples', 'presumido', 'real' (define o template)
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Template de checklist POR REGIME (o objeto reutilizável; ~3–5 no total, não 250).
CREATE TABLE mission_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      text NOT NULL REFERENCES organization(id),
  name        varchar(120) NOT NULL,
  tax_regime  varchar(30) NOT NULL,   -- a qual regime este template se aplica
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE mission_template_items (   -- as tarefas-modelo do checklist
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       text NOT NULL REFERENCES organization(id),
  template_id  uuid NOT NULL REFERENCES mission_templates(id),
  title        varchar(200) NOT NULL,
  difficulty   smallint NOT NULL DEFAULT 2,   -- alimenta o XP (fórmula já existente)
  order_index  smallint NOT NULL DEFAULT 0    -- define a SEQUÊNCIA de execução (gate abaixo)
);

-- Campanha (na UI) = o guarda-chuva (ex.: "Fechamento Anual 2025"). Tabela mantém o nome missions.
CREATE TABLE missions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      text NOT NULL REFERENCES organization(id),
  name        varchar(200) NOT NULL,
  due_date    timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Submissão = uma empresa-cliente dentro de uma missão. É a unidade do pool.
CREATE TABLE mission_submissions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        text NOT NULL REFERENCES organization(id),
  mission_id    uuid NOT NULL REFERENCES missions(id),
  client_id     uuid NOT NULL REFERENCES clients(id),
  claimed_by    text REFERENCES "user"(id),   -- NULL = disponível no pool
  status        varchar(20) NOT NULL DEFAULT 'open', -- open|in_progress|done
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- As tarefas de cada submissão são linhas na tabela `tasks` já existente,
-- com uma coluna nullable submission_id uuid REFERENCES mission_submissions(id).
-- Tarefa ad-hoc: submission_id NULL. Tarefa de missão: preenchido. Mesmo motor de XP.
-- O xp_ledger ganha coluna nullable submission_id (para o bônus de conclusão abaixo).
```

Aplicar `org_id` + RLS em TODAS estas tabelas, igual às demais.

Instanciação: ao criar a missão, para cada client ativo o sistema cria uma
`mission_submission` e materializa as tarefas a partir do `mission_template` que
corresponde ao `client.tax_regime`. Operação em lote, idempotente, transacional.

**Gate sequencial dentro da submissão:** as tarefas materializadas herdam a ordem do
`order_index` do template. A tarefa N de uma submissão só pode ser iniciada
(`pending → in_progress`) quando a tarefa N-1 estiver `completed`. Validação na
máquina de estados, no servidor. Aplica-se apenas a tarefas de missão
(`submission_id` preenchido) — tarefas ad-hoc não têm gate.

**Travas do pool auto-servido (requisito — pool sem isto apodrece no 1º ciclo):**
- Limite de submissões simultâneas por pessoa (só pega a próxima ao concluir uma) —
  evita abocanhar as fáceis e sentar em cima.
- XP por dificuldade do regime (Lucro Real vale mais que Simples) — a empresa difícil
  vira prêmio, não batata quente.
- Gestor pode empurrar submissão órfã do pool para alguém (pool é padrão; atribuição
  é a exceção para casos travados).

**XP em trabalho de equipe:** XP de tarefa vai para quem concluiu a tarefa. Além
disso, quando TODAS as tarefas de uma submissão completam, creditar **XP bônus** no
ledger (`reason = 'mission_completed'`) para o `claimed_by` da submissão — para quem
assumiu a empresa, NUNCA para quem concluiu a última tarefa (senão incentiva corrida
pela última tarefa fácil de cada empresa). Bônus calculado no servidor:
`floor(0.25 * soma dos xp_value das tarefas da submissão)`. Idempotente: unicidade
parcial `(submission_id) WHERE reason = 'mission_completed'` no `xp_ledger`, crédito
na mesma transação da conclusão da última tarefa.

## Fora de escopo da v1 (não implementar sem pedir)

Badges/conquistas, notificações (e-mail/push), tarefas recorrentes, visão de
calendário, comentários em tarefas, app mobile nativo, billing/planos.
