# Procuração: ler e emitir com o A1 do escritório

Data: 2026-11-18 · Pedido do Bruno · Referência: o Tero (`app de notas`), que já faz isso.

## Objetivo

Hoje cada empresa precisa do próprio A1 no cofre para a aba XML ler as notas e para
a aba Notas dos clientes emitir. Com 113 empresas de serviço, sempre há certificado
vencendo (em 17/11 eram três). Com a procuração eletrônica dada ao CNPJ do escritório,
o A1 do escritório basta. Medido no Tero (Cerebro: "Pela API a procuração emite e lê o
ADN, mas a consulta da nota por chave recusa"):

- `GET /contribuintes/DFe/{NSU}?lote=true&cnpjConsulta={empresa}` com o A1 do escritório
  devolve as notas da empresa; sem procuração, HTTP 400 com **E2245**.
- `POST /nfse` com a DPS da empresa (prestador = empresa), **assinada e conectada com o
  A1 do escritório**, emite.
- `GET /dps/{id}` é permitido.
- `GET /nfse/{chave}` é **recusado (403)** por procuração.
- Cancelamento por procuração **não foi medido**.

## Decisões

1. **Padrão do escritório com exceção por empresa** (escolha do Bruno). O escritório
   define "Ler e emitir por: Procuração / Certificado de cada empresa", e cada empresa
   pode seguir o padrão ou ser exceção.
2. **O A1 do escritório é o que já está no serviço fiscal** (`NFSE_CERT_PFX_BASE64`, o
   dos honorários). Nada de segundo cofre nem de envio pela tela. Renovar continua
   sendo trocar a variável do serviço fiscal.
3. **Sem troca silenciosa.** Procuração recusada não cai escondida para o certificado
   da empresa: a empresa mostra o erro e o Fiscal decide.
4. **Trocar a credencial de uma empresa recomeça a leitura dela do zero.** Não está
   medido se a sequência de NSU é a mesma lendo com o certificado da empresa ou com o
   do escritório. Recomeçar não apaga nada (nota repetida é ignorada pelo único
   `org_id + access_key`) e elimina o risco de pular nota com o cursor no meio.
5. **Implantação sem mudança de comportamento.** O padrão nasce em "Certificado". O
   Bruno testa a procuração em lote e só então vira o padrão.
6. **Os honorários do escritório não mudam.** A procuração vale para a aba XML e para
   Notas dos clientes.

## Banco

Duas tabelas novas, nenhuma tabela existente alterada. As duas têm `org_id`, RLS
forçado com a política `org_isolation` e entram no `check:rls`.

`nfse_credential_settings` (uma linha por organização)
- `default_mode` (`certificate` | `proxy`, padrão `certificate`)
- `proxy_test_requested_at` (pedido de teste para todas; nulo quando não há)
- `updated_by`, `updated_at`

`nfse_client_credentials` (uma linha por empresa, criada quando precisa)
- `mode` (`certificate` | `proxy` | nulo = segue o padrão)
- `read_mode`: com qual credencial o cursor de leitura foi construído. Quando o modo
  efetivo difere dele, a rotina zera o cursor da empresa antes de ler (decisão 4).
  Cobre a troca de uma empresa e a virada do padrão do escritório. Sem linha (ou com
  `read_mode` nulo) vale `certificate`, que é como todos os cursores foram construídos
  até hoje. Assim, o deploy não zera nenhum cursor.
- `proxy_status` (`untested` | `confirmed` | `invalid` | `no_emission` |
  `technical_failure`, padrão `untested`), `proxy_checked_at`, `proxy_code`,
  `proxy_message`
- `proxy_test_requested_at` (pedido de teste só desta empresa)
- `proxy_same_sequence` (booleano, nulo até medir): o teste compara os NSU que vierem
  com os já guardados em `nfse_issued_notes` para as mesmas chaves.
- `updated_by`, `updated_at`

Modo efetivo = `nfse_client_credentials.mode ?? nfse_credential_settings.default_mode ?? 'certificate'`.

## Serviço fiscal

O serviço já abre o A1 do escritório na subida. Ele passa a ser entregue também à
rotina de XML e à fila das notas dos clientes. Se estiver ausente ou vencido, as
empresas por procuração ficam com erro "O A1 do escritório não está disponível".

**Leitura (aba XML).** `listRoutineClients` passa a incluir:
- quem tem modo efetivo `proxy`, sem exigir certificado da empresa, desde que seja de
  serviço (a marcação "É de serviço?" da aba XML) ou tenha o modo `proxy` marcado nela.
  Sem essa trava, virar o padrão faria a rotina ler as 275 empresas, inclusive o
  comércio que não emite NFS-e;
- quem tem modo efetivo `certificate` e certificado válido, como hoje.

Por procuração, o transporte é o do A1 do escritório e `cnpjConsulta` é o CNPJ da
empresa. Cursor, regra do NSU, novas tentativas e gravação por lote são os mesmos.
Recusa E2245 marca `proxy_status = invalid` e grava o erro da empresa.

**Teste de procuração.** O app só registra o pedido (para todas ou para uma), como o
"Rodar agora". No ciclo, o serviço faz `GET /DFe/{n}?lote=true&cnpjConsulta={empresa}`
com o A1 do escritório e classifica a resposta. `n` é o NSU da nota mais antiga já
guardada da empresa menos 1 (0 se não houver nenhuma): assim o primeiro documento que
volta é uma nota que a Guilda já tem, e dá para medir se a sequência é a mesma.
A classificação é esta:
- lote legível ou `NENHUM_DOCUMENTO_LOCALIZADO` é `confirmed`;
- recusa (E2245, 401, 403, `REJEICAO`) é `invalid`;
- rede, 5xx, 429 ou formato desconhecido é `technical_failure`, que nunca vira `invalid`.

A classificação é a `classifyProxyResponse` do Tero, portada com os testes. O teste
só lê e não mexe no cursor.

**Emissão (Notas dos clientes).** Por procuração, a conexão e a assinatura da DPS usam
o A1 do escritório, com a empresa como prestadora. Por certificado, nada muda,
inclusive a conferência de que o A1 é do CNPJ da empresa.
- **XML da nota.** `emit()` passa a devolver o XML que já vem na resposta
  (`nfseXmlGZipB64`). A busca pela chave fica como plano B; por procuração ela é
  recusada.
- **Número da nota.** Sem a consulta pela chave, o número sai do XML da resposta
  (`nNFSe`).
- **Conferência da nota achada pela DPS** (proteção contra série de outro sistema).
  Nunca pode ser pulada. A ordem das fontes do XML é: a resposta, a consulta pela
  chave e o XML já guardado pela rotina. Sem nenhuma delas, a nota fica com erro "Não
  foi possível conferir a nota achada pela DPS; tente de novo depois da próxima
  leitura dos XML". Hoje, sem XML, a conferência é pulada; isso fecha essa porta
  também para quem usa certificado.
- **Recusa por falta de permissão** (E2245, 401, 403 ou mensagem de procuração,
  `isProxyAuthorizationError` do Tero) marca `proxy_status = no_emission`.
- **Cancelamento.** Vai pelo mesmo transporte. Se for recusado, o erro aparece na nota,
  e o caminho é o Portal ou marcar a empresa como exceção.

## Tela

**Aba XML, passo "Credenciais"** (era "Certificados"):
- o padrão do escritório (Procuração / Certificado de cada empresa), que só admin e
  owner mudam;
- a situação do A1 do escritório: válido até quando ou erro, a partir de
  `nfse_settings.certificate_valid_until` e `service_error`, que o serviço já grava;
- "Testar procuração" para todas, com o resumo de confirmadas, inválidas, não
  testadas e com falha. Quem pede o teste (para todas ou para uma): Fiscal e admins.

**Linha de cada empresa.** Por procuração, mostra o selo da procuração e "Testar". Por
certificado, a validade e "Enviar/Trocar certificado", como hoje. A escolha "Padrão ·
Procuração · Certificado da empresa" fica no detalhe da linha. Quem muda: Fiscal e
admins (`asFiscalOperator`).

**Filtro.** "Sem certificado" passa a "Sem credencial": empresa por procuração não
precisa de A1.

**Notas dos clientes.** O cartão da empresa diz por qual credencial ela emite, e os
erros de procuração aparecem na própria nota.

## Implantação

1. Deploy com o padrão em "Certificado": nada muda na leitura nem na emissão.
2. O Bruno roda "Testar procuração" para todas e confere os selos. O teste também mede
   se a sequência de NSU é a mesma (`proxy_same_sequence`), e o resultado vai para o
   Cerebro e para o Tero.
3. O Bruno vira o padrão para "Procuração". Empresa sem procuração vira exceção ou
   recebe a procuração. As empresas que trocaram de credencial têm a leitura refeita
   do zero uma vez.
4. Primeira emissão real por procuração: uma nota de uma empresa só, marcada na
   prévia, como foi com os honorários.

## Riscos

- **Cancelamento por procuração não medido.** O erro fica visível e há saída pelo
  Portal.
- **A1 do escritório vira ponto único.** Se vencer, param leitura e emissão de todas
  as empresas por procuração. A validade fica em destaque no passo Credenciais.
- **Limite de pedidos.** Todas as leituras passam a sair do mesmo certificado. Não há
  limite conhecido; as novas tentativas com espera já cobrem 429.

## Testes

- Funções puras: modo efetivo, decisão de zerar o cursor, `classifyProxyResponse`,
  `isProxyAuthorizationError`.
- Ciclo do serviço fiscal:
  - empresa por procuração lê com o transporte do escritório e o `cnpjConsulta` dela;
  - E2245 marca `invalid`;
  - troca de modo zera o cursor;
  - empresa por certificado continua igual.
- Emissão:
  - XML vindo da resposta;
  - conferência sem nenhum XML vira erro, nunca adoção;
  - recusa de permissão marca `no_emission`;
  - certificado continua conferindo o CNPJ.
- `check:rls` com as duas tabelas novas.

## Fora deste desenho

- Separar as empresas por carteira nas abas XML e Notas dos clientes (desenho próprio,
  a seguir).
- Enviar ou renovar o A1 do escritório pela tela.
- MEI, que continua fora da aba XML.
- Honorários.
