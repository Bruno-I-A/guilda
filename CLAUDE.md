# Guilda — Gestão de Tarefas Gamificada (nome provisório, fácil de trocar)

## XML das NFS-e prestadas das empresas

Os A1 das empresas chegam apenas como envelope cifrado no navegador
(`vault-browser.ts`); só o `guilda-fiscal` abre (`vault.ts`). A chave privada
fica exclusivamente nesse serviço. A rotina configurável (`nfse_xml_routines`)
lê o ADN por NSU com o certificado de cada empresa e guarda os XML compactados
em `nfse_issued_notes`, inclusive os cancelamentos. Esta é uma exceção consciente
à regra das notas de honorário, cujos XML continuam sem armazenamento.

**NSU do caminho é o último já lido (2026-11-17)**: o ADN devolve os documentos
DEPOIS do número de `GET /DFe/{NSU}`, como o ultNSU da NF-e. A rotina pedia
"último + 1" e perdia o documento seguinte ao cursor no começo de cada leitura e
em cada troca de lote (DA TERRA, nota 8 de 10/2026). `syncClient` pede o último
lido e descarta NSU repetido; a migração 0100 zerou os cursores para reler tudo.
Teste de rotina simula a API pela regra real (`fakeAdn` em `xml-routine.test.ts`),
não com lotes prontos que ignoram o número pedido.

**Procuração (2026-11-18)**: a aba XML e as Notas dos clientes leem e emitem pelo A1
do escritório (o mesmo do `guilda-fiscal`, dos honorários) ou pelo A1 de cada empresa.
O escritório tem um padrão (`nfse_credential_settings`, só admin muda) e a empresa
pode ser exceção (`nfse_client_credentials.mode`; nulo segue o padrão). O padrão nasce
em "Certificado": nada muda até o Bruno testar e virar. Por procuração, a rotina só lê
empresa de serviço (ou com a procuração marcada), para não ler o comércio todo.
- **Sem troca silenciosa**: procuração recusada vira selo e erro na empresa, nunca cai
  escondida para o certificado. Só recusa de autorização (401/403, E2245, texto de
  procuração) vira selo; lote em formato estranho continua sendo erro da leitura
  (`AdnRejectionError` leva `httpStatus` e `code`).
- **Trocar a credencial zera o cursor** (`read_mode` guarda com qual ele foi feito),
  porque não está medido que a sequência de NSU é a mesma. O teste de procuração
  (`proxy-test.ts`) lê a partir da nota mais antiga guardada e grava a medida em
  `proxy_same_sequence`: se der sempre igual, o zerar pode sair.
- **Por procuração a consulta da nota pela chave é recusada**: o XML vem da resposta da
  emissão, da consulta (certificado) ou do que a rotina já guardou. Nota achada pela DPS
  sem XML para conferir vira erro, nunca adoção, também por certificado.
- Cancelamento por procuração não foi medido: a recusa aparece na nota e a saída é o
  Portal ou marcar a empresa como exceção. Desenho em
  `docs/superpowers/specs/2026-11-18-procuracao-design.md`.

O mês é o da emissão em Brasília. O controle de 09/2026 baixa as emitidas de
01/09 a 30/09. O download `/api/nfse/xml` lê o banco com sessão e permissão do
Fiscal; não passa pelo serviço fiscal. Certificados e senhas nunca chegam em
claro ao app. Plano e teste real em
`docs/superpowers/plans/2026-10-19-xml-nfse-prestadas.md`.

**Tela (2026-10-20, a pedido do Bruno, que não achou a função no clã)**: tudo
mora na aba **XML das notas** do Fiscal (`xml-notes-tab.tsx`), com os passos
Certificados → Rotina → Baixar no topo, "Rodar agora" e "Configurar rotina" à
vista, e a lista de empresas com Enviar/Trocar certificado, a última leitura e
o download. Abre no mês anterior (o que se apura). A Carteira só tem o selo de
alerta do certificado, que leva à aba; o Controle mensal mostra a contagem e o
download da competência. Não voltar a esconder o envio num botão da Carteira.
O download do mês inteiro inclui quem tem nota guardada no período mesmo sem a
competência aberta no Controle mensal.

**Só empresas de serviço (2026-10-20)**: a aba lista por padrão quem emite
NFS-e. A marcação **"Emite NFS-e (serviço)"** mora na Ficha Fiscal
(`nfse_issuer_applicability`, com versão e histórico) e se troca na própria aba
("É de serviço? Sim · Não", `setNfseIssuer`). "Não informado" cai na sugestão
do CNAE principal (`src/domain/nfse-service.ts`, por divisão do CNAE); o
Fiscal corrige as exceções, como comércio que também presta serviço. "Todas"
mostra o resto para marcar. MEI nunca aparece nem é lido, nem com certificado (aba MEI). A rotina lê
toda empresa com certificado válido, marcada ou não.

**Pasta no formato da Domínio (2026-10-29)**: a importação de XML da Domínio
só aceita a pasta `<código>-<nome>`. O código da empresa na Domínio mora em
`clients.dominio_code` (só número, sem zeros à esquerda, único na org) e se
informa no cadastro da empresa, na linha da aba XML ou pela lista exportada da
Domínio (Código + CNPJ, casada pelo CNPJ, com prévia antes de gravar). Com
código, a pasta do .zip sai `125-Razao Social Ltda 10-2026` (mês com hífen: `/` abriria
subpasta no .zip); sem código, continua
`slug-raizCNPJ` e a aba avisa quantas empresas de serviço estão sem.

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
- **Nível**: derivado do XP total, nunca gravado. Até o nível 25 a fórmula é
  `floor(100 * n^1.5)` acumulado; acima disso o custo do próximo nível cresce
  12% por degrau (`LEVEL_SOFT_CAP` e `SOFT_CAP_GROWTH` em `src/domain/xp.ts`).
  O patamar existe porque `n^1.5` cresce com a RAIZ do nível: sem ele, sair do
  nível 50 custava 21 missões contra 14 do nível 20, o nível nunca virava
  conquista e um ano de uso intenso dava nível ~100. **A emenda fica em 25 de
  propósito**: nenhum saldo abaixo de 14.029 XP muda de nível, então a mudança
  não rebaixa ninguém que já está na Guilda — só encarece o futuro. Se alguém
  passar disso antes da mudança chegar à produção, o certo é SUBIR a constante,
  não deixar o nível cair. `levelFromXp(totalXp)` é puro e testado.
- **Leaderboard**: soma do ledger por usuário na org, período selecionável
  (semana / mês / geral). Query agregada, sem cache na v1.
- **Reversão**: se um admin reverter uma conclusão, inserir lançamento negativo no
  ledger (`reason = 'reversal'`) — nunca deletar o crédito original.

## Papéis (por organização, via better-auth member.role)

- **owner/admin**: tudo + aprovar qualquer tarefa + gerenciar membros e convites
- **member**: criar tarefas (para si ou colegas da org), atualizar as suas,
  aprovar tarefas que criou

## Avisos e missões pelo WhatsApp; sai o Telegram (decisão de 2026-11-24)

Pedido do Bruno: tudo que ia pelo Telegram vai pelo WhatsApp do escritório, e o
Telegram sai **de uma vez** (o código; as tabelas `telegram_*` ficam no banco sem
uso até ele autorizar apagar). Desenho em
`docs/superpowers/specs/2026-11-24-avisos-pelo-whatsapp-design.md`.

- **Número confirmado** (`member_whatsapp_connections.verified_at`): o Perfil gera um
  código (só o hash fica, 30 min) e a pessoa manda "GUILDA <código>" do próprio
  WhatsApp (`wa.me` com a mensagem pronta). Sem confirmação, nada de aviso (nem os
  antigos de novo cliente e de conversa encaminhada) e nada de comando; a mensagem
  de número cadastrado e não confirmado volta a ser de cliente, no Atendimento.
  Trocar o número zera a confirmação; sair da organização desliga e desconfirma.
  **Não aceitar número digitado como identidade**: com missão por mensagem, quem
  digitasse o número de outra pessoa criaria missão em nome dela.
- **Avisos** (`src/lib/notices/`): o produtor descreve o aviso em dados (`Notice`) e
  `enqueueMemberNotice`/`enqueueOrgNotice`/`enqueueClanNotice` enfileiram na
  `member_whatsapp_outbox` (payload `version: 3`). Dentro da janela de 24 h sai texto
  com o link e, quando há ação, botão de resposta (Iniciar missão, Aprovar, Retomar);
  fora, um dos seis modelos Utility (`NOTICE_TEMPLATES`), preparados por um botão de
  admin no Perfil (`member_whatsapp_templates`). O worker reconsulta modelo pendente a
  cada 15 min. Silêncio adia (`defer_member_whatsapp_outbox`).
- **Botão de link dos modelos é `https://<app>/w/{{1}}` com referência curta**
  (`shortRef`: `t-<id>`, `m`, `f`, `ti`, `d`; a rota `/w/[ref]` resolve num conjunto
  fechado). A Meta pode codificar `/`, `#` e `?` dentro da variável: não passar o
  caminho cru.
- **Regras novas**: missão de Informativo avisa quem a recebe, um aviso por pessoa
  (`enqueueInformativeAssignmentNotices`; antes só o Mural avisava); ninguém é avisado
  do que fez a si mesmo (missão para si, conclusão própria, XP do fechamento anual);
  preferência de fechamentos começa **desligada** para quem não tinha no Telegram
  (cada mudança de fechamento iria à Guilda inteira, e fora da janela custa). O aviso
  do Fluxo no Societário saiu: o "novo cliente" já avisa o mesmo clã.
- **Criar missão por mensagem: todo integrante, por texto, áudio, foto ou PDF**
  (2026-11-24, segundo pedido do Bruno no mesmo dia; o primeiro desenho era só líder).
  A mesma IA dos Informativos lê o pedido, em dois caminhos:
  - **líder de clã, admin e dono → Informativo**, como no Telegram (pode criar empresa,
    Fluxo, fechamento e aviso no Mural). O Informativo guarda `whatsapp_connection_id`:
    só o mesmo número confirma (`draft:confirm|cancel:<id>`).
  - **os demais → missão avulsa** (`member_mission_drafts`, migração 0113;
    `planFromInformative` e `decideMessageMissionDraft` em `src/lib/tasks/`), com a
    régua do formulário: pessoa da organização com o clã tirado dos vínculos dela
    (`activeClanMembershipsForUser` + `resolveAssigneeClan`) ou clã ativo; empresa só se
    já cadastrada. Nada de criar empresa, Fluxo ou fechamento por esse caminho. Até 10
    missões por mensagem; nome não achado ou destino incerto pede para mandar de novo.
    Tudo ou nada na confirmação; só o mesmo número confirma (`mission:confirm|cancel:<id>`).
  - **Arquivo vira texto antes** (`readMemberMedia`): áudio pela transcrição da OpenAI
    (sem `OPENAI_API_KEY` responde que não lê áudio), foto e PDF (3 primeiras páginas)
    pela Anthropic (`readMissionAttachment`, o conteúdo é dado, nunca instrução). A prévia
    começa com "Entendi assim: «…»". O arquivo não fica guardado. Vídeo e outros formatos
    recebem a explicação do que se lê.
  A mensagem vai para `member_whatsapp_commands` (única por wamid; o `guilda_app` não
  apaga) e o `runMemberCommandCycle` do `support-worker` responde; a prévia, a resposta e
  a marcação de lido gravam juntas. Botões dos avisos passam por `transitionTaskForActor`.
  - **Resposta da IA é limpa antes de validar** (`informativeOutputFormat`, vale também para o
    painel e o Fluxo): a IA devolvia texto vazio onde o esquema pede uma letra ("too_small") e o
    SDK recusava a resposta inteira. Vazio vira nulo, descrição e trecho herdam o título, item
    vazio sai. Não voltar a passar `zodOutputFormat(informativeExtractionSchema)` direto.
  - **Falha nunca é silenciosa** (primeiro teste real, 2026-11-24: o Bruno ficou no
    "Analisando…"): erro da IA ou do banco responde "Não consegui analisar o pedido: <motivo>"
    e a mensagem sai da fila (`fail`). Não voltar a só devolver à fila.
  - **"sim"/"ok"/"pode criar" confirmam e "não"/"cancelar" cancelam a última prévia aberta**
    daquele número (`shortAnswer`, `latestPendingDraft`): a pessoa responde escrevendo.
    Outro texto com menos de 10 letras recebe a explicação, sem chamar a IA.
- Lembretes do dia (prazo, fechamentos pendentes, resumo) rodam no `support-worker`
  uma vez por minuto, no horário do resumo de cada um (`queueScheduledMemberNotices`).

## Recuperação de senha (decisão de 2026-11-11)

Não há e-mail, então a recuperação é administrativa: em **Membros**, o menu do
integrante tem **"Redefinir senha"** (`resetMemberPassword`). A Guilda gera uma
senha temporária no servidor (`crypto.randomInt`), mostra uma vez para o admin
repassar, derruba todas as sessões da pessoa e liga `mustChangePassword` — o
mesmo caminho do cadastro direto, que leva a `/change-password` no próximo login.

- **Régua** (`authorizePasswordReset`, puro e testado): só para baixo na
  hierarquia (owner redefine admin e membro; admin, só membro), nunca a própria,
  e **nunca de quem também é integrante de outra organização** — a conta é uma
  só para todas, e a senha nova abriria a porta de um escritório alheio.
- **Trilha** `password_resets` (quem redefiniu a de quem, quando; nunca a
  senha), só inserção: o `guilda_app` não tem UPDATE nem DELETE.
- Membros mostra "Ainda não trocou a senha temporária" para o admin; o login
  diz "Esqueceu a senha? Peça a um admin da Guilda para redefinir."

## Revisão de segurança (2026-11-16)

Falha achada e corrigida: quem criava uma organização própria antes de ser
removido do escritório continuava com sessão e lia missões e ranking. As travas
que fecharam isso, e que não devem ser desfeitas:

- **Organização não se cria pelo app** (`allowUserToCreateOrganization: false`
  em `auth.ts`). A primeira nasce pelo `scripts/bootstrap-owner.ts`. A tela
  `/onboarding` só explica e oferece sair; não tem mais formulário.
- **Vínculo conferido em `requireOrgSession()`**, não só no layout `(app)`: na
  navegação pelo app o Next renderiza só a página que mudou e o layout não roda
  de novo. Página nova que leia dado da organização passa por ele.
- **Remover alguém derruba as sessões dessa pessoa naquela organização**
  (`revokeOrganizationSessions`, no `afterRemoveMember`).
- `/atendimento` entrou no matcher do `proxy.ts` (estava sem CSP).
- Os processos do app, dos workers e do serviço fiscal não herdam
  `MIGRATION_DATABASE_URL` (`start-production.mjs`); só a migração a usa.
- A função `reset_org_operational_data_for_launch` foi apagada (migração 0099).
- `npm run check:rls` voltou a passar. Tabela nova só de inserção entra nas
  listas `APPEND_ONLY_TABLES` e `SPLIT_POLICY_TABLES` do script.

## Desfazer: janela de arrependimento (decisão de 2026-09-03)

Conclusão de missão mostra um aviso com **"Desfazer"** ao lado (`toastWithUndo`,
em `src/lib/undo-toast.ts`). O desfazer NÃO é otimista: a conclusão já foi para
o banco, e o botão chama `revertCompletion` de verdade — mesmas permissões,
mesmo estorno no ledger. É o que faz o desfazer sobreviver a um F5 e não mentir
sobre o que já aconteceu.

Para o botão funcionar para quem não é admin, `authorizeTransition` ganhou a
**janela de arrependimento** (`UNDO_COMPLETION_WINDOW_MS`, 5 min): quem
registrou a conclusão desfaz a própria conclusão dentro dela, mesmo sendo
member. Fora da janela, `completed → in_progress` continua sendo admin/owner
como sempre foi. A janela do servidor é maior que a do aviso de propósito —
perder o toast não custa o desfazer.

Isso NÃO é brecha de farm de XP: o estorno entra como lançamento negativo
(`reason = 'reversal'`) e a reconclusão é idempotente por `task_event_id`, não
por `task_id` — concluir/desfazer/concluir dá saldo líquido de um crédito.

Onde tem: **Concluir** (detalhe da missão) e **conclusão direta da Mesa do clã**
(`distribution-board`), os dois cliques únicos que creditam XP. Aprovar ficou
DE FORA de propósito: só volta para `in_progress`, não para `awaiting_approval`,
então "desfazer" deixaria a missão num estado diferente do anterior — e aprovar
já exige diálogo com comentário, não é clique de engano.

## Desafio do dado nos Fechamentos (decisão de 2026-10-01)

O dado da aba Fechamentos virou jogo (desenho em
`docs/superpowers/specs/2026-10-01-desafio-do-dado-design.md`):

- **Rolar reserva a empresa** para quem rolou e abre um prazo. Um desafio em
  andamento por pessoa e uma pessoa por empresa são índices únicos parciais
  em `closing_challenges`. **O sorteio é do servidor** (`rollClosingChallenge`);
  o navegador só anima — se escolhesse a empresa, daria para pegar a fácil.
- **Fechar o período** da sorteada paga **base + bônus no prazo** (padrão
  15 + 15; prazo de 30 min, o tempo real de um fechamento segundo o Bruno).
  Fora do prazo paga só a base. Liderança/admin ajustam as regras, que ficam
  **congeladas na rolada**.
- **Sem teto diário (decisão de 2026-10-02)**: o teto de 10 desafios pagos por
  dia era a trava contra farm de XP (o fechamento é registrado pela própria
  pessoa), mas travou o Bruno no primeiro dia de uso real e ele mandou tirar.
  Coluna e regra saíram (migração `0079`, que pagou retroativamente quem
  tinha batido no teto). O risco de farm foi aceito conscientemente, como na
  auto-missão — **reavaliar se o ranking degradar**; não recolocar sem ele pedir.
- Observação na empresa durante o desafio o **trava** (sem XP); outra pessoa
  fechando a reservada o encerra; desistir libera a empresa; reabrir ou
  excluir o período **estorna** pelo saldo do desafio no ledger
  (`closing_challenge` / `closing_challenge_reversal`), como o fechamento de ano.
- **Toda escrita de período e toda observação nova passam por
  `src/lib/closings/period-writes.ts`**, que chama o sync do desafio na mesma
  transação. Não gravar `accounting_closings` nem inserir
  `closing_observations` direto: `period-writes.guard.test.ts` reprova.
- Banco: o `guilda_app` ganha privilégio total em toda tabela nova pelos
  default privileges (`docker/*/init/01-roles`) — **restringir exige REVOKE**,
  GRANT sozinho não restringe nada. `closing_challenges` não tem DELETE e só
  atualiza as colunas do desfecho.
- MCP: `rolar_dado_fechamento`, `desistir_desafio_fechamento` e
  `consultar_desafio_fechamento` (com o saldo do desafio no ledger), na régua
  das demais ferramentas de fechamento (admin/owner + escopo). A regra de
  rolar/desistir mora em `src/lib/closings/challenge-commands.ts`, usada pela
  aba e pelo MCP — não duplicar nas Server Actions.

## Notas de honorário pela API nacional (decisão de 2026-10-10)

Desenho em `docs/superpowers/specs/2026-10-10-notas-de-honorario-design.md`.

- A aba Honorários emite, cancela e baixa os PDFs das NFS-e de honorário pela
  API do Sistema Nacional. **O certificado A1 mora só no serviço fiscal**
  (outro serviço do Easypanel, `GUILDA_SERVICE=fiscal`); o app nunca o vê. Não
  levar o certificado para o app "para simplificar".
- App e serviço conversam pela fila no banco (`nfse_invoices`) e, para PDFs,
  pela rede interna com `FISCAL_SERVICE_TOKEN`. **PDF e XML não são
  guardados**, a pedido do Bruno: só chave e número.
- **O PDF é montado pela Guilda (2026-10-15)**: o governo suspendeu a API do
  DANFSe em 03/08/2026 (NT 008/2026). O serviço fiscal busca o XML da nota
  e desenha o DANFSe v2.0 (`danfse-data.ts` lê, `danfse-pdf.ts` desenha),
  copiando o PDF que o Portal gera. Não voltar a chamar o ADN.
- **Leiaute da NT 009 (2026-11-14)**: a produção do Sistema Nacional passa a
  exigir o leiaute da NT 009 em **01/12/2026** (sem ele, E1235). `buildDpsXml`
  escolhe pela data de emissão (`nfseLayoutFor`): produção restrita sempre
  NT 009, produção NT 004 até 30/11 e NT 009 dali em diante; `NFSE_LEIAUTE`
  força. Vale para honorários e notas dos clientes (o montador é um só). Os
  leitores (`danfse-data.ts`, `client-nfse/from-xml.ts`) aceitam os dois
  formatos, porque as notas antigas continuam no leiaute antigo. XSD oficial
  dos dois em `src/lib/nfse/xsd/` (`1.01` e `nt009`). **A data ainda não é
  oficial (revisão de 2026-11-24)**: o portal (29/10) diz que as releases
  "deverão estar em produção em 01/12/2026" mas que o cronograma formal ainda sai,
  e a produção segue na NT 004 até lá. Por isso a emissão se recupera sozinha
  (`processor.ts`): se o esquema recusar o leiaute da data (`isSchemaRejection`,
  E1235), a mesma DPS sai uma vez no outro leiaute, com aviso no log; as duas
  recusadas, fica o erro do leiaute da data. Com `NFSE_LEIAUTE` forçado não troca.
  A obra (E0370) é igual nos dois leiautes e é validada contra os dois XSD.
- Série de DPS própria (1–49999); o Emissor Web usa 70000–79999. O número da
  DPS é reservado na fila e nunca muda; antes de emitir, o serviço consulta a
  DPS — é isso que impede nota duplicada.
- Emitida marca a etapa "Nota" do controle (PA marca "Parcela adicional") pela
  `applyOfficeFeeStepChange`; cancelada reabre. Emitir/cancelar: Fiscal e
  admins; modelo da nota: só admin.
- **Serviço fiscal só na produção (2026-10-15)**: a produção restrita do governo
  não tem Getúlio Vargas conveniado (E0037), então o `guilda-fiscal` serve só a
  produção (`main`, `NFSE_AMBIENTE=producao`) e a homologação fica sem emissão.
  Teste de emissão é uma nota real, com uma empresa só marcada na prévia.
- **Modelo real (2026-10-15)**: competência da nota = **data da emissão**; a
  nota mensal se refere ao **mês anterior ao do controle** (no controle de
  novembro sai "referente a competência 10/2026", `nfseReferencePeriod`) —
  é como o Fiscal emite no Portal. A prévia mostra a descrição e deixa marcar
  quais notas emitir.
- **Tela (2026-10-11, a pedido do Bruno, que achou a primeira versão confusa)**:
  a aba Honorários tem duas visões no topo, **Mês a mês** (padrão) e **Cadastro
  de honorários**. O mês é uma sequência — Cadastro → Abrir o mês → Emitir
  notas → Cobrança — e o botão principal é sempre o próximo passo. A nota
  aparece na própria coluna "Nota" do controle (`NfseInvoiceCell`), sem tabela
  separada; o "Modelo da nota" mora no Cadastro. Não voltar a empilhar um
  painel de emissão em cima do controle.
- **Sem forma de cobrança (2026-10-21)**: o cadastro é só para emitir a nota;
  a coluna saiu do banco (migração 0084). Não recolocar sem o Bruno pedir.
- **Tomador avulso (2026-10-21)**: quem paga honorário e recebe nota sem ser
  empresa-cliente (filiais da KMJ, produtor rural com CPF) mora em
  `office_fee_takers`, só no Honorários — fora da lista de empresas, do Fiscal
  e do XML, a pedido do Bruno. Perfil, controle, eventos e nota têm
  `client_id` OU `taker_id` (check `num_nonnulls = 1`); a nota sai com
  `<CPF>` quando o documento tem 11 dígitos.
- **Apagar (2026-10-21)**: empresa ou avulso sai do cadastro (com as linhas
  do Mês a mês) só sem nota na Guilda — `deleteOfficeFeePayer` confere antes,
  porque a cascata levaria as notas. Com nota, o avulso se desativa.

## Notas dos clientes (decisão de 2026-10-22)

Aba **Notas dos clientes** do Fiscal (`client-nfse-*.tsx`): NFS-e de serviço
que as empresas-cliente emitem todo mês, **pelo CNPJ e com o A1 de cada uma**
(o mesmo envelope da aba XML; só o `guilda-fiscal` abre). Desenho em
`docs/superpowers/specs/2026-10-22-notas-dos-clientes-design.md`.

- Módulo próprio (`client_nfse_*`, `src/lib/client-nfse/`), não uma
  generalização da fila dos Honorários: aquela está em produção e é amarrada
  ao controle do mês. Reaproveita DPS, assinatura, `runNfseJob`, cancelamento
  e DANFSe. Não fundir as duas filas sem motivo novo.
- Cadastro em três níveis: emissor (modelo fiscal + **série/numeração de DPS
  própria**, porque a DPS é numerada por CNPJ), tomadores e notas padrão
  (`{mes}`, referência ao mês anterior ou ao próprio).
- **Tela única, sem "abrir o mês" (2026-10-23, o Bruno rejeitou a primeira
  versão com Cadastro × Mês a mês)**: cada empresa é um painel com as notas do
  mês, que aparecem sozinhas a partir das notas padrão
  (`loadClientNfseMonthRows`). A nota do mês (`client_nfse_items`) só é
  gravada ao ajustar (valor/texto clicando na linha) ou ao emitir. Emite-se
  **uma** (botão da linha), **as de uma empresa** (cabeçalho) ou **as
  escolhidas** (caixas + barra no rodapé), sempre com confirmação. Tomador e
  nota padrão no mesmo formulário ("+ Nova nota"); dados fiscais em resumo de
  uma linha, formulário completo só ao editar. Não voltar às duas visões nem ao
  passo de abrir o mês.
- A nota pedida aponta para emissor, tomador e item **sem cascata**: com nota,
  o banco recusa apagar o cadastro (a action dá a mensagem antes).
- **Série colidindo com outro sistema da empresa**: a consulta "a DPS já
  existe?" devolveria a nota de lá. O serviço confere prestador, tomador e
  valor (`verify.ts`) — só na nota ACHADA pela consulta, nunca na recém-emitida.
  **Troca de série automática (2026-10-30, pedido do Bruno)**: se não bater,
  a nota não foi emitida, então `moveToNextSeries` passa a empresa para a
  próxima série que nenhuma nota guardada (inclusive cancelada) nem pedida usa,
  renumera a nota a partir de 1 e a devolve à fila, até 5 vezes por passada.
  Só depois disso falha com a mensagem do que há na outra nota.
- O PDF sai no app, do XML guardado na emissão (o certificado do escritório
  não busca nota de cliente). Sem e-mail ao tomador e sem MEI na v1.
- **Retenções configuráveis (2026-11-03, pedido do Bruno)**: cada tomador
  guarda as suas (`client_nfse_takers.retentions`): ISS retido pelo tomador
  com a alíquota e percentuais de IR, INSS, PIS, COFINS e CSLL. Os valores
  saem de `src/domain/nfse-retentions.ts` sobre o valor do serviço e ficam
  congelados no modelo do pedido (`federal`, `withRetentions`); valem para a
  nota avulsa e as fixas. Simples ME/EPP sem retenção não informa alíquota
  do ISS (E0625). Não optante do Simples também não informa (E0617).
- **Corrigir endereço na nota com erro (2026-11-04, pedido do Bruno)**: a janela
  da nota com erro edita o endereço do tomador e devolve à fila
  (`retryClientNfseWithAddress`). Grava no cadastro, então vale para as próximas
  notas; valor e descrição continuam congelados no pedido.
- **Tipo de operação (2026-11-04, E0903)**: serviços 10.05, 15.09, 17.12 e 25.05
  com IBS/CBS exigem `tpOper`, escolhido pelo Fiscal nos Dados fiscais (nunca
  assumido pela Guilda); nos demais serviços ele é proibido (E0904), então a DPS
  decide pelo serviço de cada nota. "Tentar de novo" relê os dados fiscais da empresa
  (`refreshFiscalData`: inscrição, regime, tributos, IBS/CBS); serviço, retenções
  e município ficam como no pedido.
- **Corrigir serviço na nota com erro (2026-11-04, E0314)**: como "Tentar de novo"
  mantém o serviço do pedido, a janela da nota edita os códigos
  (`retryClientNfseWithService`) e, marcado, grava também nos Dados fiscais.
- **Nota achada pela DPS tem de ser desta emissão (2026-11-04)**: nota recorrente
  repete prestador, tomador e valor, e a Guilda adotou uma nota de 2024 como se
  fosse a de novembro (nada foi emitido; cancelar cancelaria a verdadeira). `verify.ts`
  compara também a data com o pedido; `repairAdoptedClientNfse` devolve as adotadas
  a "com erro" uma vez ao subir o serviço fiscal, sem reemitir sozinho.
- **Obra (2026-11-18, E0370)**: os subitens de obra da LC 116 que o Sistema Nacional lista
  na mensagem (07.02.01 … 14.14.04, `nfseServiceRequiresConstruction`) exigem o grupo
  `<obra>` na DPS: CNO/CEI, CIB ou endereço da obra, com a inscrição imobiliária opcional.
  A obra muda de nota para nota, então fica só no modelo congelado no pedido
  (`template.construction`), nunca nos dados fiscais da empresa. Informa-se em "Nova nota"
  (aparece quando o serviço é de obra), em "Corrigir serviço" da nota com erro, e "Nova
  igual" repete a da nota anterior. Sem obra, emitir e "Tentar de novo" recusam na Guilda.
- **Descartar nota com erro (2026-11-04, pedido do Bruno)**: `discardClientNfseInvoice`
  tira da lista a nota que não deve sair (`discarded_at`, status `cancelled` sem chave).
  Não é cancelamento fiscal: só vale para nota com erro. A nota padrão que já gerou
  pedido segue sem poder ser apagada; ela se pausa.
- **Cadastro pelas notas já emitidas (pedido do Bruno)**: ao adicionar a
  empresa, a Guilda lê o XML que a rotina da aba XML já guardou
  (`from-xml.ts`, `suggest.ts`) e preenche o modelo fiscal pela nota mais
  recente, escolhe uma série de DPS que nenhuma nota dela usa (a partir de
  900, olhando o histórico) e sugere as notas do último mês como notas padrão
  — marcadas as que também saíram no mês anterior, com o "MM/AAAA" trocado
  por `{mes}`. Nada é gravado sem o Fiscal confirmar.
- **Emissão avulsa é o padrão (2026-11-03, pedido do Bruno)**: a maioria das
  empresas não repete a mesma nota todo mês (uma emite uma nota só; a
  fonoaudióloga emite 3–4 para a mesma pessoa no mês). O painel de cada empresa
  é a lista das notas do mês (avulsas, `client_nfse_items.model_id` nulo) com
  **"+ Emitir nota"** (`emitClientNfseNote`, em `emit.ts`) e **"Repetir"** em
  cada nota. A nota avulsa leva a chave do formulário (`request_id`, único):
  o mesmo envio repetido não pede duas notas. As **notas fixas** viraram opção
  da empresa nos Dados fiscais (`uses_standard_notes`; a migração 0089 ligou
  para quem já tinha nota padrão). Não voltar a exigir nota padrão para emitir.
- **Tomadores pelas notas do Portal (2026-11-03)**: "Tomadores" lista todo
  cliente do histórico guardado pela aba XML (`customersFromIssuedNotes`,
  `loadIssuerCustomers`) e cadastra os marcados de uma vez
  (`importIssuerTakers`). As notas antigas faltavam porque a rotina pula o que
  é anterior ao "guardar a partir de"; **"Buscar notas antigas no Portal"**
  (`requestIssuerHistory`) relê o histórico da empresa num cursor próprio
  (`nfse_dfe_cursors.history_nsu`) que ignora essa data e some ao acabar.

### Lista por ordem alfabética (decisão de 2026-11-05)

**Previsão do mês e grupos por urgência foram testados e rejeitados pelo Bruno**, um
dia depois de publicados: "ficou pior, muito mais difícil de se localizar". Não
reintroduzir sem ele pedir. Quem emite é uma pessoa, em mais de 100 empresas, conforme
o cliente pede: ela precisa achar a empresa, e empresa que muda de lugar conforme a
situação atrapalha. Isto substitui as decisões acima sobre notas fixas no que conflitarem.

- **Tela** (`client-nfse-workspace.tsx`): toda empresa em ordem alfabética, sempre no
  mesmo lugar, com as notas do mês visíveis abaixo dela, sem nada para abrir. Busca por
  empresa, CNPJ ou cliente (tecla `/`) e filtros simples. O erro se destaca na própria
  linha, sem mudar a empresa de lugar.
- **Emissão**: só pedida, por "Nova nota" ou "Nova igual". Sem lote. Nota padrão não
  aparece mais sozinha nem se cria; a que já saiu aparece como qualquer nota do mês.
- **Banco**: `client_nfse_items.source_access_key` e `client_nfse_forecast_skips` ficaram
  sem uso, porque já foram publicados. As tabelas e actions da nota padrão (`saveNote`,
  `deleteModel`, `importSuggestions`, `emitBatch`, `adjustNote`) também estão sem tela.

## Atendimento: caixa de entrada (decisão de 2026-11-06)

Desenho em `docs/superpowers/specs/2026-11-05-atendimento-ia-design.md`; a fundação do
WhatsApp veio no PR #104 (Codex). A rota `/atendimento` (`support-inbox.tsx`,
`src/lib/support/inbox.ts`) é a primeira tela: fila, conversa e empresa; no celular, um
passo por vez. **Ainda não há IA, Base nem Métricas.**

- **Toda conversa nova nasce em "Precisa de pessoa"**, porque não há IA para o estado
  "IA atendendo". Quando o agente entrar, é ele quem muda isso.
- **Quem vê (2026-11-24, decisão do Bruno)**: **todo integrante vê todas as conversas** da
  organização e age nelas (responde, assume, anota, resolve, abre mídia), como no WhatsApp do
  celular. Antes era o padrão mais fechado (membro via só o próprio clã e o que era dele; sem
  setor, só admin), e os integrantes não viam as ~130 conversas da fila. `canSeeConversation` e
  `visibleTo` saíram; os filtros "Minhas" e "Precisa de pessoa" dão o foco. Conversa de outra
  organização continua inexistente pelo RLS. Configurações do Atendimento seguem só de admin.
- **Nome do contato (2026-11-24, pedido do Bruno)**: o lápis ao lado do nome, no topo da
  conversa, dá um nome ao número (`support_contacts.custom_name`, migração 0111). Ele vence o do
  perfil (`display_name`, que a Meta reescreve a cada mensagem), vale em todas as conversas do
  número, na fila e no aviso à equipe, e não muda nada no WhatsApp do cliente. Vazio volta ao do
  perfil; a troca fica no histórico (`contact_renamed`). Qualquer integrante troca. A regra do
  nome mostrado é `contactName` (equipe → perfil → telefone formatado por `formatPhone`).
- **Fila (2026-11-24, escolha do Bruno)**: sem "Sem setor" em toda linha (o clã só aparece quando
  há); sem empresa, o telefone vai na linha de baixo, sem criar linha nova; quem espera resposta
  fica em negrito com um ponto azul, e a prévia começa com "Você:" ou "IA:" quando a última fala é
  nossa. Medido renderizado: linha de 88 px (108 com empresa) em 375 e 1280 px. No celular, editar
  o nome leva a coluna do nome para uma linha inteira (`max-sm:has-[form]:basis-full`).
- **Quem vê a conversa responde (2026-11-24, pedido do Bruno; antes só quem assumiu)**: texto,
  arquivo e nota de voz. A conversa continua com quem está; sem responsável, fica com quem
  respondeu ("respondeu e ficou com a conversa"); sai de "IA atendendo"/"Precisa de pessoa" e a IA
  para (`conversationAfterTeamReply`). Assumir continua atômico e pausa a IA. Resposta pelo celular
  (eco da coexistência) vira "Em atendimento" sem responsável. **Enter envia** e Shift + Enter
  quebra a linha, como no WhatsApp Web; no celular (toque) o Enter quebra a linha (`enterSends`).
- **Envio**: a action só grava mensagem e `support_outbox`; `outbound-worker.ts` (no
  `support-worker`) chama a Meta. O destino sai do contato, nunca do navegador. A chave do
  formulário impede resposta em dobro. Mensagem é imutável, então o id da Meta (wamid) mora
  no evento `accepted`, e é por ele que os recibos a acham. Recusa 4xx da Meta falha na hora;
  o resto tenta 5 vezes. Se o processo cair entre a Meta aceitar e o registro, a mensagem
  pode sair duas vezes: risco raro e aceito.
- **24 horas**: fora da janela da Meta, a tela bloqueia e explica. Modelos aprovados
  (templates) ainda não existem, então não dá para iniciar conversa pela Guilda.
- **Mídia**: foto abre na conversa. **Documento (2026-11-23, pedido do Bruno)** aparece com o nome
  e a legenda para baixar (`message-file.tsx`), pela mesma rota da foto
  (`/api/atendimento/media/[messageId]`, mesma régua de quem vê a conversa): **só PDF abre no
  navegador; qualquer outro tipo é sempre baixado** como `application/octet-stream` com
  `Content-Security-Policy: sandbox` (`documentResponseHeaders`), para arquivo de cliente nunca
  rodar como página da Guilda. Até 25 MB (`DOCUMENT_MAX_BYTES`); acima, a rota explica e manda abrir
  no WhatsApp do escritório. A Meta só guarda a mídia por um tempo: arquivo antigo some de lá.
  Vídeo continua só como rótulo.
- **Áudio (2026-11-23, pedido do Bruno)**: o áudio recebido toca na conversa (`message-audio.tsx`,
  mesma rota de mídia, só `audio/*`, até 16 MB) e **todo áudio de cliente vira texto pela OpenAI**
  (`gpt-4o-mini-transcribe` com o vocabulário contábil, como no Scharff; `src/lib/support/transcription.ts`).
  Decisão do Bruno: transcrever todos, não só os do teste do agente; a voz do cliente vai à OpenAI,
  e o aviso de privacidade precisa citar isso. Sem `OPENAI_API_KEY` no serviço de atendimento nada
  sai e o áudio só se ouve. `support_message_transcriptions` guarda o texto (a mensagem é imutável);
  a linha é a trava, falha tenta até 3 vezes, AMR fica "indisponível". O `support-worker` transcreve
  antes da triagem, e a leitura (sombra e agente) **espera a transcrição** de áudio do turno até 10
  minutos, para a IA ler "Áudio (transcrição): …" (mascarado como o resto) e não só "Áudio".
  Desenho em `docs/superpowers/specs/2026-11-23-audio-no-atendimento-design.md`.
- **Nota de voz (2026-11-23, pedido do Bruno)**: quem assumiu grava na própria conversa ("Gravar
  áudio" ao lado do Enviar, `voice-recorder.tsx`). O navegador grava no que souber (WebM, OGG ou MP4);
  a rota `POST /api/atendimento/conversations/[id]/audio` confere a régua da resposta em texto ANTES
  de gastar a conversão (`checkSupportAudioReply`, mesma `replyTarget`: quem assumiu, canal, 24 horas),
  converte para OGG/Opus com o **ffmpeg do servidor** (`voice-note.ts`; o Dockerfile instala no
  runner), sobe à Meta (`uploadWhatsAppMedia`) e só então grava mensagem e saída
  (`sendSupportAudioReply`, payload `audio.id`); o worker de saída manda pelo id. A chave da gravação
  (`requestId`) vale para toda nova tentativa: clique duplo ou reenvio não sai em dobro. Para em 5
  minutos e espera o clique (microfone esquecido não vira envio). `Permissions-Policy` libera
  `microphone=(self)`. A voz da equipe não é transcrita (a rotina lê só áudio recebido).
  O envio leva `voice: true` (documentado pela Meta para nota de voz). **A Meta aceita mídia e
  só depois avisa a falha pelo webhook**: o primeiro teste real ficou "Não enviada" sem motivo,
  porque a tela só lia a recusa na hora. Agora `deliveryFailureMessage` mostra a frase e o código
  da Meta, e o `error_data.details` vai ao log do `support-worker`. O segundo teste deu uma
  entregue e duas recusadas com "Media file scrutiny for the file failed" (131053): a conversão
  levava para o OGG os saltos de marca de tempo da gravação do navegador. O ffmpeg agora refaz as
  marcas do zero e cobre salto com silêncio (`aresample=async=1:first_pts=0`); o teste com o
  ffmpeg de verdade grava um WebM com salto e confere o OGG contínuo.
- **Foto e documento para o cliente (2026-11-23, Codex #156; vários de uma vez a pedido do Bruno)**:
  "Anexar" no compositor de quem assumiu. Até 10 arquivos por vez (`SUPPORT_UPLOAD_MAX_FILES`), um
  por mensagem como no WhatsApp, com a legenda só no primeiro. Cada arquivo tem a sua chave
  (`requestId`): o lote sobe um por vez e, se um falhar, os já enviados saem da lista e o resto fica
  para tentar de novo sem duplicar. A rota `POST .../media` sobe à Meta antes de gravar, como a do
  áudio. **Origem pela `isSameOriginRequest`**: atrás do proxy a URL interna nunca bate com a origem
  do navegador, e a comparação direta recusava todo envio na produção.
- **Vínculo com a empresa é manual**, com histórico. Nota interna não se edita nem se apaga
  (`support_conversation_notes`, REVOKE no `guilda_app`).
- **Números e empresas (2026-11-23, pedido do Bruno: "é meio variado")**: uma empresa tem vários
  números e um número pode ser de várias empresas (empresário com duas ou três). O vínculo mora em
  `support_contact_clients` (muitos para muitos, migração 0108, que copiou os vínculos antigos);
  `support_contacts.client_id` **deixou de ser lido e escrito** (ficou no banco). A conversa tem a
  sua empresa (`support_conversations.client_id`): nasce com ela quando o número tem uma só; com
  várias, alguém escolhe. É ela que a Carteira, a fila, o cabeçalho e as missões usam. O cadastro é
  pelo painel Contexto, com o número que escreveu ("Empresas deste número" e "Empresa desta
  conversa"). A mensagem que chega acha o contato com e sem o nono dígito
  (`whatsAppPhoneVariants` em `upsertContact`). Desenho em
  `docs/superpowers/specs/2026-11-23-numeros-e-empresas-design.md`. Próximas: número na ficha da
  empresa (Clientes) e a IA escolhendo ou perguntando a empresa quando o número tem várias.
- **Fora das 24 horas**: a coexistência não deixa a Guilda furar a janela: a API segue a regra,
  e só o aparelho do escritório (celular ou WhatsApp Web) fala livre. Por isso a conversa tem
  **"WhatsApp Web"**, que abre a conversa no WhatsApp logado no navegador (precisa ser o do
  escritório). O app de Windows não é compatível com a coexistência.
- **Triagem por IA em sombra (2026-11-09)**: portada do Scharff, o mesmo escritório
  (`src/lib/support/triage/`: prompt, travas, mascaramento e testes vieram de lá; a
  versão fica em `TRIAGE_PROMPT_VERSION`). O `support-worker` lê cada turno novo de
  conversa sem dono, depois que o cliente para de escrever (`SUPPORT_TRIAGE_DEBOUNCE_SECONDS`),
  e grava em `support_ai_runs` o que faria: setor → clã (pelo nome, `sectors.ts`), urgência,
  resumo, pergunta ou resposta. **Nada vai ao cliente.** A conversa mostra "Leitura da IA ·
  teste" e "Passar para <clã>"; a fila marca "Urgente (IA)" sem reordenar. **Desligada por
  padrão**: só com `SUPPORT_AI_MODE=shadow` as mensagens vão à Anthropic, porque a chave já
  existe no servidor pelos Informativos. Ligar exige o aviso de privacidade ao cliente
  (transferência internacional), como no Scharff. Preços de certificado ainda estão no prompt
  (`BLOCO_CONHECIMENTO`); a Base de conhecimento editável vem depois.
- **Agente para todos e expediente (2026-11-23, pedido do Bruno)**: o interruptor do teste virou
  o **modo do agente** (`support_agent_settings.agent_mode`: `off` · `test` · `live`; a 0110 copiou o
  teste ligado para `test` e deixou `test_enabled` sem uso no banco). Em **Todos os clientes** toda
  conversa NOVA abre rodada sem palavra-chave (`startAgentRound`, `reason: "agent_live"`); a que já
  está com a equipe continua com a equipe, e a palavra ainda reinicia a rodada para testar. Ligar
  "Todos" pede confirmação: **o aviso de privacidade ao cliente continua pendente e é do Bruno**
  antes de ligar. Desligar segue sendo o freio; de "Todos" para "Só teste" as rodadas abertas
  terminam. **Expediente** (`support_business_hours`, `support_special_days`, contas puras em
  `src/domain/business-hours.ts`): semana com até dois períodos por dia e dias especiais (feriado
  ou horário próprio), com sugestão dos feriados nacionais do ano; sem semana salva, conta como
  sempre aberto. Fora do expediente o agente faz a triagem igual, a primeira fala diz "Estamos
  fora do horário de atendimento e a equipe retorna {segunda-feira, 23/11, às 8h}" e o
  encaminhamento diz quando a equipe continua; o aviso no WhatsApp de quem recebeu a conversa fica
  agendado para a abertura (`scheduled_for`), e a regra das 24 horas da Meta é conferida no envio
  (aviso segurado pode não sair). Desenho em
  `docs/superpowers/specs/2026-11-23-expediente-e-agente-ligado-design.md`.
- **Teste do agente (2026-11-19, pedido do Bruno)**: em Atendimento → Configurações, só admin
  liga o interruptor e escolhe a palavra-chave (`support_agent_settings`). Mensagem do cliente
  que COMEÇA com a palavra abre uma rodada (`status = 'ai_active'`, `ai_test_started_at`): só
  nela a IA fala de verdade, pelas regras do Scharff (`src/lib/support/agent/decision.ts`):
  pergunta o assunto uma vez, responde pela base aprovada, até 3 perguntas e encaminha ao clã do
  setor ("Encaminhei ao setor Fiscal…"), sem chamar o cliente pelo nome. Mandar a palavra de novo
  reinicia. As outras conversas continuam só em sombra. Desenho em
  `docs/superpowers/specs/2026-11-19-teste-do-agente-design.md`.
  - **Travas**: a decisão é gravada com a conversa travada e descartada se uma pessoa assumiu, o
    cliente escreveu de novo ou a rodada reiniciou. O worker de saída continua recusando toda fala
    da IA, exceto a da mesma rodada (`payload.agentRound`), com o interruptor ligado e fora de
    `human_active` (`agentDeliveryBlock`). **Desligar é o freio**: encerra as rodadas abertas e
    segura o que estava na fila.
  - Só funciona na produção na prática: o interruptor nasce desligado em cada banco e só a produção
    tem o WhatsApp do escritório. **Antes de abrir para cliente real** falta o aviso de privacidade
    com aceite, como no Scharff. Atribuir à pessoa da Carteira ficou de fora.
  - **Aviso ao clã (2026-11-19, pedido do Bruno)**: quando o agente encaminha a um clã, cada
    integrante com WhatsApp conectado no Perfil recebe "Nova conversa no Atendimento" com cliente,
    clã e assunto, sem link (o Bruno pediu só o aviso), pela mesma fila do aviso de novo cliente (`member_whatsapp_outbox`, que
    agora aponta para um Fluxo OU uma conversa, migração 0106). Só dentro da janela de 24h: o modelo
    Utility aprovado fala de "novo cliente", e o modelo de conversa fica para quando o agente atender
    cliente real. Transferência feita por uma pessoa não avisa (o Bruno escolheu só o da IA).
  - **Encaminhamento por assunto (2026-11-20, pedido do Bruno)**: o Fiscal tem três pessoas e
    avisar o clã inteiro dilui a responsabilidade. Dentro do clã a conversa vai para UMA pessoa:
    (1) a do assunto, que o admin escreve em texto livre por pessoa ("parcelamento, guia de
    parcelamento") e a IA indica pelo roster do Scharff (`atendente_sugerido`); (2) no Fiscal, os
    "assuntos da Carteira" ("guias de imposto, guia atrasada") vão ao responsável da empresa em
    `fiscal_portfolios`, se a conversa estiver vinculada a ela; (3) o resto vai ao líder do clã
    (vários líderes: todos avisados; sem líder: o clã inteiro). A conversa fica atribuída a quem
    foi escolhido e só ele é avisado. Regras em `support_routing_topics` (migração 0107; quem sai
    do clã leva a regra), só admin edita em Atendimento → Configurações. A escolha final é pura
    (`chooseRecipient`, `src/domain/support-routing.ts`); o código só aceita pessoa que ainda é do
    clã. Desenho em `docs/superpowers/specs/2026-11-20-encaminhamento-por-assunto-design.md`.
    Próxima etapa: cadastrar os números de WhatsApp na empresa, para a Carteira acertar já na
    primeira mensagem.
  - **INSS é do RH (2026-11-23, regra do escritório)**: toda guia de INSS, de funcionário ou do
    sócio (pró-labore), é trabalhista/dp, que cai no clã RH. O prompt do Scharff mandava o INSS do
    sócio para o contábil; quanto tirar de pró-labore continua contábil.
  - **Foto e PDF (2026-11-23, pedido do Bruno)**: o cliente manda o PDF da guia e pede "recalcula?"
    sem dizer do que é. No teste do agente, a IA recebe o último arquivo do turno: foto (JPG, PNG,
    WEBP, GIF, até 5 MB) ou PDF (até 10 MB, **só as 2 primeiras páginas**, cortadas com `pdf-lib`
    em `firstPdfPages`), para saber o assunto, encaminhar e dizer no resumo o que é o documento;
    o prompt proíbe recalcular ou conferir valor (`BLOCO_PDF_ANEXADO`). A legenda e o nome do
    arquivo entram no texto (`turnMessageText`); antes a mídia virava só "Documento". **Na sombra o
    arquivo não sai**: o texto é mascarado, o arquivo não, então só a conversa de teste o envia.
    Falha de download ou PDF ilegível segue só com o texto e fica em `result.attachment` da leitura.
    Antes de cliente real, o aviso de privacidade precisa citar o envio de arquivos.

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
  "Abrir fechamentos" das notificações antigas do Telegram aponta para ela). Como
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

### Fluxo Societário: confirmação de recebimento (decisão de 2026-09-03)

Fluxo novo **sempre nasce em `sent_to_corporate`** ("Recebido"), mesmo quando o
clã tem responsável nominal (`findClanDutyHolder(..., "company_flow")`). O
responsável recebe a missão e o aviso, e precisa clicar **Confirmar recebimento**
para o Fluxo virar `in_progress`.

Antes ele entrava direto em `in_progress` — a etapa 1 da esteira nunca era usada
e o painel afirmava "em processamento" sem ninguém ter olhado o pedido. **Não
reintroduzir o auto-avanço**: o clique é o controle de que o pedido foi lido.

`assignedTo` continua sendo preenchido na criação (o dono nominal), então a
linha em Recebido diz de quem se está esperando. Qualquer integrante ativo do
Societário ainda pode assumir um Fluxo parado — nesse caso `assignedTo` passa
para quem assumiu, mas a missão do Societário continua com o dono nominal (o XP
vai para o responsável da missão, comportamento que já existia).

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
- **Retorno para quem pediu** (2026-09-03): missão **avulsa** criada para outra
  pessoa termina em **entrega com retorno escrito obrigatório**
  (`awaiting_approval` exige nota). Quem pediu vê o retorno na lista ("Para você aprovar") e no
  detalhe, aprova com comentário opcional (vai para o histórico e para quem
  entregou), e é avisado no WhatsApp quando o trabalho começa, quando a
  entrega chega (com o retorno no texto) e, no outro sentido, quem entregou
  recebe a aprovação com o comentário. "Você pediu" mostra a última
  movimentação de cada pedido.
- **Informativos** (`informative_id` preenchido): lidas como **pacote por
  empresa**, com o progresso do conjunto (`src/domain/mission-triage.ts`).
  Criar aqui é preparar um Informativo (`/informativos`), nunca uma missão
  solta. **Concluem direto, sem aprovação** (decisão de 2026-09-04,
  `task.fromInformative` em `authorizeTransition`): ali não existe "quem
  pediu" — o pedido veio do Informativo, e quem consta como criador só
  preparou o pacote. Cobrar dele uma aprovação transformava rotina do clã em
  vai-e-volta sem leitor. "Entregar com retorno" continua no botão como
  **opção** (secundário ao lado de Concluir), nunca como obrigação. A régua de
  aprovação obrigatória segue valendo para as avulsas — não unificar as duas.

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
  substitui a ideia anterior de "acentos neon").

- **Tema claro opcional (decisão de 2026-11-15, pedido do Bruno)**: substitui o
  "dark é o tema único, sem toggle". O escuro continua o PADRÃO e a identidade;
  o claro ("neve e ferro") existe porque o dia inteiro de leitura de lista num
  escritório iluminado cansa menos com texto escuro sobre fundo claro. A escolha
  fica no menu do avatar (Aparência: Escuro / Claro / Automático), via
  `next-themes` com `data-theme` no `<html>` (`theme-provider.tsx`), guardada
  por aparelho no localStorage. Regras: toda cor nova é token com valor nos DOIS
  temas (`:root` e `[data-theme="light"]` no `globals.css`); nada de `oklch()`
  solto em `.tsx`; não trocar o atributo por `class="dark"` — isso ligaria as
  ~30 variantes `dark:` do shadcn que nunca estiveram ativas e mudaria o escuro.
  **Papel em vez de neve (2026-11-16, pedido do Bruno)**: o primeiro claro, frio
  e azulado, ficou "branco demais, incomoda". Ele pediu o claro do Tero (o app
  de notas da Shift): fundo papel `#F6F1EA`, cards quase brancos, bordas de
  argila, texto tinta `#1A1612` e **barra lateral escura nos dois temas**
  (`data-theme="dark"` no `<aside>`). Os acentos continuam os da Guilda (azul,
  ouro de recompensa, cobre de alerta). Não voltar ao claro frio sem ele pedir.

- **Limpeza visual (2026-11-15, pedido do Bruno: "muito poluído")**:
  (1) nome de empresa na tela passa por `companyDisplayName`
  (`src/domain/company-display-name.ts`, puro e testado): tira a raiz do CNPJ
  do MEI e troca CAIXA ALTA por nome próprio. **Só exibição** — o nome gravado
  segue o oficial (NFS-e, XML, pasta da Domínio, busca, conciliação de
  planilha); nunca gravar o resultado. (2) O selo de pendências da navegação é
  `--primary`, não vermelho: pendência não é erro. (3) `SegmentedNav` em texto
  normal (`text-sm`), não mono maiúsculo espaçado; o estilo HUD fica para
  rótulos de dado. (4) A barra lateral perdeu "Mesa de comando", o cartão
  "Organização ativa · ambiente de trabalho", a numeração dos grupos e o
  "agora"; a organização aparece sob "Guilda". (5) O tramado diagonal do fundo
  saiu. Não recolocar nada disso sem o Bruno pedir.

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
