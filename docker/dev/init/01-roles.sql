-- Role dedicado da aplicação (NÃO-superuser, NÃO-owner das tabelas).
-- RLS não se aplica a superuser nem ao owner das tabelas (sem FORCE),
-- então a aplicação PRECISA conectar com este role para o isolamento valer.
-- Migrations e seed rodam como 'postgres' (owner) via MIGRATION_DATABASE_URL.
CREATE ROLE guilda_app LOGIN PASSWORD 'guilda_app_dev' NOSUPERUSER NOCREATEDB NOCREATEROLE;

GRANT CONNECT ON DATABASE guilda TO guilda_app;
GRANT USAGE ON SCHEMA public TO guilda_app;

-- Tabelas/sequences existentes e futuras (criadas pelo owner 'postgres')
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO guilda_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO guilda_app;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO guilda_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO guilda_app;
