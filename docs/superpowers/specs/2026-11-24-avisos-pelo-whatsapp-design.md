# Avisos e missões pelo WhatsApp (sai o Telegram)

Data: 2026-11-24 · Pedido do Bruno: "migrar tudo que estava sendo enviado para o
Telegram, os avisos, criação de missão... tudo para o WhatsApp, e tirar do
Telegram. Mandar um aviso quando é gerada uma nova missão, poder criar missão por lá."

Decisões do Bruno nesta conversa:

- Criar missão pelo WhatsApp **igual ao Telegram**: a IA lê, mostra a prévia,
  cria ao confirmar; só líder de clã, admin e dono; a missão nasce de um Informativo.
- Fora da janela de 24 horas, **modelos Utility aprovados pela Meta**.
- **Troca de uma vez**: a mesma publicação liga o WhatsApp e tira o Telegram.
- **Confirmar o número** com um código antes de receber aviso ou criar missão.

## 1. Número confirmado

Hoje o número do Perfil é digitado sem prova. Com missão criada por mensagem, ele
vira identidade: quem digitasse o número de outra pessoa criaria missão em nome
dela. E quem digita o número de um cliente já faz as mensagens desse cliente
sumirem do Atendimento.

- `member_whatsapp_connections` ganha `verified_at`, `verification_code_hash` e
  `verification_expires_at`. Trocar o número (fora a variação do nono dígito) zera
  a confirmação.
- No Perfil, **"Confirmar pelo WhatsApp"** gera um código de 6 caracteres (alfabeto
  sem 0/O/1/I, `crypto.randomInt`), guardado só como hash, válido por 30 minutos.
  O botão abre `https://wa.me/<número do escritório>?text=GUILDA%20<código>`; no
  computador a tela mostra o código e o número.
- A mensagem que chega com `GUILDA <código>` de um número cadastrado e ainda não
  confirmado é conferida: certo e no prazo, confirma e responde "Número
  confirmado"; errado ou vencido, responde como gerar outro. Ela nunca vira
  conversa do Atendimento.
- **Só número confirmado** recebe aviso (inclusive os que já existiam: novo
  cliente e conversa encaminhada) e manda comando. Mensagem de número cadastrado
  sem confirmação volta a ser tratada como de cliente.
- Quem já tinha número cadastrado confirma uma vez.

## 2. Avisos

### Quem recebe o quê

Os mesmos avisos do Telegram, para as mesmas pessoas, com duas mudanças:

1. **Missão de Informativo avisa quem a recebe.** Hoje não avisa (o Mural cobria),
   e é justamente a missão criada por mensagem. Na confirmação, cada pessoa que
   recebeu missão (fora quem pediu) ganha **um** aviso: o da missão, se for uma;
   "N missões novas", se forem várias. Missão de Informativo só para o clã, sem
   pessoa, continua sem aviso próprio.
2. **Missão que a pessoa cria para si mesma não avisa** a própria pessoa.

A lista: missão atribuída, missão nova do clã, início/retomada (para quem
pediu), entrega para aprovação, aprovada/concluída com XP, devolvida, cancelada,
transferida (entrada e saída), fechamento mudou de situação, fechamento anual com
XP, aviso do Mural com ciência, novo Fluxo no Societário, prazo do dia, fechamentos
pendentes e resumo diário.

### Preferências

O cartão do WhatsApp no Perfil recebe as preferências do Telegram: missões,
aprovações, prazos, XP, fechamentos, campanhas, Mural, resumo diário (com horário),
fuso e horário de silêncio. Nova tabela `member_notification_preferences`, com a
cópia do que cada um tinha no Telegram. Quem não tinha preferência salva começa com
**fechamentos desligado**: no WhatsApp cada mudança de fechamento iria a toda a
Guilda, e fora da janela cada aviso custa.

O horário de silêncio adia o aviso (não o descarta). Ele vale para os avisos novos;
o aviso de novo cliente e o de conversa encaminhada seguem como estão.

### Como sai

- **Dentro da janela de 24 horas** (a pessoa escreveu ao escritório no último dia):
  texto com o link. Quando há ação, mensagem com botão de resposta: **Iniciar missão**
  (missão atribuída), **Aprovar** (entrega para aprovação), **Retomar** (devolvida).
- **Fora da janela**: modelo Utility. Seis modelos novos, além do `guilda_novo_cliente`:

| Modelo | Uso | Botões |
|---|---|---|
| `guilda_nova_missao` | missão atribuída, do clã, de Informativo | Abrir na Guilda |
| `guilda_aprovacao` | entrega para aprovação | Aprovar · Abrir na Guilda |
| `guilda_missao_atualizada` | início, conclusão, devolução, cancelamento, transferência | Abrir na Guilda |
| `guilda_prazo` | vence hoje / atrasada | Abrir na Guilda |
| `guilda_resumo` | resumo diário | Abrir na Guilda |
| `guilda_aviso` | Mural, fechamentos, Fluxo, fechamento anual | Abrir na Guilda |

- O botão de link é `https://<app>/{{1}}` com o caminho como variável, para servir
  missão, lista, Mural e fechamentos com o mesmo modelo. Texto das variáveis sem
  quebra de linha e curto; o corpo nunca termina em variável (a Meta recusa).
- O admin prepara todos com **um botão** no Perfil, que cria os que faltam e
  atualiza a situação dos que existem (tabela `member_whatsapp_templates`, por
  chave; o registro do `guilda_novo_cliente` é copiado da tabela antiga). O
  worker também reconsulta, no máximo a cada 15 minutos, um modelo que precisa e
  ainda não está aprovado: aprovado na Meta, passa a sair sem ninguém clicar.
- Modelo não aprovado e janela fechada: o aviso não sai e fica registrado como tal.

A fila é a `member_whatsapp_outbox` de sempre, com um terceiro tipo de payload
(`version: 3`, `kind: "notice"`). O check de origem passa a aceitar aviso sem Fluxo
e sem conversa (`num_nonnulls <= 1`). Adiar pelo silêncio usa uma função nova
`defer_member_whatsapp_outbox`, porque o `guilda_app` não atualiza a fila.

Os lembretes do dia (prazo, fechamentos pendentes, resumo) rodam no
`support-worker`, uma vez por minuto, com a mesma chave diária de hoje.

## 3. Criar missão e usar os botões

Mensagem de número confirmado nunca vira Atendimento. Ela vai para
`member_whatsapp_commands` (única por `wamid`: a Meta reenvia e não pode sair prévia
em dobro) e um ciclo novo do `support-worker` responde:

- **Texto de líder, admin ou dono**: "Analisando…", a prévia (a mesma do
  Telegram) e uma mensagem com **[Criar N missões] [Cancelar]**. O Informativo nasce
  com `source = 'whatsapp'` e guarda a conexão (`whatsapp_connection_id`): só a
  mesma pessoa, pelo mesmo número, confirma.
- **Texto dos demais**: explica que missão por mensagem é com líder, admin ou dono,
  e dá o link do formulário.
- **Botão** (resposta de mensagem ou de modelo): Iniciar e Retomar passam por
  `transitionTaskForActor` (`pending|rejected → in_progress`); Aprovar
  (`awaiting_approval → completed`, com XP). As mesmas regras da tela; o botão
  repetido esbarra no estado e responde que a missão já mudou.
- **Áudio, foto, documento**: por enquanto responde que lê só texto. Transcrever
  áudio, como no Atendimento, é o próximo passo.

As respostas saem pela mesma fila (chave pelo `wamid`), dentro da janela que a
própria mensagem abriu. A prévia e a decisão gravam junto com a marcação do comando
como lido: se o processo cair no meio, a IA roda de novo, mas não sai prévia dupla.

## 4. Telegram sai

- Saem `src/lib/telegram/`, `scripts/telegram-worker.ts`, a rota
  `/api/telegram/webhook`, o cartão do Perfil e as variáveis `TELEGRAM_*` dos
  exemplos e da documentação. O que era reaproveitado muda de casa: links e rótulos
  de prazo (`src/lib/notices/`), a detecção de informativo detalhado
  (`src/lib/informatives/`).
- **As tabelas do Telegram ficam no banco**, sem uso. Apagar é migração destrutiva
  e fica para depois, com o OK do Bruno. O bot no BotFather também é com ele.
- A rota `/closings` continua como redirecionamento (mensagens antigas apontam
  para ela).

## Riscos

- **Todos precisam confirmar o número no dia da publicação**; quem não confirmar fica
  sem aviso.
- **Modelos dependem da Meta.** O botão só existe depois da publicação; a aprovação
  costuma levar de minutos a horas, e até lá o aviso fora da janela não sai. A Meta
  pode classificar um modelo como Marketing (mais caro) ou recusá-lo; o Perfil
  mostra a situação.
- **Custo**: dentro da janela é grátis; fora, cada modelo custa poucos centavos.
- **Coexistência**: cada integrante vira uma conversa no celular do escritório.

## Testes

- Puros: geração e conferência do código, texto e parâmetros de cada modelo (sem
  quebra de linha, sem variável no fim), leitura de botão e texto vindos da Meta,
  escolha entre texto, botão e modelo.
- Banco (PGlite): confirmação do número; aviso só para confirmado e com preferência
  ligada; missão de Informativo avisa uma vez por pessoa; comando repetido pelo mesmo
  `wamid` não duplica; botão Aprovar credita XP uma vez; mensagem de número não
  confirmado vira Atendimento.
- Worker com `fetch` falso: janela aberta manda texto/botão; fechada manda o modelo
  com os parâmetros; modelo pendente não envia; silêncio adia.

## Adendo (2026-11-24, mesmo dia): todos pedem missão, por texto, áudio, foto ou PDF

Depois de ver o desenho, o Bruno pediu: "todos devem poder criar missões pelo WhatsApp,
vamos habilitar para entender áudios e imagens também". O que mudou:

- **Dois caminhos, a mesma IA.** Líder de clã, admin e dono continuam pelo Informativo
  (pode criar empresa, Fluxo, fechamento e aviso no Mural). Os demais pedem **missão
  avulsa**, com a régua do formulário de missão: pessoa da organização (o clã sai dos
  vínculos dela) ou clã ativo, empresa só se já cadastrada. Por esse caminho nada cria
  empresa, Fluxo ou fechamento: isso continua sendo do Informativo.
- **Prévia própria** (`member_mission_drafts`, migração 0113): até 10 missões por
  mensagem, botões **Criar** e **Cancelar**, 30 minutos, só o mesmo número confirma, tudo
  ou nada (se a pessoa saiu da Guilda ou o clã fechou no meio, nada é criado).
- **Arquivo vira texto antes da IA**: áudio pela transcrição da OpenAI (a mesma do
  Atendimento), foto e PDF (3 primeiras páginas) pela Anthropic. A prévia começa com
  "Entendi assim: «…»", para a pessoa conferir o que foi entendido. O arquivo não fica
  guardado. Vídeo e outros formatos recebem a explicação do que se lê.
- **Privacidade**: o áudio da equipe vai à OpenAI e a foto/PDF à Anthropic, como já
  acontece com o texto do Informativo. É conteúdo interno do escritório.

## Adendo 2 (2026-11-24): pedido pelo WhatsApp é missão avulsa, inclusive do líder

No primeiro teste que deu certo, o Bruno (dono) pediu "comprar um chopp para o Bruno" para o
Rafa e a Guilda criou missão de Informativo, com aviso "Missões geradas" no Mural para todos.
Correção dele: "isso é só uma missão avulsa pro Rafa". Agora todo pedido vira missão avulsa;
só segue pelo Informativo, e só para líder, admin e dono, o que precisa dele: empresa nova,
alteração ou baixa, aviso para o Mural, distribuição de lucros e fechamento (`needsInformative`).
