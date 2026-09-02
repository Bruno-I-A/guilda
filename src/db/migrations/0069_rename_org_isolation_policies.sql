-- As politicas de client_import_batches e mei_annual_declarations nasceram com
-- o nome prefixado pela tabela, enquanto as outras 40+ usam "org_isolation".
-- O isolamento sempre esteve correto (mesma expressao, RLS ligado e FORCE), mas
-- scripts/check-rls.mjs compara o nome exato e reprovava as duas.
--
-- Padronizar o nome vale mais que afrouxar a checagem: verificador de seguranca
-- que acusa falha falsa e verificador que a equipe aprende a ignorar.
--
-- Renomear politica e operacao de catalogo, instantanea e sem lock de dados.
-- O DO guarda contra ambientes onde a politica ja tenha o nome novo.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    WHERE c.relname = 'client_import_batches'
      AND p.polname = 'client_import_batches_org_isolation'
  ) THEN
    ALTER POLICY "client_import_batches_org_isolation"
      ON "client_import_batches" RENAME TO "org_isolation";
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    WHERE c.relname = 'mei_annual_declarations'
      AND p.polname = 'mei_annual_declarations_org_isolation'
  ) THEN
    ALTER POLICY "mei_annual_declarations_org_isolation"
      ON "mei_annual_declarations" RENAME TO "org_isolation";
  END IF;
END $$;
