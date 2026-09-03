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

## Estado atual (02/09/2026)

A homologação **existe e está em uso**. O endereço fica no Easypanel; não é
publicado aqui de propósito — o repositório é público e o cadastro (`/sign-up`)
ainda é aberto.

O que está de pé:

- Serviço **App** apontando para a branch `develop`, build pelo `Dockerfile` da
  raiz, porta interna `4000`.
- Serviço **Postgres 17** próprio, com volume próprio. Banco `homolodacao`
  (o nome tem um erro de digitação de origem — falta o `g`. **Não corrija pelo
  psql**: o Easypanel guarda o nome na configuração do serviço e renomear por
  fora desincroniza o painel).
- Role **`guilda_app`** não-superuser criado à mão, com `ALTER DEFAULT
  PRIVILEGES` para o dono, de modo que toda tabela criada pelas migrations já
  nasça acessível à aplicação.
- **Bot do Telegram exclusivo** de teste, em modo `polling`.
- 24 empresas fictícias carregadas para exercitar listas e filtros.

**Ressalva conhecida:** o serviço vive dentro do projeto `appcontabil`, junto da
produção, e não num projeto separado. Serviços do mesmo projeto se enxergam pela
rede interna, então a homologação **alcança** o banco de produção. Ela não faz
isso — a `DATABASE_URL` aponta para o banco próprio —, mas a proteção aqui é a
variável estar correta, não a rede impedir. Confira a `DATABASE_URL` antes de
qualquer deploy que a altere.

## Deploy da homologação

O job `deploy-staging` da pipeline publica a cada push na `develop`, **desde que**
o secret `EASYPANEL_STAGING_DEPLOY_URL` exista no GitHub. Enquanto ele não for
cadastrado, o job avisa e sai em 0 — a pipeline não fica vermelha, e o deploy
é acionado manualmente pelo painel.

## Variáveis do serviço de homologação

Todas exclusivas. Nenhuma pode repetir valor da produção.

| Variável | Observação |
| --- | --- |
| `DATABASE_URL` | conecta como **`guilda_app`**; é o que faz o RLS valer |
| `MIGRATION_DATABASE_URL` | conecta como o dono; só as migrations usam |
| `BETTER_AUTH_SECRET` | 32+ caracteres, gerado aleatoriamente |
| `FLOW_SECRETS_KEY` | opcional, mas necessária para o cofre Gov.br do Fluxo |
| `BETTER_AUTH_URL` | URL da homologação, **sem barra no fim e sem caminho** |
| `NEXT_PUBLIC_APP_URL` | idêntica à anterior |
| `TELEGRAM_BOT_TOKEN` | **bot exclusivo**; nunca o da produção |
| `TELEGRAM_UPDATE_MODE` | vazio (`polling` é o padrão) |

## Armadilhas já pagas (não repita)

1. **`BETTER_AUTH_URL` com barra no fim, caminho junto, protocolo trocado ou
   espaço de colagem** desloca o `basePath` do better-auth. Sintoma: as páginas
   funcionam e **todo** `/api/auth/*` devolve 404 **vazio, sem content-type** —
   diferente do 404 do Next, que é HTML com ~12 KB. Comparar a forma das duas
   respostas identifica o culpado em um comando.

2. **`DATABASE_URL` com o usuário do dono** em vez de `guilda_app`. Tudo
   funciona na tela e o isolamento entre organizações simplesmente deixa de
   existir, sem nenhum sinal. Verificação, com a app no ar:

   ```sql
   SELECT usename, count(*) FROM pg_stat_activity
   WHERE datname = current_database() GROUP BY usename;
   ```

   `guilda_app` tem que aparecer. Se só houver `postgres`, está errado.

3. **Sessão nova do psql abre no banco `postgres`**, não no da aplicação. Rode
   `\c homolodacao` sozinho, numa linha, e confirme que o prompt mudou antes de
   colar qualquer coisa — comando de barra invertida consome a linha inteira.

4. **Token de bot compartilhado com a produção.** O worker usa long polling e
   remove o webhook existente antes de começar; cada update do Telegram é
   entregue uma única vez. A homologação passaria a **consumir as mensagens da
   produção**, que pararia de responder sem emitir erro.

5. **Reutilizar `BETTER_AUTH_SECRET` da produção** faz uma sessão de um ambiente
   valer no outro.

## Publicação de uma versão

1. Validar a alteração localmente e na homologação.
2. Confirmar que a action da `develop` está verde.
3. Abrir e revisar o Pull Request `develop` → `main`.
4. Fazer backup do banco de produção quando houver migration de risco.
5. Mesclar o Pull Request.
6. Em **Actions → Guilda pipeline → Run workflow**, selecionar `main`, marcar
   `deploy_production` e acompanhar o deploy no Easypanel.
7. Fazer uma verificação rápida no domínio de produção.
