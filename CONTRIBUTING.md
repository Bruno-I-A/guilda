# Contribuindo com o Guilda

## Fluxo

1. Parta da branch `develop` atualizada.
2. Crie uma branch curta e descritiva.
3. Faça alterações pequenas, com migrations quando o schema mudar.
4. Execute as verificações locais.
5. Abra Pull Request para `develop`; releases usam `develop` → `main`.

```bash
npm ci
npm test
npm run lint
npx tsc --noEmit
npm run build
```

## Regras essenciais

- Nunca inclua `.env`, chaves, tokens, dumps ou dados reais de clientes.
- Toda tabela de domínio precisa de `org_id`, política RLS e grant explícito.
- Toda query de domínio deve executar no contexto de `withOrgTx`.
- Server Actions revalidam sessão, papel, clã e input; permissões da UI são
  apenas uma conveniência visual.
- Preserve migrations existentes. Correções entram em uma nova migration.
- Use `npm run db:generate` para mudanças de schema e revise o SQL gerado.
- Mudanças de comportamento devem incluir ou atualizar testes.

## Commits e Pull Requests

Prefira commits no formato:

```text
feat: adiciona controle anual de MEI
fix: impede cliente inativo na carteira
docs: documenta ambientes de deploy
```

O Pull Request deve explicar o problema, a solução, como foi validada e se há
impacto em banco, segurança ou deploy.

