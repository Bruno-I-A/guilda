# Teste do agente no WhatsApp, ativado por palavra-chave

Data: 19/11/2026 · pedido do Bruno · aprovado na conversa antes deste texto.

## Problema

A IA do Atendimento roda em sombra desde 09/11: lê cada turno, grava o que faria
(`support_ai_runs`) e nada vai ao cliente. O prompt já foi calibrado com a
análise de 50 conversas reais (18/11, `docs/atendimento-agente-operacao.md`).
Falta ver o agente **conversando de verdade**, na produção, com o número do
escritório: se ele pergunta o que deve, responde pela base, encaminha ao clã
certo e para quando uma pessoa assume.

O Bruno vai testar escrevendo do número da Shift para o WhatsApp do escritório,
como se fosse cliente. Nenhum cliente real pode ser atendido pela IA nesta fase.

## Decisão

Uma **rodada de teste** por conversa, aberta por uma palavra-chave no começo da
mensagem do cliente (por exemplo "batata"). Só a conversa com rodada aberta
recebe resposta da IA; todas as outras continuam em sombra, exatamente como hoje.

- O interruptor e a palavra ficam em **Atendimento → Configurações**, só para
  admin/owner, gravados no banco (`support_agent_settings`). Liga e desliga na
  hora, sem reimplantar: é o freio de emergência.
- **Só na produção**, sem variável nova: cada ambiente tem o seu banco, o
  interruptor nasce desligado, e só a produção tem o WhatsApp do escritório
  conectado. A homologação nunca responde ninguém.
- Caminho escolhido: **ampliar a leitura em sombra** (`runSupportTriageCycle`).
  A mesma leitura que hoje só grava passa a agir quando a conversa está em
  rodada de teste. Sombra e teste usam o mesmo prompt, a mesma base e o mesmo
  registro, então o que se testa é o que a sombra mede. Fluxo separado
  duplicaria a busca e a chamada à IA; copiar o `pipeline.ts` do Scharff traria
  1.500 linhas presas ao Telegram. Do Scharff vêm as **regras** de decisão.
- O encaminhamento vai **até o clã** (pedido do Bruno). Atribuir à pessoa da
  Carteira e avisar no WhatsApp ficam para depois.

## Rodada de teste

- A mensagem do cliente (texto, `cloud_api`) cujo **primeiro termo** é a
  palavra-chave abre a rodada. A comparação ignora maiúscula, acento e
  pontuação colada: "batata", "Batata, preciso da guia", "BATATA!" abrem;
  "quero batata" não abre.
- Abrir a rodada, na mesma transação que grava a mensagem:
  `status = 'ai_active'`, `ai_test_started_at = occurred_at` da mensagem,
  `ai_paused_at`/`ai_pause_reason`, `assigned_user_id` e `assigned_clan_id`
  zerados, evento `ai_resumed` com `detail.reason = 'test_keyword'`.
- Mandar a palavra de novo **reinicia** a rodada, mesmo com a conversa já
  encaminhada ou assumida. É o que deixa testar várias vezes seguidas.
- Com o interruptor desligado, a palavra é uma mensagem comum.
- A palavra é tirada do texto que vai à IA. Só a palavra equivale a mensagem
  sem assunto.
- Mensagens anteriores a `ai_test_started_at` entram no histórico da IA como
  ciclo **anterior**: uma rodada nova não herda o setor da antiga.

## O que o agente faz em cada turno

Mesma espera de silêncio da sombra (`SUPPORT_TRIAGE_DEBOUNCE_SECONDS`). A
decisão é uma função pura (`decideAgentTurn`), na ordem do Scharff:

1. **Sem assunto** (saudação ou só a palavra, `ehSaudacaoSemAssunto`) e o
   agente ainda não perguntou o assunto na rodada → cumprimenta e pergunta o
   assunto, sem chamar a IA. Já perguntou → espera, não repete.
2. **Resposta da base** (`respostaDireta`, só existe com fonte aprovada
   citada) → envia a resposta; se a IA também pediu uma informação, vai junto
   ("Só preciso confirmar: …"). A conversa continua com o agente.
3. **Pergunta** (`perguntaEsclarecimento`, teto de 3 na rodada pela guarda que
   já existe) → envia "Só preciso confirmar: …". Continua com o agente.
4. **Confiança baixa** e ainda não perguntou o assunto → pergunta o assunto.
5. **Encaminha** em qualquer outro caso: "Encaminhei ao setor Fiscal. Uma
   pessoa da equipe continua o atendimento por aqui." A conversa vai para o clã
   do setor (`clanForSector`), com o resumo da IA em `summary`, em
   `needs_human`, IA pausada com motivo `ai_handoff` e evento `assigned` de
   origem `guilda_ai`. Sem clã correspondente (ou setor "outro"), a conversa
   fica sem clã para quem distribui, e o texto diz "Encaminhei para a nossa
   equipe."
6. **Falha da IA** (`erro_api`, `sem_api_key`, `resposta_sem_tool_use`) ou
   **teto de leituras da rodada** (6) → encaminha sem clã. Nunca fica preso.

Todo turno vira uma linha em `support_ai_runs`, inclusive os que não chamam a
IA (casos 1 e 6): a linha continua sendo a trava contra ler a mesma mensagem
duas vezes, e o teto conta as linhas da rodada.

Cumprimento ("Bom dia!", pelo horário de Brasília) só na primeira fala do
agente na rodada. Sem nome do cliente: o design do Atendimento pede não repetir
nome, e o nome do perfil do WhatsApp é o que a pessoa escolheu, nem sempre real.

O prompt ganha um cabeçalho de conversa: no teste, `resposta_direta` e
`pergunta_esclarecimento` vão direto ao cliente, e o aviso de encaminhamento é
do sistema. O resto do prompt (setores, limites, jeito do escritório, base) é o
mesmo da sombra. `TRIAGE_PROMPT_VERSION` sobe, e a leitura registra se foi
sombra ou conversa e o que o agente fez.

## Gravação e envio

- A decisão é gravada numa transação só, com a conversa travada (`FOR UPDATE`):
  mensagem (`actor = 'ai'`, `source = 'guilda_ai'`), evento `queued`, linha em
  `support_outbox` com `payload.agentRound = ai_test_started_at`, e, no
  encaminhamento, o estado novo da conversa.
- Antes de gravar, confere de novo: interruptor ligado, conversa ainda em
  `ai_active` na mesma rodada e nenhuma mensagem do cliente depois da que
  disparou a leitura. Se algo mudou, a resposta é descartada (fica no registro
  da leitura como descartada) e o próximo ciclo trata o turno novo.
- O worker de saída mantém a trava atual para qualquer mensagem da IA e só abre
  uma exceção: `payload.agentRound` igual ao `ai_test_started_at` da conversa,
  interruptor ligado e conversa fora de `human_active`. Qualquer outra mensagem
  da IA falha na hora, sem chamar a Meta. Desligar o interruptor segura até o
  que já estava na fila.
- A janela de 24 horas não é problema: o agente só fala logo depois do cliente.

## Pessoa sempre vence

Assumir, transferir ou responder pelo celular já pausam a IA (`human_active`).
Com isso a leitura não grava resposta (a conversa saiu de `ai_active`) e o
worker recusa o que estava na fila (`human_active`). Para a IA voltar, só uma
rodada nova pela palavra-chave.

## Tela

- **Configurações** (admin/owner): cartão "Teste do agente" com interruptor,
  palavra-chave (uma palavra, 3 a 40 letras ou números) e o aviso do que ele
  faz. Mostra quando a IA está desligada no servidor (`SUPPORT_AI_MODE` vazio ou
  sem chave), porque aí o teste não responde.
- **Caixa de entrada**: conversa em rodada aberta mostra o selo "Teste do
  agente" na fila e no cabeçalho. As falas da IA já aparecem com autor "IA", e a
  "Leitura da IA" continua mostrando setor, confiança e fontes de cada turno.

## Banco

- `support_agent_settings (org_id PK, test_enabled, test_keyword, updated_by,
  updated_at)`, com RLS `org_isolation`, check de que ligado exige palavra, e
  `guilda_app` sem DELETE (REVOKE, porque os default privileges dão tudo).
- `support_conversations.ai_test_started_at timestamptz` (nulo fora de teste).
- `npm run check:rls` cobre a tabela nova.

## Testes

- Puros: casamento da palavra-chave e retirada do texto; `decideAgentTurn` em
  cada caminho (sem assunto, já perguntou, resposta, resposta com pergunta,
  pergunta, confiança baixa, encaminha com e sem clã, falha da IA, teto);
  cabeçalho do prompt por modo.
- Banco (PGlite como `guilda_app`): a palavra abre e reinicia a rodada;
  interruptor desligado não abre; cada decisão grava mensagem, evento e fila;
  encaminhamento põe a conversa no clã; resposta descartada quando uma pessoa
  assume ou o cliente escreve de novo; conversa sem rodada continua em sombra
  sem nada na fila; worker recusa mensagem da IA fora da rodada, com o
  interruptor desligado ou em `human_active`, e envia a da rodada.

## Fora desta versão

- Aviso de privacidade com aceite do cliente (transferência internacional),
  como no Scharff: obrigatório antes de abrir para cliente real.
- Atribuir à pessoa da Carteira; avisar quem recebe no WhatsApp ou Telegram.
- Áudio e imagem na leitura (continuam só como rótulo, como na sombra).
- Atraso de "digitando…" antes da resposta.

## Como testar na produção

1. Deploy com a migração.
2. Admin liga o "Teste do agente" com a palavra escolhida.
3. Do número da Shift, mandar "batata" e seguir como cliente.
4. Acompanhar em `/atendimento`: falas da IA, leitura de cada turno e o clã no
   encaminhamento. Para repetir, mandar a palavra de novo.
