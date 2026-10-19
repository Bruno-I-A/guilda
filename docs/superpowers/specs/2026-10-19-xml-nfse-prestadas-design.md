# XML das NFS-e prestadas das empresas — design aprovado

Data: 2026-10-19. Aprovado em conversa com o Bruno.

## Pedido

Todo mês o Fiscal entra no Portal Nacional com o certificado de cada empresa
e baixa os XML das NFS-e que ela emitiu no mês anterior, para arquivar numa
pasta. A ideia é a Guilda baixar esses XML sozinha: um clique, todas as
empresas.

## Decisões do Bruno

- **Só NFS-e prestadas** (as que a empresa emitiu). Tomadas, NF-e, NFC-e e
  CT-e ficam de fora.
- **Uso: arquivar numa pasta.** A Guilda baixa; o arquivo continua sendo a
  pasta do escritório. **O XML não é guardado** na Guilda.
- **Certificados de todos os clientes são A1**, guardados no escritório.
- **Caminho 1**: o Fiscal cadastra o certificado na ficha da empresa, cifrado
  no navegador; só o serviço fiscal abre. (Descartados: certificados numa
  pasta do serviço fiscal, sem tela; e serviço pronto de terceiro, que levaria
  os certificados para fora e cobraria por CNPJ.)
- **O mês vale pela data de emissão**: em outubro o Fiscal baixa as notas
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
  e a publica no banco (`nfse_settings.vault_public_key` e
  `vault_key_id`, a impressão digital da chave) a cada ciclo.
- O navegador (WebCrypto) cifra `{ pfx, senha }` com uma chave AES-256-GCM
  nova e embrulha essa chave com a pública do serviço (RSA-OAEP, SHA-256). Vai
  para a Server Action só o envelope `{ keyId, wrappedKey, iv, ciphertext }`.
- A Server Action confere sessão, papel, que a empresa é da organização, o
  tamanho do envelope e que o `keyId` é o publicado; grava com situação
  `pending`. O app nunca vê o certificado nem a senha.

**Conferência no serviço fiscal.** A cada ciclo, o serviço abre os envelopes
`pending` com a chave privada, abre o PKCS#12 (`loadNfseCertificate`, que já
existe) e grava:

- `valid` com o CNPJ do certificado e a validade, se a raiz do CNPJ bate com
  a da empresa;
- `invalid` com o motivo escrito: "a senha não abre o arquivo", "o
  certificado é de outro CNPJ", "o arquivo não é um certificado A1";
- `expired` quando a validade passou (também reavaliado todo dia).

A ficha mostra "Válido até 19/03/2027" ou o motivo. Na lista da Carteira, a
empresa ganha selo quando o certificado vence em menos de 30 dias, venceu ou
está com problema.

Perder a `NFSE_VAULT_PRIVATE_KEY` só obriga a reenviar os certificados:
ninguém consegue abri-los sem ela. Trocar a chave invalida os envelopes
antigos pelo `keyId`.

### 2. A leitura das notas de cada empresa

Para cada empresa com certificado `valid`, o serviço fiscal pede o
`GET /contribuintes/DFe/{NSU}?lote=true&cnpjConsulta=...` a partir do último
NSU lido, de 50 em 50, até não vir mais nada, com o certificado daquela
empresa na conexão (mTLS). O certificado é aberto em memória para a leitura
e descartado depois.

Cada documento:

- **NFS-e em que a empresa é a emitente** entra no índice: chave, NSU,
  número, data de emissão da NFS-e (`dhProc`) e competência;
- **evento de cancelamento** (ou de cancelamento por substituição) de uma
  nota do índice marca a nota como cancelada e guarda o NSU do evento;
- **o resto** (notas tomadas, de intermediário, outros eventos) é ignorado; a
  leitura só avança o NSU.

O XML não é guardado. **Primeira leitura**: o histórico inteiro, em segundo
plano, logo depois que o certificado é aprovado. **Depois**: uma vez por dia,
e de novo na hora do download.

O Controle mensal mostra, em cada empresa, quantas notas ela emitiu no
período ("12 notas").

### 3. O download

- No Controle mensal da competência **09/2026**, o botão do topo diz
  **"Baixar XML — emitidas de 01/09 a 30/09"**: notas com data de emissão da
  NFS-e entre 01/09 00:00 e 30/09 23:59:59, no horário de Brasília.
- **Do mês, todas as empresas**: as do controle que têm certificado válido,
  mais as que têm "Importar notas (NF-e/NFS-e)" marcado na ficha (estas, sem
  certificado, aparecem no LEIA-ME). Sai `nfse-prestadas-2026-09.zip`, uma
  pasta por empresa (`padaria-pao-e-cia-33000167/000123.xml`).
- **Na linha da empresa**, o botão "XML": só aquela empresa. **Uma nota só,
  não cancelada, vem como o próprio XML**, sem .zip, a mesma regra do PDF;
  qualquer outro caso sai em .zip.
- **Canceladas** vão para `canceladas/` dentro da pasta da empresa, com o
  XML do evento ao lado (`000123-cancelamento.xml`).
- **LEIA-ME** dentro do .zip lista quem não entrou e por quê: sem
  certificado, certificado vencido ou com problema, leitura inicial em
  andamento, Sistema Nacional sem resposta. Empresa sem nota no período
  também aparece no LEIA-ME, para não parecer esquecida.

Na hora do download, o serviço lê o que for novo e busca os XML das notas do
período por NSU, em lotes que cobrem do menor ao maior NSU delas. Nada fica
salvo.

### Conversa entre app e serviço

O app (rota `GET /api/nfse/xml?clanId&year&month[&clientId]`) confere sessão
e permissão, monta a lista de empresas e chama o serviço pela rede interna,
com o `FISCAL_SERVICE_TOKEN`: `POST /nfse-xml` com organização, período e
empresas. O serviço responde o .zip ou, no caso de uma empresa com uma nota,
o XML, com o nome do arquivo num cabeçalho que o app valida antes de repassar.
A porta HTTP é a de `src/lib/nfse/fiscal-http.ts`.

### Dados (migração nova, com RLS e `org_id` em tudo)

- `nfse_client_certificates`: empresa (única por organização), envelope
  (jsonb), situação (`pending`/`valid`/`invalid`/`expired`), motivo, CNPJ do
  certificado, validade, conferido em, enviado por e em.
- `nfse_dfe_cursors`: empresa, último NSU lido, leitura inicial concluída em,
  última leitura, último erro.
- `nfse_issued_notes`: empresa, chave (única por organização), NSU, número,
  data de emissão, competência, NSU e data do cancelamento.
- `nfse_settings` ganha `vault_public_key` e `vault_key_id`.

O `guilda_app` recebe privilégio total nas tabelas novas pelos default
privileges. A proteção do certificado é a cifragem, não a permissão: o banco
só tem o envelope.

## Erros

- Certificado com problema: na ficha e no LEIA-ME.
- Sistema Nacional fora do ar ou limitando (5xx, 429): a leitura tenta de novo
  no ciclo seguinte; poucos pedidos ao mesmo tempo.
- Download pedido durante a primeira leitura: "leitura inicial em andamento"
  no LEIA-ME daquela empresa, nunca um mês incompleto calado.
- Nenhum log imprime certificado, senha ou envelope.

## Testes

- Envelope cifrado com WebCrypto (como o navegador faz) aberto pelo serviço
  com `node:crypto`; `keyId` errado recusado.
- Conferência do certificado: senha errada, CNPJ de outra raiz, vencido.
- Leitura por NSU com respostas simuladas do ADN: lotes, fim da leitura, nota
  prestada, nota tomada ignorada, cancelamento e substituição.
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
2. **Leitura**: cliente do ADN, cursor e índice, contagem no Controle mensal.
3. **Download**: rota no serviço e no app, botões, .zip e LEIA-ME.
4. **Teste real** com uma empresa.

## Fora do escopo

Notas tomadas; NF-e, NFC-e e CT-e (há o serviço da Receita RS de download
para contabilistas, com o certificado do escritório, quando for a vez);
guardar os XML; marcar a etapa "Notas" sozinho; somar o faturamento.

— claude, 19/10/2026
