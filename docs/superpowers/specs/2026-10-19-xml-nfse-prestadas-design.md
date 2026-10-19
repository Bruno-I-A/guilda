# XML das NFS-e prestadas das empresas — design aprovado

Data: 2026-10-19. Aprovado em conversa com o Bruno.

## Pedido

Todo mês o Fiscal entra no Portal Nacional com o certificado de cada empresa
e baixa os XML das NFS-e que ela emitiu no mês anterior, para arquivar numa
pasta. A ideia é deixar tudo cadastrado na Guilda e uma rotina automática
buscar e guardar esses XML sozinha, separados por empresa.

## Decisões do Bruno

- **Só NFS-e prestadas** (as que a empresa emitiu). Tomadas, NF-e, NFC-e e
  CT-e ficam de fora.
- **Certificados de todos os clientes são A1**, guardados no escritório.
- **Caminho 1**: o Fiscal cadastra o certificado na ficha da empresa, cifrado
  no navegador; só o serviço fiscal abre. (Descartados: certificados numa
  pasta do serviço fiscal, sem tela; e serviço pronto de terceiro, que levaria
  os certificados para fora e cobraria por CNPJ.)
- **Rotina automática que guarda na própria Guilda**, numa pasta por empresa
  e por mês. Aqui **o XML fica guardado** — diferente das notas de honorário,
  que continuam sem guardar nada. (Descartados: OneDrive e Google Drive, que
  exigiriam conectar uma conta externa.)
- **A rotina é configurável na Guilda** "pra quando ficar melhor pro
  pessoal": ligar/desligar, quando rodar, a partir de qual mês guardar e
  rodar agora.
- **O mês vale pela data de emissão**: em outubro o Fiscal precisa das notas
  emitidas de 01/09 a 30/09.
- **A competência do Controle mensal é o mês apurado**: o trabalho feito em
  outubro sobre setembro fica no controle de 09/2026, e é lá que o botão
  baixa as emitidas de 01/09 a 30/09.

## O que a API oferece (fonte: gov.br/nfse)

Manual dos Contribuintes — APIs do ADN, v1.0 (12/02/2026):

- `GET /contribuintes/DFe/{NSU}` no ADN (`https://adn.nfse.gov.br`) devolve
  os documentos em que o contribuinte é **emitente, tomador ou
  intermediário**, numa sequência numerada (NSU). Com `lote=true`, vêm até 50
  documentos a partir do NSU pedido, cada um com NSU, chave, tipo (NFS-e ou
  evento) e o XML em GZip + Base64.
- **Não há filtro por data**: quem consulta guarda o último NSU lido.
- O certificado precisa ser **da mesma raiz de CNPJ** da empresa consultada;
  o parâmetro `cnpjConsulta` informa o CNPJ exato. Procuração eletrônica não
  é aceita.
- Só aparecem as notas que chegaram ao Sistema Nacional. Getúlio Vargas emite
  pelo Portal Nacional; empresa de cidade com sistema próprio só aparece se a
  prefeitura compartilhar com o nacional.

Na implementação, conferir no Swagger os nomes exatos dos parâmetros e dos
campos da resposta, e os códigos dos eventos de cancelamento (e101101) e de
cancelamento por substituição (e105102).

## Desenho

### 1. O certificado de cada empresa

**Tela.** A ficha fiscal da empresa (Carteira e fichas) ganha o bloco
**"Certificado A1"**: situação e o botão **Enviar certificado** (arquivo
.pfx/.p12 e senha), mais **Remover**. Não existe botão de baixar o
certificado de volta. Quem pode: Fiscal e admins
(`canManageFiscalOperations`), a régua de emitir notas.

**Cifragem no navegador.**

- O serviço fiscal recebe uma chave RSA nova, `NFSE_VAULT_PRIVATE_KEY`, no
  Easypanel (gerada por um comando, como o token). Ele deriva a chave pública
  e a publica no banco (`nfse_settings.vault_public_key` e `vault_key_id`, a
  impressão digital da chave) a cada ciclo.
- O navegador (WebCrypto) cifra `{ pfx, senha }` com uma chave AES-256-GCM
  nova e embrulha essa chave com a pública do serviço (RSA-OAEP, SHA-256). Vai
  para a Server Action só o envelope `{ keyId, wrappedKey, iv, ciphertext }`.
- A Server Action confere sessão, papel, que a empresa é da organização, o
  tamanho do envelope e que o `keyId` é o publicado; grava com situação
  `pending`. O app nunca vê o certificado nem a senha.

**Conferência no serviço fiscal.** A cada ciclo (10 s), o serviço abre os
envelopes `pending` com a chave privada, abre o PKCS#12
(`loadNfseCertificate`, que já existe) e grava:

- `valid` com o CNPJ do certificado e a validade, se a raiz do CNPJ bate com
  a da empresa;
- `invalid` com o motivo escrito: "a senha não abre o arquivo", "o
  certificado é de outro CNPJ", "o arquivo não é um certificado A1".

"Vencido" não é uma situação gravada: sai da validade na hora de mostrar. A
ficha mostra "Válido até 19/03/2027", "Vencido em ..." ou o motivo. Na lista
da Carteira, a empresa ganha selo quando o certificado vence em menos de 30
dias, venceu ou está com problema.

Perder a `NFSE_VAULT_PRIVATE_KEY` só obriga a reenviar os certificados:
ninguém consegue abri-los sem ela. Trocar a chave invalida os envelopes
antigos pelo `keyId`.

### 2. A rotina automática

**Configuração.** Botão de engrenagem no topo do Controle mensal, para Fiscal
e admins:

- **Ligada / desligada** (começa ligada);
- **Quando rodar**: "todo dia" ou "só no dia __ de cada mês" (1 a 28), "às
  __:__", no horário de Brasília (começa todo dia às 06:00);
- **Guardar notas a partir de**: "histórico inteiro" (padrão) ou um mês/ano;
- **Rodar agora**: pede uma rodada na hora, fora do agendamento.

A regra "está na hora de rodar?" é pura e testada: agendamento, última rodada
e o pedido de "rodar agora", sempre em Brasília.

**Uma rodada.** Para cada empresa com certificado válido e não vencido, o
serviço fiscal pede
`GET /contribuintes/DFe/{NSU}?lote=true&cnpjConsulta=...` a partir do último
NSU lido daquela empresa, de 50 em 50, até não vir mais nada, com o
certificado dela na conexão (mTLS). O certificado é aberto em memória para a
leitura e descartado depois. Cada documento:

- **NFS-e em que a empresa é a emitente**, com data de emissão a partir do
  "guardar a partir de": entra na pasta da empresa com chave, NSU, número,
  data de emissão da NFS-e (`dhProc`), competência e **o XML** (compactado);
- **evento de cancelamento** (ou de cancelamento por substituição) de uma
  nota guardada: a nota fica marcada como cancelada, com o XML do evento —
  inclusive quando o cancelamento chega meses depois;
- **o resto** (notas tomadas, de intermediário, outros eventos, notas antes
  do "guardar a partir de"): ignorado; a leitura só avança o NSU.

A primeira rodada de uma empresa lê o histórico inteiro que o Sistema
Nacional tiver (respeitando o "guardar a partir de"). Uma empresa que falha
não para as outras: o erro fica registrado nela e a próxima rodada tenta de
novo.

**Acompanhamento.** O topo do Controle mensal mostra a última rodada e quem
ficou de fora: "Lidos hoje às 06:04 · 2 empresas com problema: certificado
vencido (Padaria), Sistema Nacional não respondeu (Mercado)".

### 3. A pasta de cada empresa e o download

- **Na ficha fiscal**, a lista de meses da empresa com a quantidade ("09/2026
  — 12 notas, 1 cancelada") e o botão de baixar cada mês.
- **No Controle mensal da competência 09/2026**, cada empresa mostra quantas
  notas emitiu de 01/09 a 30/09, e o botão do topo diz **"Baixar XML —
  emitidas de 01/09 a 30/09"**: data de emissão da NFS-e entre 01/09 00:00 e
  30/09 23:59:59, em Brasília. Sai `nfse-prestadas-2026-09.zip` com as
  empresas do controle daquele mês que têm notas guardadas no período, uma
  pasta por empresa (`padaria-pao-e-cia-33000167/000123.xml`).
- **Na linha da empresa**, o botão "XML": só aquela empresa. **Uma nota só,
  não cancelada, vem como o próprio XML**, sem .zip, a mesma regra do PDF;
  qualquer outro caso sai em .zip.
- **Canceladas** vão para `canceladas/` dentro da pasta da empresa, com o
  XML do evento ao lado (`000123-cancelamento.xml`).
- **LEIA-ME** no .zip do mês lista as empresas do controle com "Importar
  notas (NF-e/NFS-e)" marcado na ficha que não têm notas guardadas no
  período e por quê: sem certificado, certificado vencido ou com problema,
  primeira leitura ainda não feita, última rodada com erro, ou simplesmente
  sem nota emitida.

O download sai direto do banco pelo app (rota
`GET /api/nfse/xml?clanId&year&month[&clientId]`, com sessão e permissão de
Fiscal); não passa pelo serviço fiscal.

### Dados (migração nova, com RLS e `org_id` em tudo)

- `nfse_client_certificates`: empresa (única por organização), envelope
  (jsonb), situação (`pending`/`valid`/`invalid`), motivo, CNPJ do
  certificado, validade, conferido em, enviado por e em.
- `nfse_xml_routines`: uma linha por organização — ligada, frequência
  (`daily`/`monthly`), dia do mês, horário, guardar a partir de, pedido de
  rodar agora, início e fim da última rodada.
- `nfse_dfe_cursors`: empresa, último NSU lido, primeira leitura concluída
  em, última leitura, último erro.
- `nfse_issued_notes`: empresa, chave (única por organização), NSU, número,
  data de emissão, competência, XML compactado, NSU, data e XML compactado do
  cancelamento. Índice por (organização, empresa, data de emissão).
- `nfse_settings` ganha `vault_public_key` e `vault_key_id`.

O `guilda_app` recebe privilégio total nas tabelas novas pelos default
privileges. A proteção do certificado é a cifragem, não a permissão: o banco
só tem o envelope. Volume esperado: alguns KB por nota compactada, perto de
100 MB por ano com 50 empresas. Nada é apagado automaticamente.

## Erros

- Certificado com problema: na ficha, no selo da Carteira, no acompanhamento
  da rotina e no LEIA-ME.
- Sistema Nacional fora do ar ou limitando (5xx, 429): a empresa fica com o
  erro e a próxima rodada tenta de novo; poucos pedidos ao mesmo tempo.
- Rodada interrompida no meio (reinício do serviço): o NSU só avança depois
  de gravar o lote, então a próxima continua de onde parou sem perder nem
  duplicar nota (a chave é única).
- Nenhum log imprime certificado, senha, envelope ou XML.

## Testes

- Envelope cifrado com WebCrypto (como o navegador faz) aberto pelo serviço
  com `node:crypto`; `keyId` errado recusado.
- Conferência do certificado: senha errada, CNPJ de outra raiz, vencido.
- "Está na hora de rodar?": todo dia, dia do mês, horário em Brasília,
  rodar agora, desligada.
- Rodada com respostas simuladas do ADN: lotes, fim da leitura, nota
  prestada guardada com o XML, nota tomada ignorada, "guardar a partir de",
  cancelamento tardio, substituição, falha numa empresa sem parar as outras,
  retomada sem duplicar.
- Corte do mês pela data de emissão em Brasília (30/09 23:59 e 01/10 00:00).
- Montagem do .zip: pasta por empresa, `canceladas/`, LEIA-ME, XML direto
  quando é uma nota só.
- Banco no PGlite como `guilda_app`, com todas as migrações.
- Teste real na produção com uma empresa, conferindo a quantidade contra o
  Portal Nacional.

## Ordem de entrega

1. **Cofre de certificados**: chave do serviço, publicação da chave pública,
   cifragem no navegador, conferência no serviço, bloco na ficha e selo na
   Carteira.
2. **Rotina**: cliente do ADN, rodada com cursor e pasta por empresa,
   configuração e acompanhamento no Controle mensal.
3. **Pasta e download**: meses na ficha, contagem e botões no Controle
   mensal, .zip e LEIA-ME.
4. **Teste real** com uma empresa.

## Fora do escopo

Notas tomadas; NF-e, NFC-e e CT-e (há o serviço da Receita RS de download
para contabilistas, com o certificado do escritório, quando for a vez);
gravar em OneDrive ou Google Drive; marcar a etapa "Notas" sozinho; somar o
faturamento; apagar XML antigo.

— claude, 19/10/2026
