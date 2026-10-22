# Notas dos clientes — plano de implementação

> Spec: `docs/superpowers/specs/2026-10-22-notas-dos-clientes-design.md`.
> Execução inline nesta sessão (Bruno pediu para começar a desenvolver).
> Cada tarefa termina com `tsc`, testes da tarefa e commit na `develop`.

**Objetivo:** aba "Notas dos clientes" no clã Fiscal para cadastrar empresas
emissoras, tomadores e notas padrão, abrir o mês, ajustar e emitir em lote
NFS-e pelo CNPJ de cada empresa, com o certificado guardado no cofre.

**Arquitetura:** tabelas e fila próprias (`client_nfse_*`); reaproveita
`buildDpsXml`, `signNfseXml`, `createSefinClient`, `runNfseJob`,
`buildCancelRequestXml`, `readDanfse`/`renderDanfsePdf` e o cofre. O serviço
fiscal ganha um segundo consumidor de fila que abre o certificado da empresa
por nota. O PDF sai no app, do XML guardado.

**Stack:** Next 16 (App Router, Server Actions), Drizzle + Postgres (RLS),
Zod, Vitest + PGlite, pdf-lib.

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/nfse/template.ts` | separar `nfseIssuerTemplateSchema` (sem descrições) do modelo do escritório; `totalTaxes.kind = "percent"` (não optante) |
| `src/lib/nfse/dps-xml.ts` | aceitar o modelo do emissor; `<pTotTrib>` por esfera |
| `src/lib/nfse/processor.ts` | `NfseJobDeps.template` passa a ser o modelo do emissor |
| `src/domain/client-nfse.ts` | puro: descrição do mês (`{mes}`/`{competencia}`/`{ano}`), período de referência, seleção do lote |
| `src/db/schema/domain.ts` + migração `0087` | as seis tabelas, RLS, privilégios |
| `src/lib/client-nfse/registry.ts` | cadastro: emissor, tomador, nota padrão (salvar/apagar com as travas) |
| `src/lib/client-nfse/month.ts` | abrir o mês, editar item, prévia, enfileirar, cancelar, tentar de novo |
| `src/lib/client-nfse/service.ts` | serviço fiscal: reivindicar, emitir com o certificado da empresa, gravar desfecho e XML |
| `src/lib/client-nfse/loaders.ts` | leituras das duas visões da aba |
| `src/app/(app)/clans/[id]/client-nfse-actions.ts` | Server Actions (Zod + sessão + permissão do Fiscal) |
| `src/app/(app)/clans/[id]/client-nfse-tab.tsx` | aba (server): roteia Mês a mês × Cadastro |
| `src/app/(app)/clans/[id]/client-nfse-registry.tsx` | Cadastro (client) |
| `src/app/(app)/clans/[id]/client-nfse-issuer-dialog.tsx` | modelo fiscal do emissor |
| `src/app/(app)/clans/[id]/client-nfse-month.tsx` | Mês a mês (client): passos, itens, prévia, situação |
| `src/app/api/nfse/clientes/pdf/route.ts` | PDF/zip das notas emitidas, do XML guardado |
| `scripts/fiscal-service.ts` | chamar o consumidor da fila dos clientes no ciclo |
| `src/lib/clan-tabs.ts`, `page.tsx`, ícones | registrar a aba |

## Tarefas

### 1. Modelo fiscal do emissor e DPS de outro CNPJ
- `nfseIssuerTemplateSchema` = modelo sem `descriptions`; `nfseTemplateSchema`
  = `issuer.extend({ descriptions })`. `totalTaxes` ganha
  `{ kind: "percent", federal, state, municipal }` (formato `0.00`–`99.99`).
- Regras do emissor (`nfseIssuerTemplateRulesSchema`): ME/EPP exige
  `simples`; MEI recusado (fora da v1); não optante exige `percent`.
- `DpsInput.template: NfseIssuerTemplate`; `pTotTrib` com Fed/Est/Mun.
- Testes: DPS de não optante com `percent` passa no XSD; o do escritório
  continua igual (testes existentes).

### 2. Domínio puro (`src/domain/client-nfse.ts`)
- `clientNfseReferencePeriod(period, reference)`: `previous` → mês anterior.
- `renderClientNfseDescription(text, ref)`: `{mes}` e `{competencia}` →
  MM/AAAA, `{ano}` → AAAA.
- `selectClientNfseBatch(items)`: exclui valor zerado, documento inválido,
  endereço faltando quando o modelo leva IBS/CBS, nota ativa; agrupa por
  emissor. Mesmo formato de `NfseBatch`.
- Testes de cada regra.

### 3. Banco (migração 0087)
Tabelas da spec com FKs compostas, índices únicos (`issuer client`,
`taker document`, `item model+período`, `nota ativa por item`, `dps` por
emissor), RLS + FORCE, `GRANT`/`REVOKE` dos eventos. Teste PGlite: RLS isola
organizações; DELETE de emissor com nota é recusado pelo banco.

### 4. Cadastro (`registry.ts`) + actions
`saveIssuer` (só empresa não-MEI com certificado válido cujo CNPJ é o da
empresa), `saveTaker`, `saveModel`, `deleteIssuer/Taker/Model` (recusa com
nota). Testes PGlite.

### 5. Mês (`month.ts`) + actions
`openClientNfseMonth` (idempotente), `updateClientNfseItem` (só sem nota
ativa), `loadClientNfsePreview`, `enqueueClientNfseBatch` (mesma prévia,
reserva DPS por emissor sob `FOR UPDATE`), `requestClientNfseCancel`,
`requeueClientNfseInvoice`. Testes PGlite do ciclo.

### 6. Serviço fiscal (`service.ts`)
`claimClientNfseJob`, `runClientNfseQueue(orgId, vault, environment)`: abre o
certificado do emissor (confere CNPJ), roda `runNfseJob`, busca o XML da
nota emitida, `finishClientNfseJob` com lease. Teste com SEFIN falsa.

### 7. PDF no app
`/api/nfse/clientes/pdf`: permissão do Fiscal, lê `xml_gz` (ou
`nfse_issued_notes` pela chave), `renderDanfsePdf`; uma nota → PDF, várias →
zip (`fflate`).

### 8. Tela
Aba `client-nfse` ("Notas dos clientes"), duas visões, Cadastro com emissores
(card por empresa, modelo fiscal, tomadores, notas padrão) e Mês a mês com
passos, itens editáveis, prévia, situação, PDF. Verificar renderizado com o
banco local antes de subir.

### 9. Fechamento
`CLAUDE.md` (decisão), Cerebro, CRM, PR develop→main.
