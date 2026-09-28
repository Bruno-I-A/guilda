# Plano de implantação do MCP da Guilda

## Objetivo

Permitir que Codex e Claude consultem e operem a Guilda por ferramentas MCP,
principalmente para:

- analisar a fila de missões e explicar prioridades, atrasos e bloqueios;
- localizar e detalhar missões, empresas, clãs e responsáveis;
- criar, editar, atribuir, transferir, iniciar, entregar, aprovar, rejeitar,
  concluir e cancelar missões dentro das regras atuais;
- configurar os dados operacionais de uma missão, como descrição, prazo,
  responsável e clã;
- manter autoria e auditoria separadas para Codex e Claude.

O primeiro ciclo não dará aos agentes poderes de administração da organização,
como alterar papéis, membros, clãs, XP, integrações ou credenciais. Esses poderes
podem virar ferramentas próprias depois, com escopos e revisão separados.

## Decisões de arquitetura

### 1. O MCP ficará dentro da aplicação Guilda

O endpoint será `https://<dominio-da-guilda>/api/mcp`, executado pelo mesmo
Next.js e usando o mesmo PostgreSQL. Não haverá outro serviço nem outro banco.
Isso mantém uma única implementação das regras e acompanha o deploy normal da
Guilda.

O servidor será HTTP e sem estado entre requisições, seguindo o padrão que já
funciona no Shift CRM. A biblioteca prevista é `@modelcontextprotocol/server`.

### 2. Um token para cada agente e organização

Codex e Claude terão chaves diferentes. Cada chave será vinculada a:

- uma organização;
- um membro real da Guilda, em nome de quem o agente atua;
- um nome de agente, por exemplo `codex` ou `claude`;
- uma lista explícita de escopos;
- datas de criação, último uso e revogação.

Uma pessoa que opere mais de uma organização usará uma chave por organização.
Isso elimina a ambiguidade de organização ativa que existe numa sessão web.

Cada conexão representa a pessoa escolhida na criação da chave. O papel `owner`
do Bruno permanece no nível máximo; `admin` e `member` continuam sujeitos à
própria hierarquia e aos próprios vínculos com clãs. Owner pode provisionar uma
chave para qualquer membro; admin só para si ou para membros abaixo dele; member
só para si. O usuário humano permanece nos eventos de domínio e o agente exato
fica numa trilha MCP separada. Não serão criados usuários artificiais que possam
receber XP ou entrar acidentalmente em clãs.

### 3. A chave será armazenada somente como hash

O valor completo será exibido apenas uma vez na criação. O banco guardará hash,
prefixo/últimos caracteres, nome, vínculo, escopos e metadados de uso. Revogar
uma chave terá efeito imediato.

A autenticação acontece antes de existir um contexto de organização. Por isso,
a tabela de chaves será uma tabela de controle de acesso, com permissões SQL
mínimas para autenticação. Todas as consultas de domínio feitas depois da
autenticação passarão por `withOrgTx` e também filtrarão `org_id` explicitamente.

### 4. O MCP reutilizará o domínio da aplicação

As regras que hoje estão concentradas nas Server Actions de missões serão
extraídas para funções de serviço. Haverá dois adaptadores:

- a interface web obtém o ator com `requireMemberContext` e chama o serviço;
- o MCP obtém o ator pela chave e chama o mesmo serviço.

O serviço continuará usando `authorizeTransition`, permissões por papel,
vínculo com clã, `withOrgTx`, bloqueio de linha e o ledger de XP. As Server
Actions ficarão responsáveis por sessão, validação do formulário e revalidação
de páginas, sem duplicar a regra de negócio.

## Modelo de autorização

O contexto de execução terá, no mínimo:

```ts
type GuildActor = {
  orgId: string;
  userId: string;
  role: MemberRole;
  source: "web" | "mcp";
  agentKeyId?: string;
  agentName?: string;
  scopes: string[];
};
```

Uma chamada MCP só pode prosseguir quando as quatro camadas permitirem:

1. chave válida, ativa e vinculada à organização;
2. escopo da chave compatível com a ferramenta;
3. papel do membro compatível com a operação;
4. acesso ao clã e à missão compatível com as regras atuais.

Um ID de missão, empresa, membro ou clã nunca será suficiente. O registro será
buscado dentro de `withOrgTx`, com `org_id` explícito, e o acesso ao recurso será
provado antes da alteração. Recurso de outra organização ou clã invisível será
respondido como não encontrado.

Escopos iniciais:

| Escopo | Permite |
| --- | --- |
| `missions:read` | Listar, buscar, detalhar e analisar missões visíveis |
| `directory:read` | Consultar empresas, clãs e membros que o ator pode usar |
| `missions:create` | Criar missões |
| `missions:write` | Editar, iniciar, entregar e concluir |
| `missions:assign` | Atribuir e transferir conforme papel e clã |
| `missions:review` | Aprovar ou rejeitar quando o ator já teria esse poder |
| `missions:cancel` | Cancelar; não concede exclusão física |

Nenhum escopo aumenta o papel do membro. Ele apenas reduz o conjunto que a
chave pode usar.

## Ferramentas da primeira versão

### Leitura e análise

| Ferramenta | Resultado |
| --- | --- |
| `contexto_da_guilda` | Organização, membro representado, papel, clãs visíveis e capacidades da chave |
| `resumo_de_missoes` | Contagens por status, vencidas, para hoje, sem responsável, aguardando aprovação e bloqueadas |
| `listar_missoes` | Lista paginada com filtros por escopo, status, clã, empresa, responsável, prazo e texto |
| `detalhar_missao` | Missão, empresa, responsável, histórico, transferências e próximas ações permitidas |
| `buscar_empresas` | Empresas visíveis por nome, CNPJ ou identificador |
| `listar_integrantes` | Membros que podem ser usados como responsável no contexto informado |
| `listar_clas` | Clãs visíveis e as capacidades do ator em cada um |

`listar_missoes` aceitará escopos funcionais como `minhas`, `criadas_por_mim`,
`fila_do_cla` e `todas_permitidas`. A ferramenta nunca retornará linha bruta do
banco; a saída será um DTO pequeno, estável e sem campos internos.

### Operação

| Ferramenta | Regra principal |
| --- | --- |
| `criar_missao` | Valida clã, empresa e responsável antes da criação |
| `editar_missao` | Altera apenas os campos que a tela já permite alterar |
| `atribuir_missao` | Aplica papel e vínculo com clã |
| `transferir_missao` | Usa a mesma trilha de transferência da tela |
| `iniciar_missao` | Passa pela máquina de estados |
| `entregar_missao` | Exige retorno e envia para aprovação quando necessário |
| `concluir_missao` | Só conclui diretamente quando a regra atual permitir |
| `aprovar_missao` | Exige o mesmo poder de aprovação da interface |
| `rejeitar_missao` | Exige motivo e volta para o estado previsto no domínio |
| `cancelar_missao` | Exige motivo e o poder já previsto pela Guilda |

`excluir_missao`, `desfazer_conclusao`, alterações de XP e configurações da
organização ficam fora da primeira versão. Se forem necessárias, entram depois
como ferramentas e escopos separados.

## Concorrência e repetição de chamadas

Toda ferramenta de escrita receberá:

- `idempotency_key`, criado pelo cliente para aquela intenção;
- `expected_updated_at` ou versão equivalente, obtida ao ler a missão.

Uma tabela de comandos MCP terá uma restrição única por chave e
`idempotency_key`. Uma repetição devolverá o resultado original, em vez de
executar novamente. Se a missão mudou desde a leitura, a ferramenta recusará a
alteração e devolverá o estado atual para nova análise.

As transições continuarão bloqueando a linha da missão dentro da transação. A
conclusão e o crédito de XP continuarão atômicos e idempotentes pelo evento da
missão; a idempotência MCP acrescenta proteção para timeout e repetição do
cliente.

## Auditoria

Será criada uma trilha append-only para cada chamada de escrita, contendo:

- organização, membro representado, chave e nome do agente;
- ferramenta e recurso afetado;
- resultado, horário e chave de idempotência;
- resumo dos campos alterados, com dados sensíveis removidos;
- identificador do evento de missão relacionado, quando houver.

O token completo, secrets, cookies e conteúdo irrelevante do prompt nunca
entram no log. A auditoria MCP complementa `task_events`, transferências e o
ledger; não os substitui.

## Proteções do endpoint

- `Authorization: Bearer` obrigatório, com erro genérico para chave inválida ou
  revogada;
- corpo com limite pequeno, inicialmente 256 KB;
- limite por chave para chamadas válidas e limite separado para tentativas de
  autenticação inválidas;
- validação Zod em todos os argumentos;
- sem confiança no `proxy.ts`; `/api/mcp` autentica e autoriza sozinho;
- respostas sem stack trace ou detalhes de SQL;
- ferramentas anotadas como somente leitura, idempotentes ou destrutivas no
  protocolo MCP;
- conexão da aplicação mantida como `guilda_app`, nunca como dono/superuser.

## Alterações previstas no código e no banco

### Código

- `src/lib/tasks/service.ts`: comandos compartilhados do domínio de missões;
- `src/lib/tasks/queries.ts`: leituras com escopo e autorização;
- `src/lib/tasks/dto.ts`: saídas estáveis do MCP e da interface;
- `src/lib/mcp/auth.ts`: autenticação, escopos e contexto do agente;
- `src/lib/mcp/audit.ts`: registro de comandos;
- `src/mcp/server.ts`: registro e schemas das ferramentas;
- `src/app/api/mcp/route.ts`: transporte HTTP, autenticação e limites;
- tela administrativa em Configurações para criar, listar e revogar chaves.

### Banco

- `mcp_agent_keys`: hash e vínculo da chave;
- `mcp_command_receipts`: idempotência e resultado resumido;
- `mcp_audit_events`: trilha de auditoria append-only.

A migration será aditiva. As tabelas de domínio continuarão com RLS e `FORCE
ROW LEVEL SECURITY`. Depois da migration, a validação incluirá o catálogo do
PostgreSQL e a confirmação de que as conexões da aplicação usam `guilda_app`.

## Plano de entrega

### Etapa 1 — contrato e serviço compartilhado

1. Especificar schemas de entrada e saída das ferramentas.
2. Extrair as regras de missões das Server Actions para o serviço compartilhado.
3. Fazer as telas existentes chamarem o novo serviço sem mudar comportamento.
4. Cobrir as transições, permissões e vínculos com testes de domínio e serviço.

Resultado: a base segura para o MCP existe, mas nenhum endpoint público foi
habilitado.

### Etapa 2 — chaves, escopos e auditoria

1. Criar a migration das três tabelas MCP.
2. Implementar geração, hash, autenticação, último uso e revogação.
3. Criar a tela administrativa, disponível somente a quem pode administrar a
   organização.
4. Exibir o token uma única vez.

Resultado: Codex e Claude podem ter identidades separadas e revogáveis.

### Etapa 3 — MCP somente leitura

1. Criar `/api/mcp` em modo stateless.
2. Entregar as sete ferramentas de leitura.
3. Conectar Codex e Claude à homologação com tokens diferentes.
4. Validar respostas, paginação, visibilidade de clã e isolamento entre
   organizações.

Resultado: os agentes analisam o trabalho real sem poder alterá-lo.

### Etapa 4 — operações de missão

1. Implementar idempotência e controle de versão.
2. Liberar criação, edição e atribuição.
3. Liberar as transições uma a uma, começando por iniciar e entregar.
4. Liberar aprovação, conclusão, transferência e cancelamento após os testes de
   concorrência e XP.

Resultado: os agentes administram o ciclo completo permitido de uma missão.

### Etapa 5 — homologação e produção

1. Executar um roteiro com empresas e missões fictícias na homologação.
2. Usar um token exclusivo do Codex e outro do Claude.
3. Revogar e recriar uma chave para provar o procedimento de resposta.
4. Validar o usuário SQL ativo, RLS e políticas `FORCE` no banco da homologação.
5. Aprovar a versão em `develop`.
6. Abrir PR `develop` → `main`, revisar migration e acompanhar o Easypanel no
   merge, pois a integração Git pode publicar automaticamente.
7. Criar as chaves de produção pela tela e guardá-las em variáveis locais dos
   clientes MCP, nunca no repositório ou no chat.

## Testes obrigatórios

### Autorização e isolamento

- chave da organização A não lê nem altera uma missão conhecida da organização
  B;
- membro sem vínculo com o clã recebe “não encontrado”;
- chave somente leitura não executa nenhuma escrita;
- escopo não supera papel do membro;
- IDs de empresa, clã e responsável de outra organização são rejeitados.

### Estado, XP e concorrência

- nenhuma ferramenta pula `authorizeTransition`;
- duas chamadas simultâneas de conclusão geram uma transição e um crédito;
- repetição da mesma `idempotency_key` devolve o primeiro resultado;
- chaves diferentes concorrendo sobre uma versão antiga recebem conflito;
- aprovação, rejeição, cancelamento e janela de desfazer mantêm o comportamento
  atual.

### Transporte e credenciais

- fluxo MCP real: initialize, listar ferramentas e chamar ferramenta;
- ausência, má formação, revogação e expiração de chave;
- limite de corpo e rate limit;
- auditoria registra o agente correto sem armazenar a chave;
- reiniciar ou publicar a aplicação não invalida comandos já registrados.

Os testes de RLS e concorrência rodarão contra PostgreSQL real no CI. O job de
integração criará dono e `guilda_app`, aplicará migrations e executará a suíte
como o papel da aplicação. Testes unitários rápidos continuarão separados.

## Critérios de aceite da primeira versão

- Codex e Claude aparecem como agentes distintos na auditoria;
- cada chave opera uma única organização e pode ser revogada sem deploy;
- os agentes conseguem explicar a fila, encontrar uma missão e informar as
  próximas ações permitidas;
- um agente consegue criar, atribuir e percorrer o ciclo permitido de uma
  missão sem contornar as regras da interface;
- chamadas repetidas ou concorrentes não duplicam evento nem XP;
- uma tentativa entre organizações e uma tentativa sem vínculo de clã falham;
- a aplicação em homologação conecta como `guilda_app` e as tabelas de domínio
  mantêm RLS forçado;
- nenhum segredo é registrado no Git, no log ou no Cerebro.

## Estimativa

| Bloco | Esforço esperado |
| --- | --- |
| Serviço compartilhado e regressão das telas | 1–2 dias |
| Chaves, migration, auditoria e tela | 1–1,5 dia |
| Ferramentas de leitura | 1 dia |
| Ferramentas de escrita e concorrência | 1–2 dias |
| CI, homologação e conexão dos dois agentes | 1 dia |

Estimativa total: **5 a 7 dias úteis**, com um primeiro resultado somente leitura
em cerca de **2 a 3 dias úteis**.

## Evolução posterior

Depois de estabilizar missões, o mesmo modelo pode receber ferramentas para
informativos, mural, fechamentos e carteiras. Administração de membros, papéis,
clãs, integrações e parâmetros da organização deve continuar como uma fase
separada, com escopos próprios e uma política explícita de confirmação.
