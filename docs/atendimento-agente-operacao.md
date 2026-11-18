# Agente de atendimento — operação inicial

Data: 18/11/2026 · primeira versão baseada em uma amostra anonimizada de
atendimentos reais do escritório. Nenhuma conversa, nome, telefone, empresa,
valor ou documento de cliente foi copiado para o repositório.

## O que apareceu na amostra

Os atendimentos são curtos, diretos e frequentemente chegam em várias
mensagens seguidas. Os grupos mais comuns foram:

1. pedido ou envio de guia, folha, boleto, nota e outros documentos;
2. emissão de nota fiscal nova ou recorrente;
3. cobrança de andamento ou confirmação de recebimento;
4. certificado digital e renovação;
5. dúvidas de folha, férias, jornada, salário e sindicato;
6. classificação tributária, devolução, fechamento e outros casos fiscais;
7. agradecimento, confirmação e encerramento sem novo pedido.

O agente deve agrupar as mensagens próximas em um único turno, responder de
forma curta e cordial e fazer no máximo uma pergunta objetiva por vez. Ele não
deve imitar erros de digitação das conversas nem repetir o nome do cliente em
cada fala.

## Fluxo de decisão

```text
mensagens agrupadas
  -> identificar assunto, setor, urgência e se há reclamação
  -> recuperar até quatro fontes aprovadas e vigentes
  -> fonte cobre integralmente a dúvida?
       sim: sugerir resposta curta + registrar ids/versões das fontes
       não: verificar se uma informação objetiva destrava o atendimento
              sim: sugerir uma única pergunta
              não: encaminhar com resumo para a pessoa/setor
  -> permanecer em modo sombra; nenhuma sugestão é enviada automaticamente
```

Uma resposta automática futura só poderá sair quando houver fonte aprovada,
citação interna válida, confiança suficiente e nenhum motivo de handoff. A
primeira versão continua apenas comparando a sugestão com o que a equipe fez.

## Handoff obrigatório

- interpretação contábil, fiscal, trabalhista ou jurídica;
- cálculo, enquadramento, tributação ou situação específica da empresa;
- reclamação, cobrança de retorno ou pedido explícito de uma pessoa;
- documento, guia ou nota que precise ser emitido, cancelado, corrigido ou
  conferido;
- dúvida que a base aprovada não cubra integralmente;
- qualquer pedido de senha, código, token ou dado sensível desnecessário.

Quando uma pessoa assume a conversa, a IA para. Ela não promete prazo, não diz
que algo foi feito e não anuncia que “vai encaminhar”; a própria interface
mostra o estado do atendimento.

## Como escrever a base

Cada item da base contém pergunta/assunto, resposta aprovada, setor,
palavras-chave, vigência, versão, autoria e aprovação. Conversa real nunca vira
fonte automaticamente. Ela só revela uma lacuna; alguém do escritório escreve
e aprova uma resposta limpa e geral.

Uma fonte deve responder uma única dúvida, com todas as condições necessárias.
Se preço, prazo ou regra variar, a fonte precisa dizer quando se aplica e ter
vigência. Alterar conteúdo cria nova versão; conteúdo antigo é arquivado, não
apagado.

## Primeiros conteúdos para o escritório revisar

Estes são candidatos, não fatos aprovados e não entram ativos na IA:

- quais dados pedir para uma nota fiscal nova;
- quando uma nota é tratada como recorrente;
- como funciona o pedido e a entrega de guias e folhas;
- política de renovação e preços de certificado digital;
- o que significa a parcela adicional anual dos honorários;
- quais extratos/documentos o escritório pede para o fechamento;
- canais e horários de atendimento;
- prazos de retorno que o escritório realmente consegue assumir.

Cada resposta deve ser confirmada pelo responsável do setor antes de mudar de
`draft` para `approved`.

## Avaliação antes da autonomia

O conjunto de teste deve usar perguntas sintéticas inspiradas nos padrões, sem
dados de clientes. Medir pelo menos:

- setor e urgência corretos;
- resposta integralmente sustentada pela fonte citada;
- ausência de promessa, interpretação técnica e dado inventado;
- qualidade da pergunta de esclarecimento;
- handoff em reclamações e casos técnicos;
- não responder a simples “ok”, agradecimento ou despedida.

Somente depois de uma rodada assistida e revisão dos erros se considera o modo
automático restrito.
