# Notas de honorário pela API nacional — design aprovado

Data: 2026-10-10. Aprovado em conversa com o Bruno.

## Pedido

O Fiscal emite todo mês, à mão no Portal Nacional, cerca de 50 NFS-e de
honorários: entra, copia a nota anterior, troca tomador e valor, cliente por
cliente. A ideia é emitir todas com um clique, a partir da aba Honorários, que
já guarda o valor mensal de cada empresa.

## Decisões do Bruno

- **Caminho A**: a Guilda fala direto com a API do Sistema Nacional NFS-e,
  sem intermediário (Focus, NFE.io...) e sem robô no site do Portal.
- **Serviço separado no Easypanel** guarda o certificado A1 do escritório; o
  app exposto na internet nunca o vê ("vou não colocar o certificado no ar").
- **Só tomador e valor mudam** de uma nota para outra. Serviço, descrição e
  tributação são um modelo único do escritório.
- **Toda empresa com honorário na aba** ganha uma nota por mês, como tomadora.
  A nota existe para comprovar o faturamento do escritório: **ninguém recebe**,
  não há envio.
- **PA (parcela adicional)**: uma vez por ano, mês incerto (dezembro ou
  janeiro). Fica como opção a marcar na emissão; **vale um honorário mensal**.
- **Cancelar pela Guilda**, já que a API permite.
- **PDFs não são guardados**: baixar todos do mês num clique; nada fica salvo.
  Quem quiser depois, consulta no Portal. O banco não pesa por causa de nota.
- **Quem emite e cancela**: integrantes do Fiscal e admins (a mesma régua da
  aba Honorários, `canManageFiscalOperations`).
- O XML de uma nota real ainda não está disponível; o desenvolvimento segue
  pelo que não depende dele.

## O que a API oferece (fonte: documentação oficial, gov.br/nfse)

Manual dos Contribuintes v1.2 (out/2025), esquemas XSD v1.01 (09/02/2026).

| Uso | Método |
| --- | --- |
| Emitir (síncrono) | `POST /nfse` com a DPS assinada, GZip + Base64 em JSON |
| Recuperar a chave pela DPS | `GET /dps/{id}` (só para ator da nota) · `HEAD /dps/{id}` |
| Consultar a nota | `GET /nfse/{chaveAcesso}` |
| Cancelar | `POST /nfse/{chaveAcesso}/eventos`, evento `e101101` (`cMotivo`, `xMotivo`) |
| PDF (DANFSe) | API própria no ADN (`adn[.producaorestrita].nfse.gov.br/danfse`) |

- Base Sefin: produção restrita `https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional`,
  produção `https://sefin.nfse.gov.br/SefinNacional`.
- Conexão por **mTLS com certificado ICP-Brasil**; o servidor responde 403 sem
  certificado (conferido em 10/10/2026). O certificado do escritório é o do
  prestador, então serve para emitir, consultar e cancelar as próprias notas.
- Identificador da DPS (45 posições): `DPS` + município IBGE (7) + tipo de
  inscrição (1) + CNPJ (14) + série (5) + número (15). Identificador do pedido
  de evento: `PRE` + 56 dígitos (chave de 50 + tipo de evento de 6, pelo XSD).
- A DPS mínima para esta nota: `tpAmb`, `dhEmi`, `verAplic`, `serie`, `nDPS`,
  `dCompet`, `tpEmit=1`, `cLocEmi`, `prest` (CNPJ, IM, `regTrib`), `toma`
  (CNPJ, `xNome`), `serv` (`locPrest`, `cServ` com `cTribNac` e `xDescServ`),
  `valores` (`vServ`, `trib` com `tribMun` e `totTrib`).

## Desenho

### Serviço fiscal (Easypanel)

Novo serviço `guilda-fiscal`, mesma imagem da Guilda, comando próprio
(`scripts/fiscal-service.ts`). É o **único processo com o certificado**.

| Variável | Onde | Para quê |
| --- | --- | --- |
| `NFSE_CERT_PFX_BASE64`, `NFSE_CERT_PASSWORD` | só no serviço fiscal | certificado A1 |
| `NFSE_AMBIENTE` | só no serviço fiscal | `restrita` (padrão) ou `producao` |
| `FISCAL_SERVICE_TOKEN` | serviço fiscal e app | segredo da chamada interna de PDFs |
| `FISCAL_SERVICE_URL` | só no app | endereço interno do serviço |
| `DATABASE_URL` | os dois | role `guilda_app` |

- `NFSE_AMBIENTE` ausente ou inválido vale `restrita`: emitir nota de verdade
  exige a variável explícita, e o serviço da homologação nunca a recebe.
- Se o app for invadido, o atacante consegue no máximo pedir "emita a nota de
  honorário da empresa X pelo modelo do escritório", nunca levar o
  certificado. O serviço fiscal só sabe montar esta nota, este cancelamento e
  este download; não é um assinador genérico.
- Se o certificado faltar, estiver vencido ou a senha não abrir, o serviço
  sobe e registra o motivo; a aba mostra a emissão desligada com esse motivo.

### Conversa entre app e serviço

- **Emitir e cancelar: fila no banco**, no mesmo molde do `telegram_outbox`.
  O app grava o pedido; o serviço reivindica por uma função `SECURITY DEFINER`
  (`claim_nfse_invoices`, com `FOR UPDATE SKIP LOCKED` e token de lease),
  processa cada nota dentro de `withOrgTx` da organização dela e finaliza só
  o lease que ainda é seu. Reinício no meio continua de onde parou.
- **PDFs: chamada direta pela rede interna**, com `FISCAL_SERVICE_TOKEN`. O app
  confere sessão, permissão e organização, monta a lista de chaves das notas
  emitidas do mês e pede o `.zip` ao serviço, que busca cada DANFSe, compacta e
  devolve em streaming. Nada é gravado em disco nem no banco.

### Dados

- **`nfse_settings`** (uma por organização): o CNPJ do prestador em coluna
  própria, o modelo da nota em `jsonb` validado por Zod (município, regime,
  código de serviço, tributação, textos da descrição mensal e da PA), a
  **série de DPS exclusiva da Guilda** e o contador do próximo número. Série
  própria para não colidir com as notas emitidas à mão no Portal. Só
  admin/owner altera o modelo. Sem modelo preenchido, a emissão fica
  desligada com o aviso "modelo da nota ainda não configurado".
- **Batimento do serviço**, nas colunas `service_seen_at`, `service_environment`
  e `certificate_valid_until` da mesma linha. O serviço as atualiza a cada
  ciclo por uma função `SECURITY DEFINER` que localiza a organização pelo CNPJ
  do certificado. **O serviço só processa notas da organização cujo CNPJ de
  prestador é o do certificado** — nunca assina nota de outra organização.
- **`nfse_invoices`**: uma linha por nota — empresa, linha do controle mensal
  (`office_fee_control_periods`), tipo (`monthly` ou `additional_installment`),
  competência, valor, tomador congelado (CNPJ e nome), descrição final, série e
  número da DPS, ambiente, situação, chave e número da NFS-e, datas, motivo do
  erro ou do cancelamento, quem pediu e quem cancelou, e as colunas de lease.
  Situações: `queued`, `issued`, `failed`, `cancel_requested`, `cancelled`.
  A situação diz o que foi pedido; enquanto o serviço trabalha numa nota, o
  lease (`locked_at`, `lock_token`) marca isso sem mudar a situação, e assim o
  serviço sabe se a tarefa é emitir (`queued`) ou cancelar
  (`cancel_requested`).
- **`nfse_invoice_events`**: histórico só de acréscimo (pedida, emitida,
  recusada, reenviada, cancelamento pedido, cancelada, cancelamento recusado).
- Unicidade: `(org_id, série, número)`; uma nota mensal ativa por empresa e
  competência; uma PA ativa por empresa e ano. "Ativa" é toda situação exceto
  `cancelled`, então nota cancelada pode ser reemitida.
- Tudo com `org_id`, RLS forçado e **REVOKE explícito**: os default privileges
  dão tudo ao `guilda_app`, e GRANT sozinho não restringe nada. Os eventos não
  têm UPDATE nem DELETE.

### Emissão

1. Com o controle do mês aberto, **"Emitir notas de {mês}"** abre a prévia: cada
   empresa do mês com o valor congelado no controle (`profileSnapshot`), CNPJ e
   situação.
2. Ficam fora do lote, com o motivo: CNPJ ausente ou inválido, valor zero, nota
   do mês já ativa. A prévia mostra também quantas empresas ativas **ainda não
   têm honorário cadastrado**.
3. **"Incluir PA"** acrescenta a nota da parcela adicional das empresas com PA
   marcada que ainda não tiveram PA ativa no ano, com o valor de um honorário
   mensal.
4. **"Emitir N notas · R$ total"** pede confirmação. O app reserva os números de
   DPS na mesma transação que grava os pedidos (`queued`). O número reservado
   nunca muda.
5. O serviço monta a DPS pelo modelo, assina (XMLDSIG), compacta e envia. Nota
   emitida grava chave e número e, **na mesma transação**, marca a etapa do
   controle (`invoiceStatus`, ou `additionalInstallmentStatus` na PA) como
   `completed`, com evento no histórico.
6. A tela acompanha a fila e mostra cada linha emitida ou com erro.

**Por que não duplica**: em toda tentativa depois da primeira, e quando o
Sistema Nacional responde que a DPS já existe, o serviço consulta
`GET /dps/{id}` antes de reenviar. Se a nota já saiu, recupera a chave e
termina como emitida.

### Cancelamento

"Cancelar nota" pede o motivo (erro na emissão, serviço não prestado, outros)
e a justificativa. O serviço envia o evento `e101101`. Aceito, a nota fica
`cancelled` e a etapa do controle volta para `pending`. Recusado (prazo ou
regra do município), a nota continua `issued` e o motivo aparece.

## Erros

| Situação | Comportamento |
| --- | --- |
| Recusa de regra de negócio | `failed` na hora, com o código e a mensagem; "Tentar de novo" reenvia com o mesmo número de DPS |
| Rede, timeout, 5xx | nova tentativa automática em 1, 5 e 15 min; depois `failed` |
| Lease vencido (serviço caiu no meio) | outra reivindicação retoma pela consulta da DPS |
| Certificado ausente, vencido ou senha errada | emissão desligada com o motivo; aviso 30 dias antes do vencimento (`certificate_valid_until`) |
| Serviço fiscal parado | pedidos esperam na fila; a aba avisa quando `service_seen_at` passa de 5 minutos |
| Certificado de outro CNPJ | o serviço não processa a fila e registra o motivo |
| Cancelamento recusado | nota segue emitida; motivo visível |

## Testes

- DPS e pedido de cancelamento gerados a partir de entradas fixas, comparados
  com arquivo de referência e **validados contra os XSD oficiais v1.01**.
- Identificadores: `DPS` de 45 posições e `PRE` de 59, com zeros à esquerda.
- Assinatura e conferência com certificado gerado no próprio teste.
- Seleção do lote: valor, CNPJ, nota já ativa, PA uma vez por ano.
- Fila com Sistema Nacional simulado: sucesso, DPS repetida, recusa, queda de
  rede, lease vencido.
- RLS e privilégios das tabelas novas conferidos no banco de verdade
  (`check:rls`), como nas tabelas anteriores.

## Ordem de entrega

1. **Base, sem o XML**: tabelas, fila, serviço fiscal (certificado, mTLS,
   assinatura, DPS, cancelamento, PDFs) e a tela de prévia, emissão e
   cancelamento, falando com a **produção restrita**.
2. **Notas de teste**: emitir, baixar o PDF e cancelar uma nota na produção
   restrita, de ponta a ponta. Confirma o formato da resposta, o algoritmo de
   assinatura aceito e se a API de DANFSe ainda responde (há relatos de que foi
   desligada em 2026; se foi, o serviço gera o PDF a partir do XML, no mesmo
   clique).
3. **Modelo real, com o XML**: preencher o modelo do escritório a partir de uma
   nota já emitida e emitir notas de teste idênticas a ela.
4. **Produção**: a primeira emissão real é uma nota só, conferida no Portal;
   depois o lote do mês.

## Depende do XML de exemplo

Código de tributação nacional e municipal, NBS, regime (`opSimpNac`,
`regApTribSN`, `regEspTrib`), tributação do ISS (`tribISSQN`, `tpRetISSQN`,
alíquota), forma de informar o total de tributos, texto da descrição e a regra
da data de competência (`dCompet`). Até lá, a produção restrita usa um modelo
de teste preenchido à mão.

## Fora do escopo

Envio da nota ao tomador, armazenamento de PDF ou XML, notas fora dos
honorários, substituição de nota (evento de cancelamento por substituição) e
a baixa de impostos dos Fechamentos (desenho próprio, parte 1 aprovada em
09/10/2026, retomado depois desta entrega).

— claude, 10/10/2026
