# Ambientes do Guilda

## Fluxo de versões

| Ambiente | Branch | Uso | Banco |
| --- | --- | --- | --- |
| Local | branch de trabalho | Desenvolvimento rápido | Postgres local do `docker-compose.dev.yml` |
| Homologação | `develop` | Validação funcional com dados fictícios | Postgres exclusivo de homologação |
| Produção | `main` | Operação real | Postgres exclusivo de produção |

O trabalho normal é enviado para `develop`. Quando a versão estiver aprovada,
abre-se um Pull Request de `develop` para `main`. A publicação da `main` é
acionada manualmente na action **Guilda pipeline**, marcando
`deploy_production`, depois que testes e build passarem.

O webhook global antigo do Easypanel foi desativado. Assim, pushes em qualquer
branch não reiniciam a produção por acidente.

## Criar a homologação no Easypanel

1. Crie um projeto separado chamado `guilda-homologacao`.
2. Dentro dele, crie um Postgres 17 com volume próprio. Não reutilize o serviço,
   banco, usuário ou volume da produção.
3. No banco novo, crie o role não-superuser `guilda_app` usando como referência
   `docker/prod/init/01-roles.sh`. Use senhas exclusivas de homologação.
4. Crie um serviço App com origem `Bruno-I-A/guilda`, branch `develop`, build pelo
   `Dockerfile` da raiz e porta interna `4000`.
5. Configure um domínio próprio, preferencialmente
   `homolog.guilda.shiftsys.com.br`, e ative Basic Auth no domínio.
6. Cadastre variáveis exclusivas no serviço:

   - `DATABASE_URL`: conexão com `guilda_app` no Postgres de homologação;
   - `MIGRATION_DATABASE_URL`: conexão do owner no mesmo Postgres;
   - `BETTER_AUTH_SECRET`: segredo diferente da produção;
   - `BETTER_AUTH_URL` e `NEXT_PUBLIC_APP_URL`: URL da homologação;
   - `FLOW_SECRETS_KEY`: chave diferente da produção;
   - `TELEGRAM_BOT_TOKEN`: vazio, ou um bot exclusivo de testes;
   - `ANTHROPIC_API_KEY`: opcional.

7. Faça o primeiro deploy e confira nos logs se as migrations terminaram antes
   da mensagem de inicialização da aplicação.
8. Crie somente usuários e empresas fictícios. Dados reais não devem ser
   copiados para homologação.
9. Se for usar deploy automático da homologação, guarde o endpoint do Easypanel
   no secret `EASYPANEL_STAGING_DEPLOY_URL` e adicione o job correspondente à
   pipeline; nunca reutilize o endpoint de produção.

## Publicação de uma versão

1. Validar a alteração localmente e na homologação.
2. Confirmar que a action da `develop` está verde.
3. Abrir e revisar o Pull Request `develop` → `main`.
4. Fazer backup do banco de produção quando houver migration de risco.
5. Mesclar o Pull Request.
6. Em **Actions → Guilda pipeline → Run workflow**, selecionar `main`, marcar
   `deploy_production` e acompanhar o deploy no Easypanel.
7. Fazer uma verificação rápida em `https://guilda.shiftsys.com.br`.

