# Fase 5a — Empresas-cliente: design aprovado

Data: 2026-07-06. Primeiro ciclo da Fase 5 (Campanhas), decomposta em
5a clientes → 5b templates → 5c campanhas/instanciação → 5d pool/bônus.
Cada ciclo tem spec, implementação e commit próprios.

Nota: o CLAUDE.md recomenda validar as Fases 1–4 em uso real antes da Fase 5;
o usuário decidiu seguir agora (já usa o app).

## Decisões

- **Permissão**: qualquer membro da org gerencia clientes (criar/editar/ativar).
- **Regimes fixos**: enum `tax_regime` = `simples` | `presumido` | `real`
  (rótulos: Simples Nacional, Lucro Presumido, Lucro Real). É a chave que casa
  template→cliente nas fases 5b/5c.
- **CNPJ opcional**, `varchar(14)` normalizado (só dígitos), com unicidade
  parcial `(org_id, cnpj) WHERE cnpj IS NOT NULL`. Quando presente, valida
  dígitos verificadores.
- **Sem DELETE**: cliente desativa (`active = false`) — campanhas futuras
  referenciam clientes e o histórico não pode quebrar.
- **Carga inicial por script npm** (`npm run import:clients -- arquivo.csv --org <slug>`),
  não por UI: CSV `nome;cnpj;regime`, validação linha a linha, upsert por CNPJ
  (sem CNPJ, casa por nome exato), idempotente, relatório no console
  (criadas/atualizadas/rejeitadas com motivo).

## Componentes

1. **Schema** (`src/db/schema/domain.ts` + migration drizzle): enum + tabela
   `clients` (id, org_id, name, tax_regime, cnpj, active, created_at) + índice
   único parcial + RLS `org_isolation` idêntica às demais tabelas de domínio.
2. **Domínio puro**: `src/domain/cnpj.ts` — `normalizeCnpj` (tira máscara) e
   `validateCnpj` (14 dígitos + DV), testados em Vitest (bordas: máscara,
   dígitos repetidos, DV inválido).
3. **Server actions** (`src/app/(app)/clients/actions.ts`): `createClient`,
   `updateClient`, `setClientActive`. Sessão + membership em cada action,
   Zod em todo input, `withOrgTx` + filtro explícito de org_id, mensagem
   amigável em colisão de CNPJ.
4. **UI `/clients`**: item "Clientes" na navegação; busca por nome, filtro por
   regime, linhas no padrão visual (panel-cut, badge de regime, CNPJ em mono),
   dialogs de criar/editar, inativos apagados com toggle de reativação, estado
   vazio orientando o import.
5. **Script** `scripts/import-clients.ts` + entrada `import:clients` no
   package.json (mesmo runtime tsx do seed).

## Fora de escopo da 5a

Paginação (250 linhas + busca bastam), import por UI, exclusão física,
qualquer coisa de templates/campanhas.

## Verificação

Vitest (CNPJ e parser de linha), build, import de CSV de exemplo na org demo
e conferência manual da tela.
