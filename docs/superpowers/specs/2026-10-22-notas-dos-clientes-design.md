# Notas dos clientes — emissão de NFS-e pelo CNPJ das empresas-cliente

Data: 2026-10-22 · Pedido do Bruno · Desenho aprovado na conversa do dia.

## Problema

O Fiscal emite, todo mês, no Portal Nacional, as mesmas notas de serviço para
muitas empresas-cliente: mesmo tomador, mesmo serviço, valor quase sempre igual.
A Guilda já emite as notas de honorário do escritório pela API nacional e já
guarda o certificado A1 de cada empresa (aba XML das notas). Falta emitir em
nome das empresas.

## Respostas que fecharam o escopo

- Todas as empresas estão em municípios do Emissor Nacional.
- De um mês para o outro muda às vezes o **valor** e às vezes a **descrição**.
- Notas **simples**: sem ISS retido nem tributos federais retidos.
- Emissão em **lote do mês com prévia**, como nos Honorários.
- A referência ("referente a 10/2026") **varia por nota**: mês anterior ou o próprio.

## Fora da v1

Retenções (ISS e federais), envio da nota por e-mail ao tomador, nota avulsa
solta (fora de uma nota padrão), MEI (continua fora de tudo que usa o
certificado), emissão automática sem clique.

## Caminho escolhido

Módulo próprio que reaproveita as peças prontas (DPS, assinatura, cliente da
SEFIN, cancelamento, PDF, cofre). Honorários continuam intocados: generalizar a
fila deles mexeria em numeração, PDF e etapa do controle de algo em produção.

## Modelo de dados (migração 0087)

Toda tabela com `org_id`, RLS por `app.org_id` e FK composta `(org_id, …)`.

- **`client_nfse_issuers`** — a empresa emissora. `client_id` (único por org),
  `template` jsonb (o modelo fiscal: município, IM, regime, serviço padrão,
  ISSQN, total de tributos, IBS/CBS), `dps_series` e `next_dps_number` próprios
  (a numeração da DPS é por CNPJ), `active`. Só empresa não-MEI.
- **`client_nfse_takers`** — os tomadores da empresa: nome, CPF ou CNPJ,
  endereço (jsonb no formato de `clients.address`), `active`. Único por
  `(issuer_id, document)`.
- **`client_nfse_models`** — as notas padrão: tomador, valor, descrição com o
  marcador `{mes}`, referência (`previous` | `current`), serviço próprio
  opcional (substitui o do emissor), `active`.
- **`client_nfse_items`** — a nota do mês: nasce de uma nota padrão ao abrir o
  mês, com valor e descrição já resolvidos e editáveis só naquele mês. Único
  por `(model_id, ano, mês)`.
- **`client_nfse_invoices`** — a fila, como `nfse_invoices`: snapshot do
  tomador e do modelo fiscal, série e número da DPS reservados no pedido,
  status (`nfse_invoice_status`), lease, chave, número, ambiente, erro,
  cancelamento e o XML da NFS-e emitida (gz) para o PDF. Uma ativa por item.
- **`client_nfse_invoice_events`** — histórico, só acréscimo.

Apagar: emissor → tomadores → notas padrão → itens descem em cascata, mas a
nota (`client_nfse_invoices`) aponta para emissor, tomador e item **sem**
cascata: com nota pedida, o próprio banco recusa o DELETE. A action confere
antes para dar a mensagem certa ("pause em vez de apagar"). Eventos: só
INSERT/SELECT para o `guilda_app`.

## Fluxo

1. **Cadastro** (Fiscal e admins). Adicionar empresa emissora: lista quem tem
   certificado válido na aba XML. O modelo fiscal abre pré-preenchido
   (município pelo endereço da empresa, regime pelo regime dela) e o Fiscal
   confere. Tomadores com "Consultar CNPJ". Notas padrão com prévia da
   descrição para o mês.
2. **Abrir o mês** cria um item por nota padrão ativa de emissor ativo, com o
   valor padrão e a descrição resolvida (`{mes}` vira "10/2026" ou "11/2026"
   conforme a referência). Abrir de novo só acrescenta o que faltar.
3. **Ajustar**: valor e descrição editáveis no item, sem tocar no padrão.
4. **Emitir**: prévia agrupada por empresa (marca quais, confere total). O
   servidor recalcula e só aceita se for a mesma prévia; reserva os números de
   DPS de cada emissor na mesma transação.
5. **Serviço fiscal**: reivindica uma nota por vez, abre o certificado da
   empresa no cofre (só em memória, só para ela), consulta a DPS antes de
   emitir (anti-duplicidade), emite, busca o XML da nota e grava. Cancelamento
   pelo mesmo caminho.
6. **PDF**: o app monta o DANFSe do XML guardado (pdf-lib, sem certificado);
   uma nota baixa o PDF, mais de uma, .zip.

`dCompet` = data da emissão, como nos Honorários.

## Regras de segurança

- O certificado só é aberto no serviço fiscal (`vault.open`), nunca no app.
- Emissor só emite se o certificado estiver válido e o CNPJ do certificado
  for o da empresa (conferido de novo no serviço).
- Valor, descrição e quem emite são recalculados no servidor; o navegador só
  marca itens.

## Tela

Aba **Notas dos clientes** no Fiscal, com duas visões no topo (`SegmentedNav`):
**Mês a mês** (padrão) e **Cadastro**. O mês é uma sequência — Cadastro →
Abrir o mês → Emitir — com o botão principal no próximo passo, como nos
Honorários. Cada linha mostra a situação da nota (fila, emitida com número,
erro com motivo e "Tentar de novo", cancelada) e o PDF.

## Testes

- Puros: resolução de `{mes}`, regras do modelo fiscal (inclui não optante
  com percentuais por esfera), seleção do lote.
- DPS validada contra o XSD v1.01 com emissor de outro CNPJ e não optante.
- PGlite: abrir o mês sem duplicar, enfileirar reservando DPS por emissor,
  RLS entre organizações, anti-duplicidade de nota ativa por item, apagar com
  e sem nota.
- Processador: o mesmo `runNfseJob`, agora com o modelo fiscal do emissor.
