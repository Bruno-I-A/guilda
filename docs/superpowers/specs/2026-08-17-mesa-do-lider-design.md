# Mesa do Líder — informativos que viram missões do clã

Data: 2026-08-17. Continuação direta de `codex/clans-missions`
(clãs, missões coletivas, Telegram + IA), que passa a ser a base da main.

## Problema

Hoje o informativo chega pelo Telegram, a IA extrai as ações e — quando a
linha traz `Att. FULANO` — a missão nasce **atribuída direto à pessoa**.
O líder do clã não decide nada: ele só assiste. As telas de clã (`/clans`)
mostram contadores, mas não distribuem trabalho, e a gestão de vínculos é
exclusiva de admin/owner.

O informativo real (PICCOLI AGRO, 2026-08-17) nomeia 8 pessoas em 12 ações.
Sem mudança, 100% do informativo pula o líder.

## Decisões

1. **Clã ganha da pessoa.** Se o setor da linha casa com um clã, a missão
   nasce **do clã**, sem responsável — o `Att.` vira **sugestão**, não
   atribuição. O líder distribui.
2. **Setor sem clã + nome reconhecido → missão individual direta.** Decisão
   do usuário: os clãs continuam sendo **apenas cinco** (Fiscal,
   Contabilidade, RH, Societário, Financeiro). Certificado Digital,
   Automação, Servidor e Arquivo não viram clã; a missão vai direto para a
   pessoa nomeada e o `clan_id` é inferido do clã principal dela (regra já
   implementada em `resolveAssigneeClan`).
3. **Sem clã e sem nome → não cria missão.** Fica pendente na prévia,
   exigindo que quem confirma escolha clã ou pessoa. Nunca adivinhar por
   proximidade com a linha anterior.
4. **Mapeamento setor→clã é determinístico no servidor**, não decisão da IA:
   função pura com tabela de sinônimos, testada em Vitest contra o
   informativo real. A IA devolve o setor como texto; o servidor resolve.
5. **Atribuição em lote com override por missão** (escolha do usuário): o
   líder atribui o pacote inteiro de um informativo a uma pessoa com um
   clique, e troca o responsável de missões específicas depois. O modelo
   interno é sempre por missão; o "pacote" é ação em lote.
6. **Informativo entra também pelo painel**, não só pelo Telegram — mesmo
   pipeline (extração → prévia → confirmação), duas portas de entrada.
7. **Líder passa a gerenciar os integrantes do próprio clã** (adicionar e
   remover). Nomear/destituir líder continua exclusivo de admin/owner, e o
   invariante "todo clã ativo tem ao menos um líder" continua valendo.
8. **Missão nasce sem prazo** quando o informativo não trouxer data. Sem
   prazo padrão por setor, sem prazo inferido: o sistema nunca inventa data.
   `ABERTURA: 16/07/2026` é data de abertura da empresa, não prazo.
9. **Líderes também confirmam informativo**, não só admin/owner. Vale para as
   duas portas de entrada (painel e Telegram) — não faz sentido o líder
   distribuir o trabalho mas depender de um admin para o informativo entrar.
10. **Mural da Guilda**: quadro de avisos da organização, com confirmação
   explícita de leitura. Toda empresa nova cadastrada publica um aviso
   automático no mural, na mesma transação em que o informativo é
   confirmado. É onde os **combinados** da decisão 11 passam a morar — eles
   não viram missão, mas a equipe precisa saber deles.
11. **Só linha de ação vira missão.** O informativo mistura três coisas —
   dados cadastrais, combinados permanentes ("Camila responde pelos
   informativos", "distribuição de lucros trimestral") e ações pontuais.
   Combinado não tem conclusão possível; virar missão só suja a lista. O
   discriminador é o **verbo no infinitivo** no começo da linha, e o bloco
   `OBSERVAÇÕES` recolhe o que não é ação.

## Regra de roteamento (o coração da mudança)

Para cada ação extraída, **na ordem**:

| # | Condição | Resultado |
|---|---|---|
| 1 | Setor casa com clã ativo | `assignee_id` NULL, `clan_id` = clã, sugestões gravadas |
| 2 | Sem clã, mas `Att.` casa com pessoa | `assignee_id` = pessoa, `clan_id` = clã principal dela |
| 3 | Sem clã e sem pessoa | Não cria — pendente de decisão na prévia |

Aplicado ao informativo real:

```
1.x FISCAL / EMISSÃO DE NOTAS / INFORMATIVOS  -> clã Fiscal       (sug. Camila, Eduarda)
2.0 RH — PRÓ-LABORE                           -> clã RH           (sug. Carol, Jenifer)
3.0 CONTABIL                                  -> clã Contabilidade(sug. Rafa, Bruno)
5.0 COBRANÇA / HONORÁRIO                      -> clã Financeiro   (sug. Camila)
4.0 CERTIFICADO DIGITAL                       -> direto p/ Bruno
6.0 AUTOMAÇÃO — ONVIO                         -> direto p/ Fabi
6.0 AUTOMAÇÃO — VERI                          -> direto p/ Bruno
7.0 SERVIDOR                                  -> direto p/ Bruno
8.0 ARQUIVO                                   -> direto p/ Eduarda
9.0 WHATSAPP / BOAS-VINDAS                    -> pendente (sem setor, sem nome)
```

Resultado: 5 missões vão para 4 líderes distribuírem, 5 saem prontas, 1 exige
decisão humana. É exatamente o comportamento pedido.

## Schema (deltas sobre `codex/clans-missions`)

1. **`telegram_ai_drafts` → `informatives`** (`ALTER TABLE ... RENAME`):
   - `connection_id` passa a **anulável** (entrada pelo painel não tem chat);
   - nova coluna `source` enum `('telegram','panel')`, default `'telegram'`.
   O nome passa a dizer o que a linha é: o informativo recebido, com o texto
   original, a extração da IA e o estado de confirmação.
2. **`tasks.informative_id`** uuid anulável → `informatives(id)`. É o que
   agrupa o "pacote" de uma empresa para a atribuição em lote. Índice
   `(org_id, informative_id)`.
3. **`task_assignee_suggestions`**: `id`, `org_id`, `task_id`, `user_id`
   (anulável — nome não reconhecido continua registrado), `raw_name`,
   `created_at`. Índice `(org_id, task_id)`. Resolve "Carol/Jenifer" e
   "Rafa/Bruno", que não cabem numa coluna única.
4. **`guild_notices`** (mural): `id`, `org_id`, `author_id`, `kind` enum
   `('notice','new_client')`, `title` varchar(160), `body` text,
   `client_id` (anulável → `clients`), `informative_id` (anulável →
   `informatives`), `requires_ack` bool default false, `pinned` bool default
   false, `published_at`, `archived_at`, `created_at`, `updated_at`.
   Índices `(org_id, pinned, published_at desc)` e único parcial
   `(informative_id) WHERE kind = 'new_client'` — um aviso por informativo,
   idempotente igual ao crédito de XP.
5. **`guild_notice_reads`**: `id`, `org_id`, `notice_id` (cascade),
   `user_id`, `acknowledged_at`. Único `(org_id, notice_id, user_id)` e
   índice `(org_id, user_id)`. Confirmação é **fato registrado, não
   alternável**: insert idempotente, sem "desconfirmar".
6. RLS `org_isolation` em tudo que for novo, no padrão das demais tabelas,
   e FK composta `(org_id, task_id)` como no resto da branch.

Nada de `UPDATE` em `xp_ledger`: distribuir missão não mexe em XP. O crédito
continua no momento da conclusão, para quem estiver responsável.

## Componentes

### Fase A — Base
Integrar `codex/clans-missions` + `feat/brasao-guilda` na main. Rodar
`vitest`, `lint` e `build` antes de empilhar qualquer coisa nova.

### Fase B — Roteamento por clã
- `src/domain/clan-routing.ts` (puro): `resolveSectorClan(setor, clãs)` com
  tabela de sinônimos (`CONTABIL`→Contabilidade, `EMISSÃO DE NOTAS`,
  `INFORMATIVOS`→Fiscal, `COBRANÇA`, `HONORÁRIO`→Financeiro,
  `PRÓ-LABORE`→RH, `ABERTURA`/`ALTERAÇÃO`/`BAIXA`→Societário) +
  `routeInformativeTask(...)` implementando a tabela de 3 regras acima.
  Testes com o informativo da PICCOLI como fixture.
- Prompt da IA (`src/lib/ai/informative.ts`): passa a devolver o **setor
  como texto** e a lista de nomes do `Att.`, e para de escolher entre
  individual/clã. Quem decide é a função pura.
- Migrations do schema acima; gravação das sugestões na criação.

### Fase C — Entrada pelo painel
- `/informativos`: textarea para colar, botão "Analisar", prévia com as
  missões agrupadas por destino (clã / pessoa / pendente), campos editáveis
  antes de confirmar, botão "Criar missões".
- Reusa `extractInformative` e a criação transacional já existentes; só troca
  a porta de entrada. Rate limit por usuário (chamada de IA custa dinheiro).
- Permissão: **líder de clã, admin ou owner** (decisão 9), nas duas portas —
  a regra atual do Telegram, restrita a admin/owner, também muda.

### Fase D — Mesa do Líder (`/clans/[id]`)
O "local" pedido. Visível para integrantes; **ações** só para líder do clã e
admin/owner (`authorizeTaskTransfer` já cobre isso — falta a interface).
1. **Fila de distribuição** — missões do clã sem responsável, agrupadas por
   informativo/empresa. Cada linha: título, empresa, prazo, XP, chips
   "Sugerido: Camila", seletor de pessoa e botão Enviar.
2. **Lote** — cabeçalho do grupo: "PICCOLI AGRO · 3 missões · atribuir todas
   a [pessoa]". Nova action `assignClanTasks(taskIds[], assigneeId)`,
   uma transação, autorização reavaliada por missão, uma linha em
   `task_transfers` para cada.
2b. **Aceitar sugestões** — botão que atribui de uma vez todas as missões do
   grupo cuja sugestão do informativo é única e reconhecida. Resolve a
   tensão entre "o líder decide" e "o informativo já sabia": quando a
   sugestão está certa, é um clique; quando não está, o líder ignora o
   botão e distribui na mão.
3. **Carga do clã** — por integrante: missões abertas, atrasadas e XP do mês.
   É o que transforma a distribuição em decisão informada.
4. **Em andamento** — quem está com o quê, com transferir/puxar de volta.
5. Atalho no dashboard para quem é líder: "N missões esperando distribuição".
6. Notificação ao novo responsável pelo outbox do Telegram já existente.

### Fase E — Mural da Guilda (`/mural`)
Quadro de avisos da organização, com confirmação explícita de leitura.

1. **Publicar aviso** — qualquer membro relata uma situação (título + texto).
   Marcar como **fixado** ou **exigir confirmação** é restrito a líder e
   admin/owner: qualquer um pode avisar, mas nem todo mundo pode obrigar a
   Guilda inteira a dar ciência.
2. **Aviso automático de empresa nova** — na mesma transação que confirma o
   informativo e cria cliente + missões, entra um `guild_notices` com
   `kind = 'new_client'`, `requires_ack = true`, apontando para o cliente e
   para o informativo. Título: "Nova empresa: PICCOLI AGRO SERVIÇOS LTDA".
   Corpo: os dados cadastrais mais o bloco `OBSERVAÇÕES` — exatamente o que a
   decisão 11 tira das missões por não ser ação. O aviso linka para a ficha
   do cliente e para as missões geradas.
3. **Confirmar visualização** — botão por aviso, só para si mesmo (nunca
   confirmar por outra pessoa; a action ignora qualquer `userId` vindo do
   cliente e usa o da sessão). Insert idempotente.
4. **Pendências** — quem publicou, líderes e admin/owner veem "12 de 15
   confirmaram" e a lista de quem falta. Para o membro, badge de pendentes
   no item de navegação e destaque no card até confirmar.
5. **Notificação** pelo outbox do Telegram já existente, respeitando as
   preferências de cada pessoa. Aviso sem `requires_ack` não notifica —
   senão o mural vira spam e as pessoas param de ler o que importa.

**Restrição de navegação (precisa ser resolvida nesta fase).** A tab bar
mobile já foi de 7 para 8 colunas quando `/clans` entrou. Com `/mural` e
`/informativos` seriam 10 — cerca de 36px por item numa tela de 360px, o que
não é tocável. Nesta fase a tab bar passa a mostrar **5 itens** (Início,
Missões, Mural, Fechamentos, Mais) e o resto vai para uma folha de overflow
em "Mais". A sidebar do desktop continua listando tudo.

### Fase F — Fechamento
Ajuste do `/clans` (link para a Mesa), permissão de gestão de integrantes
para o líder, seed com sugestões, README/screenshot.

## Modelo de informativo — proposta

O formato atual **funciona** (a IA aguenta), mas tem defeitos reais que
custam precisão e dinheiro por chamada:

- numeração duplicada — dois itens `1.1`, depois `1.2`;
- separador inconsistente — `–` (travessão) em quase tudo, `-` (hífen) em
  `2.0` e `7.0`, e travessão também **dentro** da descrição;
- `Att.` some em `5.0 – *COBRANÇA – CAMILA` e o nome cola no setor em
  `6.0 – AUTOMAÇÃO FABI –`;
- negrito do WhatsApp (`*`) abre em `5.0` e só fecha em `8.0`, atravessando
  quatro itens;
- sub-itens com tab (`ONVIO`, `VERI`) têm **donos diferentes** do item pai;
- `HONORÁRIO – DOMINIO` não é valor de honorário, é o sistema de cobrança;
- nenhuma ação tem prazo — só `ABERTURA 16/07/2026`, que é data de abertura
  da empresa, não prazo. Todas as missões nascem sem prazo.

O primeiro rascunho desta spec propunha `|` como separador de campos. Foi
descartado: o separador é o que **menos** importa. Quem lê o informativo é um
LLM, não um regex — ele identifica o setor porque o setor está numa lista
fixa, e a pessoa porque o nome está no diretório de membros. Trocar a
pontuação só cria trabalho para quem digita no WhatsApp, sem ganho de
precisão. O travessão/hífen que eles já usam fica.

Formato final (guia visual para a equipe publicado como artifact em
2026-08-17):

```
INFORMATIVO — NOVO CLIENTE

Código: 1124
Razão social: PICCOLI AGRO SERVIÇOS LTDA
CNPJ: 68.100.490/0001-31
Abertura: 16/07/2026
Endereço: Getúlio Vargas
Enquadramento: Simples Nacional
Particularidade: Fator R
Honorário: Domínio
Contato: Felipe

AÇÕES
Fiscal - Camila - parametrizar faturamento médio de 15.000,00/mês a partir de 08/2026 e controlar o Fator R
Fiscal - Eduarda - configurar a emissão de nota mensal para o funcionário da Kesoja Getúlio Vargas
RH - cadastrar o pró-labore de 5.000,00 a partir da competência 07/2026
Contabilidade - abrir a contabilidade com distribuição de lucros trimestral
Financeiro - Camila - cadastrar a cobrança no Domínio
Certificado digital - Bruno - solicitar o certificado digital do cliente
Automação - Fabi - habilitar o cliente no Onvio
Automação - Bruno - habilitar o cliente no Veri
Servidor - Bruno - criar a pasta da empresa com as subpastas padrão
Arquivo - Eduarda - arquivar os documentos impressos em pasta suspensa
Administrativo - Eduarda - cadastrar no grupo de transmissão do WhatsApp, mandar as boas-vindas e pedir para o cliente adicionar o número

OBSERVAÇÕES
Camila responde por todos os informativos da empresa.
Rafa e Bruno acompanham a contabilidade.
```

Cinco regras, nenhuma pontuação nova:

1. **Uma ação por linha** — sub-item vira linha própria (Onvio é da Fabi,
   Veri é do Bruno; juntos viram uma missão só, com um dono só).
2. **Comece pelo verbo no infinitivo** — é o que separa ação de combinado
   (decisão 11). Linha sem verbo vai para `OBSERVAÇÕES`: não vira missão,
   vira corpo do aviso de empresa nova no mural.
3. **Setor primeiro, de vocabulário fixo** — cinco nomes de clã roteiam para
   o clã; Certificado digital, Automação, Servidor, Arquivo e Administrativo
   exigem nome na linha.
4. **Nome só quando já se sabe quem faz** — sem nome, a missão vai para o clã
   e o líder distribui. `Setor - Pessoa - ação` ou `Setor - ação`; a IA
   distingue os dois porque o segundo campo é ou um nome do diretório ou um
   verbo.
5. **Sem numeração e sem `*` do WhatsApp.**

Prazo, quando existir, no fim da linha: `… - prazo 05/09/2026`.

Adotar é recomendado, **não obrigatório**: o roteamento e a extração
continuam funcionando com o formato antigo, apenas com mais ambiguidade
caindo na tela de conferência.

## Fora de escopo

Campanhas 5c/5d (instanciação em lote sobre a carteira, bônus de submissão),
pool auto-servido aberto a todos, novos clãs, edição de informativo já
confirmado, badges e notificações por e-mail. No mural: comentários,
anexos, reações, avisos direcionados a um clã específico e agendamento de
publicação — v1 é aviso da Guilda inteira, com confirmação de leitura e nada
mais.

## Verificação

- Vitest: `clan-routing` (tabela de sinônimos, as 3 regras, nomes múltiplos,
  nome desconhecido) usando o informativo da PICCOLI como fixture; suíte
  existente verde.
- Multi-tenant: UUID de outra org não pode virar clã, responsável ou
  informativo de destino.
- Concorrência: dois líderes atribuindo a mesma missão serializam no lock;
  só um vence.
- Mural: confirmar duas vezes o mesmo aviso não duplica registro; membro não
  consegue confirmar em nome de outro; membro comum não consegue publicar
  aviso com `requires_ack` nem fixado; reconfirmar o mesmo informativo não
  gera um segundo aviso de empresa nova (índice parcial).
- Tab bar mobile em 360px: 5 alvos de toque confortáveis e o overflow "Mais"
  alcançando todas as rotas.
- Manual, **nos dois formatos**: colar o informativo original da PICCOLI
  (espera-se 5 clã, 5 direto, 1 pendente) e depois o reescrito no formato
  novo (espera-se 5 clã, 6 direto, 0 pendente, e as duas linhas de
  OBSERVAÇÕES ignoradas) → confirmar → entrar como líder do RH →
  distribuir o pacote → conferir `task_transfers` e a notificação.
  Screenshot mobile.
- `lint` e `build` limpos.
