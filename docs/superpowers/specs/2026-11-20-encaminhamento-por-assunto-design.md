# Encaminhamento por assunto dentro do clã

Data: 20/11/2026 · pedido do Bruno · aprovado na conversa antes deste texto.

## Problema

O agente do Atendimento (teste por palavra-chave, 19/11) encaminha a conversa ao
clã do setor e avisa no WhatsApp **todo mundo do clã**. No Fiscal são três
pessoas: com volume real, cada uma acha que outra vai pegar, e os avisos viram
ruído. O Fiscal divide o trabalho de dois jeitos:

- **por empresa**: a Carteira (`fiscal_portfolios`) tem um responsável por
  empresa. Guia de imposto, guia atrasada e afins são dele;
- **por assunto**: parcelamento (guia de parcelamento, parcelamento atrasado) é
  de uma pessoa só, para todas as empresas.

O que não se encaixa vai para o líder do clã. RH, DP e Contabilidade têm uma
pessoa só, que é o líder.

## Decisão

Depois de a IA escolher o setor e o clã (`clanForSector`), o encaminhamento
escolhe **uma pessoa**, nesta ordem:

1. **Assunto de uma pessoa.** O admin escreve, por clã, o que cada pessoa atende
   em texto livre ("parcelamento, guia de parcelamento, parcelamento atrasado").
   A IA recebe essa lista e indica a pessoa quando o pedido casa claramente. É a
   triagem em dois níveis do Scharff (`atendente_sugerido`, `blocoRoster`), que
   já atendeu cliente real e veio no prompt da Guilda sem uso (lista vazia). O
   código só aceita pessoa que está na lista e é do setor escolhido.
2. **Assunto da Carteira** (só no clã dono da Carteira, o Fiscal). O admin
   escreve quais assuntos seguem a Carteira ("guias de imposto, guia atrasada").
   Esses assuntos entram na lista como uma entrada especial, "responsável da
   empresa". Se a IA a escolher e a conversa estiver vinculada a uma empresa com
   responsável na Carteira que ainda é do clã, vai para ele. Sem empresa ou sem
   responsável, cai no passo 3.
3. **Líder do clã.** Com um líder, vai para ele. Com mais de um, todos os líderes
   são avisados e a conversa fica sem pessoa. Sem líder, o clã inteiro é avisado,
   que é o comportamento de hoje.

Com uma pessoa escolhida, a conversa fica **atribuída a ela**
(`assigned_user_id`), em "Precisa de pessoa": aparece em "Minhas" e ela responde
sem precisar assumir. **Só quem foi escolhido recebe o aviso** no WhatsApp; quem
não conectou o número no Perfil não recebe, mas a conversa continua atribuída.
O texto ao cliente não muda ("Encaminhei ao setor Fiscal…"), e o histórico da
conversa diz "IA: encaminhou para Fiscal · Maria".

**Só admin escreve as regras** (decisão do Bruno): uma regra errada manda
conversa de cliente para a pessoa errada. Elas ficam em Atendimento →
Configurações, ao lado do teste do agente.

A empresa da conversa vem do vínculo do contato (`support_contacts.client_id`),
que já existe e vale para sempre por número: vinculado uma vez na caixa de
entrada, as próximas conversas daquele número já sabem a empresa. Cadastrar os
números na própria empresa, antes de o cliente escrever, é a etapa seguinte.

## Prompt

`blocoRoster` e a validação de `atendente_sugerido` já existem. A lista vai à IA
só no teste do agente (modo conversa), com o primeiro nome e as atribuições, como
no Scharff. A entrada da Carteira usa o id `carteira` e o nome "Responsável da
empresa (carteira)". `OpcoesClassificacao` ganha `roster`. Cada linha da lista
leva o setor do clã da pessoa (o setor cujo clã é aquele, pelo mesmo
`clanForSector`), porque a validação exige que a pessoa seja do setor escolhido.

## Banco

`support_routing_topics`:

- `org_id`, `clan_id`, `user_id` (nulo = assuntos da Carteira do clã), `topics`
  (texto, até 500), `updated_by`, `updated_at`;
- um registro por pessoa por clã e um de Carteira por clã (índices únicos
  parciais);
- FK composta `(org_id, clan_id, user_id)` para `clan_memberships`, com
  cascata: quem sai do clã leva a regra junto. FK `(org_id, clan_id)` para
  `clans`;
- RLS `org_isolation`. O `guilda_app` pode apagar: texto vazio apaga a regra.

## Tela

Cartão "Quem atende cada assunto" em Atendimento → Configurações: para cada clã
ativo, os integrantes com um campo "Assuntos que atende", o líder marcado ("recebe
o que não casar"), e no Fiscal o campo "Assuntos que seguem a Carteira". Salvar
por clã. Clã sem líder mostra o aviso de que o clã inteiro será avisado.

## Testes

- Puros: a escolha da pessoa (pessoa da lista; Carteira com e sem empresa; líder
  único, vários, nenhum) e quem recebe o aviso.
- Prompt: a lista entra no modo conversa com o setor de cada pessoa.
- Banco: parcelamento vai para a pessoa; guia com empresa vinculada vai para o
  responsável da Carteira; guia sem empresa e assunto não identificado vão para o
  líder; clã sem líder avisa todos; a conversa fica atribuída e o aviso sai só
  para quem foi escolhido; quem sai do clã perde a regra.

## Fora desta versão

- Cadastrar os números de WhatsApp na empresa (próxima etapa).
- Escalar para o clã inteiro quando ninguém assume em X minutos.
- Avisar quando uma pessoa transfere a conversa.
- Usar a lista na leitura em sombra.
