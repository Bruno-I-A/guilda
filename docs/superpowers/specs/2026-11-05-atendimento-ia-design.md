# Atendimento com IA — caixa de entrada nativa da Guilda

Data: 2026-11-05 · Pedido do Bruno · Desenho inicial para validação antes da implementação.

## Problema

O escritório atende empresas-cliente por mensagem, mas a Guilda conhece apenas
o trabalho interno. A conversa, a empresa, o setor responsável e as missões
ficam separados. O agente precisa responder o que é seguro, reconhecer quando
não sabe e entregar a conversa para a pessoa certa com o contexto preservado.

O objetivo não é colocar um chatbot genérico ao lado da Guilda. É transformar
uma mensagem do cliente em trabalho rastreável dentro dela.

## Pesquisa de referência

Há produtos suficientes para reaproveitar padrões de produto, mas nenhum é um
encaixe direto na Guilda:

- **Chatwoot** é a referência madura de caixa de entrada compartilhada:
  conversas multicanal, atribuição, notas internas, etiquetas, respostas
  prontas, horários, automações e relatórios. É MIT, mas usa Rails + Vue e seria
  um segundo sistema para autenticar, operar e integrar.
- **Owly** é a referência técnica mais próxima: Next.js, TypeScript, Postgres,
  caixa de entrada, tomada humana, base de conhecimento, roteamento e API. É
  MIT, mas usa Prisma, não tem multi-tenant/RLS pronto e lista RBAC e
  multi-tenancy como itens futuros. Serve como fonte de padrões e casos de
  teste, não como código para colar inteiro.
- **OneChat** e **Fiscalia** provam o recorte contábil: WhatsApp centralizado,
  IA para dúvidas comuns, roteamento, handoff, histórico, base de conhecimento
  e métricas. O OneChat ainda aproxima atendimento de emissão, guias e situação
  fiscal — justamente onde a Guilda já tem contexto próprio.
- A Meta mantém exemplos oficiais de Cloud API, webhooks, mídia, templates e
  validação de assinatura. Esse é o transporte de referência. Integração por QR
  baseada em WhatsApp Web não entra no caminho principal.

Fontes consultadas:

- https://github.com/chatwoot/chatwoot
- https://github.com/Hesper-Labs/owly
- https://apponechat.com/
- https://fiscalia.ia.br/
- https://github.com/fbsamples/whatsapp-api-examples
- https://github.com/meta/openapi

## Reaproveitamento de código verificado

Em 05/11/2026, os dois repositórios mais compatíveis foram clonados e lidos nas
revisões abaixo:

- Owly: `430c646e51aea8367d1e1a88953e9b56d059fa8d`;
- exemplo Tech Provider da Meta:
  `14703a3e1fdba9bcf75b2360b00817b6fcc9f79b`.

Ambos usam licença MIT. Código trazido para a Guilda deve manter o aviso de
copyright/licença nos arquivos copiados ou em `THIRD_PARTY_NOTICES.md` quando
for uma adaptação substancial.

| Fonte | Podemos portar | Não portar como está |
| --- | --- | --- |
| Meta | verificação do webhook, HMAC com comparação constante, tipos de payload, envio pela Cloud API, onboarding/Embedded Signup e casos de teste | Auth0, Vercel Postgres, Ably, publicação do payload bruto e inbox em memória |
| Owly | estrutura de conversa, notas internas, transferência, paginação, respostas prontas, CRUD/teste da base de conhecimento e componentes pequenos do chat | Prisma, schema sem `org_id`, autenticação própria, chave de IA guardada no banco e queries sem RLS |
| Chatwoot | estados, filtros, atribuição, etiquetas, atalhos e padrões de operação | aplicação Rails/Vue inteira ou um segundo login ao lado da Guilda |

O módulo `src/lib/channels/whatsapp.ts` do Owly usa `whatsapp-web.js`, QR e
Puppeteer. Ele não entra na Guilda. O transporte vem do exemplo oficial da
Meta e fala somente com a Cloud API.

O motor de IA do Owly também não entra inteiro. A leitura encontrou quatro
diferenças incompatíveis com as regras já aprendidas no atendimento da Shift:

- envia até 50 mensagens e toda a base ao modelo, aumentando custo e exposição;
- permite resposta por conhecimento geral quando a base está vazia;
- usa palavras-chave em inglês como guardrail;
- deixa a chave do provedor em `settings` no banco.

Na Guilda, contexto é limitado e mascarado, resposta exige fonte aprovada,
guardrails cobrem português e domínio contábil e segredos ficam no ambiente.

O código será portado por fatias, não por fork: primeiro webhook/adaptador;
depois tabelas e consultas com Drizzle/RLS; em seguida caixa de entrada e base;
por último o agente. Cada fatia recebe testes da Guilda antes de a próxima
entrar.

## Decisão

Construir o atendimento **dentro da Guilda**, aproveitando a autenticação,
organizações, pessoas, clãs, clientes, missões e RLS existentes. Não subir
Chatwoot ou Owly como aplicação paralela.

Os atendentes usam o próprio login da Guilda (`better-auth`) e as relações de
membro/clã existentes. Não haverá cadastro, senha, sessão ou diretório de
atendentes separado para o módulo de atendimento. Admins enxergam todas as
filas; membros enxergam as filas dos clãs em que trabalham.

Reaproveitamento permitido:

- copiar padrões de interação e arquitetura dos projetos MIT;
- portar trechos pequenos só quando forem melhores que a implementação local,
  mantendo o aviso de licença quando necessário;
- não copiar interface, textos ou código proprietário de OneChat/Fiscalia.

O primeiro canal é **WhatsApp pela Cloud API oficial da Meta**. O transporte
fica atrás de um adaptador para Instagram, e-mail ou outro canal entrarem sem
alterar o domínio de conversas.

O número será conectado pela própria Guilda usando Embedded Signup com o fluxo
`whatsapp_business_app_onboarding`. A operação será em **coexistência**: o
WhatsApp Business continua disponível no celular e a Guilda recebe/envia pelo
mesmo número. Uma mensagem enviada por uma pessoa no celular aparece na Guilda
como saída humana e pausa a IA antes da próxima resposta.

O onboarding vive em **Configurações → Atendimento**, disponível somente a
owner/admin. Ele usa o app da Guilda no Meta Developer, não Auth0, Vercel,
Ably ou o login do exemplo da Meta.

## O diferencial da Guilda

Uma caixa de entrada comum sabe quem escreveu e o histórico da conversa. A
Guilda também sabe qual empresa é, regime tributário, clã responsável, missões
abertas e operação fiscal. A tela deve usar isso para a equipe, sem entregar o
conteúdo interno bruto à IA nem ao cliente.

Na v1, a IA pode:

1. responder dúvidas gerais sustentadas pela base aprovada;
2. identificar assunto, urgência e clã provável;
3. reunir mensagens próximas em um único turno;
4. pedir no máximo uma informação útil por vez;
5. abrir o handoff com resumo, intenção e dados já conhecidos;
6. sugerir a criação de uma missão a partir da conversa.

Na v1, a IA **não pode**:

- prestar interpretação contábil, fiscal ou jurídica;
- afirmar situação específica de uma empresa lendo tabelas internas;
- emitir guia, nota, certidão ou documento;
- mudar missão, cadastro ou dado fiscal;
- prometer prazo ou retorno que o sistema não confirmou;
- continuar respondendo depois que uma pessoa assumir.

Consultas específicas entram depois por ferramentas pequenas e explícitas que
devolvem somente dados marcados como publicáveis. Nunca se dá ao modelo acesso
genérico às tabelas da Guilda.

## Primeira versão

### 1. Caixa de entrada em `/atendimento`

No computador, três regiões:

- **Fila**: conversa, empresa, setor, tempo sem resposta e estado;
- **Conversa**: histórico, notas internas, compositor e origem de cada fala;
- **Contexto**: vínculo com empresa-cliente, clã, responsável e missões abertas,
  com ação para criar missão já preenchida com o resumo.

Em telas menores, as regiões viram passos (fila → conversa → contexto), sem
encolher três colunas. A rota usa `PageHeader`; a navegação entre Caixa de
entrada, Base e Métricas usa `SegmentedNav`.

Estados operacionais:

- **IA atendendo**;
- **Precisa de pessoa**;
- **Em atendimento**;
- **Aguardando cliente**;
- **Resolvida**.

Assumir é uma transição atômica: pausa a IA antes de liberar o compositor
humano. Encerrar e reabrir ficam no histórico. Não existe IA e pessoa enviando
ao mesmo tempo.

Na coexistência, uma resposta enviada pelo WhatsApp Business do celular vale
como tomada humana automática. O webhook/eco da Meta precisa registrar a
mensagem, identificar o ator como "celular" quando a Meta não informar uma
pessoa da Guilda e mudar a conversa para **Em atendimento** antes de qualquer
novo processamento da IA.

### 2. Base em `/atendimento/base`

Começa com conteúdo estruturado e revisável, não com uma pasta opaca de PDFs:

- pergunta ou assunto;
- resposta aprovada;
- clã/tema;
- vigência;
- estado rascunho, aprovado ou arquivado;
- autoria e aprovação;
- teste com uma pergunta antes de publicar.

Busca textual no Postgres é suficiente para o piloto. Embeddings só entram se
os casos reais provarem que sinônimos e formulações estão escapando; isso evita
adicionar um segundo provedor e uma extensão de banco antes de medir a lacuna.

Toda resposta automática guarda quais itens da base a sustentaram. Sem fonte
adequada, o agente encaminha; não improvisa.

### 3. Métricas em `/atendimento/metricas`

Entram depois do fluxo operacional, usando eventos já registrados:

- novas, aguardando pessoa e atrasadas;
- tempo até primeira resposta humana;
- resolvidas pela IA × assumidas;
- handoff por motivo e por clã;
- perguntas sem cobertura na base;
- custo por conversa e por modelo.

## Modelo de dados proposto

Toda tabela de domínio tem `org_id`, FK composta quando aponta para cliente e
RLS por `app.org_id`. A aplicação continua conectando como `guilda_app`; migration
usa o papel dono já existente. Não se cria outro banco nem outro Postgres.

- **`support_contacts`** — pessoa que escreve, identificador do canal, nome,
  telefone normalizado, `client_id` opcional e confirmação manual do vínculo.
  Uma empresa pode ter vários contatos.
- **`support_conversations`** — canal, contato, estado, clã e pessoa atribuídos,
  resumo operacional, último turno e datas de fila/assunção/resolução.
- **`support_messages`** — corpo imutável, direção, autor, tipo de mídia,
  identificador externo e data. Só `SELECT`/`INSERT` para `guilda_app`.
- **`support_message_events`** — entregue, lida ou falhou; append-only. Evita
  alterar o corpo da mensagem para atualizar recibo.
- **`support_conversation_events`** — roteou, assumiu, transferiu, resolveu,
  reabriu; append-only e com ator.
- **`support_inbound_events`** — webhook bruto minimizado, identificador externo
  único, hash e estado de processamento. Garante idempotência e resposta rápida
  à Meta.
- **`support_outbox`** — mensagem pronta para transporte, tentativas, lease e
  próximo envio. A chamada externa não fica dentro da transação de domínio.
- **`support_knowledge_entries`** — conteúdo aprovado, tema, clã, vigência,
  versão, autoria e aprovação.
- **`support_contact_memory`** — fatos úteis, resumo curto e última resposta da
  IA. Não substitui o histórico visível à equipe.
- **`support_ai_runs`** — modelo, tokens, custo estimado, latência, decisão,
  fontes e motivo de handoff; nunca prompt completo nem segredo.

Antes de gerar migration, conferir a branch (`develop`) e validar o catálogo do
Postgres depois de `db:migrate`; o projeto já teve geração e aplicação que
reportaram sucesso sem produzir o efeito esperado.

## Transporte e processamento

```text
Meta webhook
  → valida assinatura e deduplica
  → grava evento e responde 200
  → worker reúne mensagens próximas em um turno
  → vincula contato/empresa e recupera base aprovada
  → IA responde OU pede handoff
  → grava mensagem/outbox na mesma transação
  → adaptador envia pela Cloud API
  → webhooks de status viram eventos de entrega/leitura
```

O adaptador expõe receber, enviar texto, enviar mídia e marcar suporte a
templates. A regra de 24 horas e templates fica no adaptador do WhatsApp, não
espalhada pela interface.

O worker roda como serviço separado usando a mesma imagem da Guilda, como os
outros processos duráveis do projeto. O app web não espera uma resposta da IA
antes de confirmar o webhook.

## App da Guilda na Meta

Para a coexistência acontecer através do próprio aplicativo, a Guilda terá um
app no Meta Developer com o caso de uso **Connect through WhatsApp** e uma
empresa verificada vinculada. O caminho de produção exige:

- Facebook Login for Business com domínio e retorno da Guilda;
- configuração Tech Provider usada pelo Embedded Signup;
- App Review, no mínimo para `whatsapp_business_management` e
  `whatsapp_business_messaging`;
- app publicado (fora do modo Development);
- callback de webhook, verify token e assinatura HMAC;
- política de privacidade e contato de suporte publicados;
- assinatura da WABA nos webhooks necessários ao fluxo de mensagens e aos
  ecos do WhatsApp Business App.

`FB_APP_SECRET`, verify token e chave usada para proteger credenciais ficam
somente no ambiente. Identificadores da WABA/número podem ficar no banco;
tokens duráveis entram cifrados seguindo o padrão de segredos já usado na
Guilda, nunca em texto puro nem em log.

## Comportamento do agente

Aplicar o que já foi aprendido no agente da Shift:

- responder a dúvida antes de qualificar;
- falar curto, simples e natural;
- no máximo uma pergunta por vez;
- não recitar memória nem repetir nome a cada turno;
- juntar mensagens enviadas em sequência;
- usar a base para entregar valor, não só perguntar e confirmar;
- não confundir agradecimento com aceite de handoff;
- pedido direto de pessoa sempre vence;
- baixa confiança, assunto crítico ou fora da base gera handoff.

Dados pessoais comuns são mascarados antes da chamada ao modelo. O recorte de
contexto é limitado; logs de IA guardam metadados, não o conteúdo. O histórico
necessário ao atendimento humano continua no banco conforme a política de
retenção a ser aprovada.

## Segurança e limites

- Webhook verifica token de desafio e assinatura do payload.
- Identificador externo tem unicidade por organização e canal.
- O número de destino é resolvido no servidor; o navegador não escolhe um
  telefone arbitrário.
- Vínculo contato → empresa exige confirmação quando houver ambiguidade.
- Pessoa só enxerga filas dos clãs que pode atender; admin enxerga tudo.
- Toda tomada, transferência, envio e alteração da base gera evento de auditoria.
- Mídias ficam fora do banco; a tabela guarda metadados e referência com prazo.
- Segredos do WhatsApp e do modelo ficam somente no ambiente e nunca no vault,
  banco de domínio ou log.

## Implantação progressiva

1. **Sombra** — recebe conversas reais e produz resposta/roteamento propostos,
   mas nada é enviado automaticamente.
2. **Assistido** — pessoa revisa e envia a sugestão; medir respostas ruins,
   handoffs e lacunas da base.
3. **Automático restrito** — só assuntos gerais com fonte aprovada e confiança
   suficiente. O restante vai para pessoa.
4. **Ferramentas específicas** — uma capacidade por vez, começando por leitura
   de informação marcada como publicável.

Não ligar resposta automática no primeiro deploy. O piloto precisa provar
idempotência, vínculo correto de empresa, handoff e isolamento entre
organizações antes de atender sem revisão.

## Fora da v1

Instagram, e-mail, voz, campanhas ativas, disparo em massa, cobrança, emissão
de documentos, leitura irrestrita da Guilda, editor visual de fluxos, SLA
complexo, tradução e automações genéricas.

## Pendências antes de codar

- o escritório usa hoje o WhatsApp Messenger comum. Primeiro migrar o mesmo
  número para o app WhatsApp Business, com backup e conferência do histórico;
  só depois iniciar o onboarding da API/Guilda;
- coexistência confirmada: o número continuará ativo no WhatsApp Business do
  celular e será conectado pela própria Guilda;
- preparar/verificar a empresa no Meta Business e criar o app Meta Developer da
  Guilda; App Review pode avançar em paralelo ao desenvolvimento local;
- confirmar quem atende hoje e como os setores se divididem;
- escolher a retenção do histórico e das mídias;
- reunir as primeiras respostas aprovadas da base do escritório;
- cadastrar no piloto contatos reais de poucas empresas, com vínculo revisado;
- definir quem pode aprovar conteúdo e ligar o modo automático.
