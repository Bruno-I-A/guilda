# Guilda — Gestão de Tarefas Gamificada (nome provisório, fácil de trocar)

Plataforma multi-tenant de gestão de tarefas com sistema de recompensa (XP e níveis).
Cada empresa (organização) tem seus usuários, tarefas e leaderboard isolados.
Projeto de portfólio: qualidade de código e segurança são requisitos, não opcionais.

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
  reason      varchar(50) NOT NULL,                -- 'task_completed', 'reversal', 'bonus'
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
- **Fluxo de aprovação obrigatório**: o responsável marca a tarefa como feita
  (`awaiting_approval`); só o **criador da tarefa** ou um **admin/owner** pode aprovar
  (→ `completed`, credita XP) ou rejeitar (→ `rejected`, com nota obrigatória).
  Auto-aprovação: se criador == responsável, um admin/owner precisa aprovar
  (se não houver outro admin, permite auto-aprovar — não travar orgs de 1 pessoa).
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

## Fora de escopo da v1 (não implementar sem pedir)

Badges/conquistas, notificações (e-mail/push), tarefas recorrentes, visão de
calendário, comentários em tarefas, app mobile nativo, billing/planos.
