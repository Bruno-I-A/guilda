# Números de WhatsApp e empresas

Data: 23/11/2026 · pedido do Bruno · aprovado na conversa antes deste texto.

## Problema

O encaminhamento pela Carteira (20/11) precisa saber de qual empresa é a
conversa. Hoje o número (`support_contacts`) aponta para **uma** empresa
(`client_id`), vinculada à mão na caixa de entrada. Na prática "é meio variado"
(Bruno): uma empresa tem vários números (às vezes três pessoas escrevem por
ela) e um empresário escreve pelo mesmo celular sobre duas ou três empresas.

## Decisão

1. **Número ↔ empresas, muitos para muitos**: tabela `support_contact_clients`
   (contato, empresa, quem vinculou, quando). Os vínculos que já existem em
   `support_contacts.client_id` são copiados para ela; a coluna antiga deixa de
   ser lida e escrita (fica no banco, sem migração destrutiva).
2. **A conversa tem a sua empresa**: `support_conversations.client_id`. Conversa
   nova de número com **uma** empresa já nasce com ela. Com várias, fica sem até
   alguém escolher (nesta entrega, o atendente; na próxima, a IA escolhe ou
   pergunta). É ela que a Carteira, a fila, o cabeçalho e as missões abertas usam.
3. **Cadastro pela conversa** (pedido do Bruno: usar o número que mandou a
   mensagem): o painel Contexto ganha "Empresas deste número", com a lista,
   "+ Adicionar empresa" (busca por nome ou CNPJ) e remover; e "Empresa desta
   conversa", para escolher entre as do número. Adicionar a primeira empresa já a
   marca na conversa. Remover a empresa da conversa deixa a única que sobrar, ou
   nenhuma.
4. **Nono dígito**: a mensagem que chega acha o contato pelo número com e sem o 9
   (`whatsAppPhoneVariants`), para o número cadastrado com o 9 não virar outro
   contato quando o WhatsApp mandar sem ele.
5. Quem pode: quem vê a conversa, como o vínculo de hoje. Cada mudança fica no
   histórico da conversa.

Excluir uma empresa leva os vínculos dela (cascata) e tira a empresa das
conversas (`SET NULL` só na coluna da empresa), sem travar a exclusão.

## Próximas entregas

- Ficha da empresa em Clientes: seção WhatsApp para cadastrar o número antes de
  o cliente escrever.
- IA: com o número em várias empresas, escolher a empresa pela mensagem ou pelo
  PDF (CNPJ, nome) e, sem certeza num assunto que depende da empresa, perguntar
  "De qual empresa: A, B ou C?".

## Testes

Banco: a cópia dos vínculos antigos; conversa nova com uma empresa já nasce com
ela; com duas, nasce sem; adicionar e remover empresa pelo Contexto; escolher a
empresa da conversa só entre as do número; o número com 9 acha a mensagem sem 9;
a Carteira do agente usa a empresa da conversa; quem não vê a conversa não mexe.
