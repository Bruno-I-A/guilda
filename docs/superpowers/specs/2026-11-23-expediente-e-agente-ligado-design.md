# Agente ligado para todos e expediente do escritório

Data: 23/11/2026 · Pedido do Bruno · Desenho aprovado na conversa de 23/11/2026

## Objetivo

1. Um controle para ligar o agente de IA de verdade, para todo cliente que escrever, sem a palavra-chave do teste.
2. Cadastrar os dias e horários de expediente do escritório e os dias especiais: feriados e dias de meio período.
3. Fora do expediente, o agente avisa quando a equipe volta e faz a triagem igual.

## Decisões do Bruno

- **Ligado = atende todos os clientes**, sem palavra-chave. O teste por palavra-chave continua existindo.
- **Aviso de privacidade fica de fora desta entrega**, por conta do Bruno. O controle nasce desligado e ele só liga depois de resolver o aviso. A tela lembra disso ao ligar.
- **Aviso à equipe fora do expediente espera a abertura.** A conversa é atribuída na hora, mas o aviso no WhatsApp da pessoa sai quando o expediente abre.
- **Feriados:** a Guilda sugere os nacionais do ano e o Bruno marca os que o escritório fecha. Os municipais e os de meio período entram à mão.

## 1. Modo do agente

Uma chave de três posições substitui o interruptor do teste (`support_agent_settings.test_enabled`):

| Modo | O que acontece |
|---|---|
| **Desligado** (`off`) | Como hoje fora do teste. A IA só lê em sombra e nada vai ao cliente. |
| **Só teste** (`test`) | Como hoje: a rodada só abre com a palavra-chave no começo da mensagem. |
| **Todos os clientes** (`live`) | O agente atende toda conversa nova, sem palavra-chave (seção 2). |

- **Coluna:** `support_agent_settings.agent_mode` (enum `support_agent_mode`: `off`, `test`, `live`; padrão `off`). A migração copia o estado atual: `test_enabled = true` vira `test` e o resto vira `off`. Depois `test_enabled` sai.
- **Palavra-chave:** continua obrigatória em `test`. Em `live` é opcional e, se existir, ainda reinicia a rodada, para o Bruno testar com uma conversa que já está com a equipe.
- **Ligar `live`:** pede confirmação com o texto *"As mensagens, áudios e arquivos dos clientes vão para a Anthropic e a OpenAI. Ligue só com o aviso de privacidade resolvido."*
- **Desligar continua sendo o freio**, hoje em `saveAgentTestSettings`. Ir para `off` encerra as rodadas abertas (`ai_active` → `needs_human`). O worker de saída segura toda fala da IA.
- **De `live` para `test`:** as rodadas abertas terminam normalmente e só as conversas novas deixam de abrir rodada. Assim nenhuma fala em curso fica pela metade.
- **Trava de saída:** `agentDeliveryBlock` (`src/domain/support-agent.ts`) passa a receber `mode` no lugar de `testEnabled`. Bloqueia em `off`. Em `test` e `live` vale a mesma regra de rodada e de pessoa no comando.
- **Quem muda:** só admin ou owner, em Atendimento → Configurações (action com verificação de papel, como hoje).

## 2. Quando o agente entra (modo `live`)

- **Conversa nova abre rodada.** Em `materializeMessage` (`src/lib/whatsapp/inbound-worker.ts`), quando `findOrCreateConversation` devolve `created: true` para uma mensagem de cliente, abre a rodada como `startTestRound` faz: `status = ai_active`, início da rodada em `ai_test_started_at`.
  - Conversa nova é a primeira mensagem do número ou a primeira depois de a anterior ser resolvida.
  - O nome `ai_test_started_at` fica, por ser histórico. Ele passa a significar "início da rodada do agente", e um comentário no schema registra isso.
- **Conversa que já existe** (`needs_human`, `human_active`, `waiting_customer`) continua com a equipe. O agente não entra no meio.
- Pessoa assumiu, agente cala, como hoje (`agentDeliveryBlock` e as travas de `turn.ts`).
- **Fala:** as regras do teste (`src/lib/support/agent/decision.ts`). Pergunta o assunto uma vez, responde pela base aprovada, faz até 3 perguntas e encaminha pela régua de `routing.ts`.
- **Sombra:** a triagem em sombra continua nas conversas em que o agente não está.

## 3. Expediente

### Semana

- Cada dia da semana fica aberto ou fechado. Dia aberto tem **um ou dois períodos** (manhã e tarde), para cobrir o almoço. Horário de Brasília (`APP_TIME_ZONE`).
- **Tabela** `support_business_hours`: `org_id` (PK), `week` jsonb, `updated_by`, `updated_at`.
  - O `week` tem a forma `{ "1": [["08:00","12:00"],["13:30","18:00"]], ..., "7": [] }`, com dia ISO de 1 (segunda) a 7 (domingo).
- **Validação Zod:**
  - `HH:MM` de 00:00 a 23:59;
  - início antes do fim;
  - até 2 períodos por dia, sem sobreposição e em ordem.
- **Sem expediente cadastrado = sempre aberto.** Não há aviso de fora do expediente e o aviso à equipe sai na hora, como hoje.

### Dias especiais

- **Tabela** `support_special_days`: `id`, `org_id`, `day` (date), `name` (varchar 80), `periods` jsonb, `created_by`, `created_at`, com único `(org_id, day)`.
  - `periods` vazio significa fechado o dia todo.
  - Com períodos, o horário daquele dia substitui o da semana: meio período, ou expediente num sábado excepcional.
- **Feriados sugeridos:** `nationalHolidays(year)` calcula os do ano.
  - Fixos: 01/01, 21/04, 01/05, 07/09, 12/10, 02/11, 15/11, 20/11 e 25/12.
  - Móveis, pela Páscoa: Sexta-feira Santa; Carnaval (segunda e terça) e Corpus Christi, marcados como ponto facultativo.
  - O botão "Sugerir feriados de AAAA" mostra o ano corrente e o seguinte. A lista vem com os feriados marcados e os pontos facultativos desmarcados. Grava só os confirmados e pula datas já cadastradas.
- Um dia especial passado continua na tabela, mas a tela mostra só os de hoje em diante.

### Funções puras (`src/domain/business-hours.ts`)

- `isOpenAt(schedule, now)`: o dia especial, se existir, manda; senão vale a semana.
- `nextOpening(schedule, now)`: o próximo início de período depois de `now`, procurando até 400 dias. Devolve `null` se tudo estiver fechado.
- `nationalHolidays(year)`: lista `{ day, name, optional }`.
- `openingPhrase(opening, now)`: "hoje às 13h30", "amanhã às 8h" ou "segunda-feira, 24/11, às 8h".
  - Minuto zero vira "8h"; com minutos, "13h30".
  - Sem próxima abertura, devolve "no próximo expediente".

## 4. Fora do expediente

O agente lê o expediente no início de cada leitura do turno (`turn.ts`) e passa `{ open, nextOpening }` para `decision.ts`.

- **Primeira fala da rodada:** o cumprimento ganha o aviso. *"Boa noite! Estamos fora do horário de atendimento e a equipe retorna segunda-feira, 24/11, às 8h. Enquanto isso, já adianto seu atendimento."* Depois vem a pergunta do assunto, ou a resposta.
  - A frase é a mesma à noite, no almoço ("retorna hoje às 13h30"), antes de abrir e no fim de semana, por isso não diz "já encerrou".
- **Encaminhamento:** o texto de handoff ganha a volta da equipe. *"Encaminhei ao setor Fiscal. A equipe retorna segunda-feira, 24/11, às 8h e continua daqui."*
- **Triagem igual:** setor, clã, pessoa e resumo saem como no expediente, e a conversa fica atribuída na hora.
- **Aviso à equipe agendado:** `enqueueMemberSupportHandoffNotifications` recebe `scheduledFor`. Fora do expediente é a próxima abertura; dentro, `now`. O worker de avisos já respeita `member_whatsapp_outbox.scheduled_for`.
  - **Risco aceito:** a regra das 24 horas da Meta é conferida na hora do envio. Se a pessoa não falou com o WhatsApp do escritório nas 24 horas antes da abertura, o aviso não sai, como já acontece hoje. A conversa continua na fila dela na Guilda.
- O expediente vale também no modo `test`, para o Bruno ver o aviso de noite.

## 5. Tela (Atendimento → Configurações)

- **Cartão "Agente de IA"** (substitui o do teste):
  - controle segmentado **Desligado · Só teste · Todos os clientes**;
  - o campo da palavra-chave aparece em "Só teste" e, opcional, em "Todos";
  - a confirmação ao ligar "Todos" traz o texto da seção 1;
  - mantém o aviso de que a IA precisa estar configurada no servidor (`aiReady`).
- **Cartão "Expediente":**
  - uma linha por dia (Seg a Dom) com "Aberto/Fechado" e os horários (`<input type="time">`), mais "+ período" até dois;
  - no topo, a situação no momento: "Agora: aberto até 18h" ou "Agora: fechado · abre segunda-feira, 24/11, às 8h";
  - salvar grava a semana inteira.
- **Cartão "Dias especiais":**
  - lista dos próximos dias com data, nome e "Fechado" ou os horários, e botão de remover;
  - "+ Dia especial" pede data, nome e "Fechado o dia todo" ou "Horário próprio";
  - "Sugerir feriados" abre a lista para marcar.
- A tela é usada no celular: cada linha da semana quebra os horários embaixo do dia em tela estreita. A tela tem de ser medida renderizada em 375 e 1280 px antes de subir.

## 6. Segurança e dados

- As tabelas novas têm `org_id`, RLS com `current_setting('app.org_id')` e entram no `npm run check:rls`.
- O `guilda_app` precisa de SELECT, INSERT, UPDATE e DELETE nas duas: são configuração editável, não trilha.
- Server Actions com Zod, sessão e papel admin ou owner. O navegador nunca escolhe o modo de outra organização.
- Mudança do modo registra quem mudou (`updated_by`, `updated_at`), como hoje.

## 7. Testes

- **`business-hours.test.ts`:**
  - aberto e fechado no almoço;
  - fim de semana;
  - feriado fechado;
  - meio período (dia especial com período próprio);
  - sábado excepcional;
  - `nextOpening` atravessando fim de semana com feriado na segunda;
  - semana toda fechada (`null`);
  - frases "hoje", "amanhã" e dia da semana;
  - Páscoa de 2025, 2026 e 2027 (20/04, 05/04 e 28/03) e os móveis derivados.
- **`decision.test.ts`:** a primeira fala fora do expediente leva o aviso e a frase da abertura, e o handoff fora do expediente leva a volta da equipe. Dentro do expediente o texto não muda.
- **`agent.db.test.ts`:**
  - em `live`, conversa nova abre rodada e conversa existente não;
  - em `test`, só com palavra-chave;
  - `off` segura a fala;
  - o aviso à equipe fora do expediente fica com `scheduled_for` na abertura;
  - a migração copia `test_enabled`.
- **Validação Zod da semana:** sobreposição, fim antes do início e três períodos.

## Fora desta entrega

- Aviso de privacidade (com ou sem aceite): por conta do Bruno, antes de ligar "Todos os clientes".
- Mostrar "fora do expediente" na fila do Atendimento.
- Horário diferente por clã.
- Feriados estaduais e municipais automáticos.
