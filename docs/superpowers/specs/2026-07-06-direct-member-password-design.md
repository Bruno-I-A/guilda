# Cadastro direto de membro + troca de senha obrigatória — design aprovado

Data: 2026-07-06. Aprovado em conversa. Motivação: produção tinha contas de
demo (`*@demo.guilda.dev`, senha `demo123456` documentada no repo) com um
admin que o usuário não criou — foram apagadas (org "Guilda Demo" inteira,
usuários e dados de domínio ligados a ela). Para recriar o time (2 pessoas),
o convite por link foi considerado desnecessário e "estranho" pelo usuário —
substituído por cadastro direto com senha temporária.

## Decisões

- **Substitui totalmente o convite por link**: para 2 pessoas o link não
  agrega. O botão "Convidar" na tela de Membros vira "Adicionar membro"
  (nome, e-mail, papel, senha temporária). A UI de convites pendentes e a
  rota `/invite/[id]` saem de circulação; o plugin `organization` do
  better-auth continua habilitado (baixo risco manter, fácil reverter).
- **Troca de senha obrigatória no primeiro acesso**: novo campo
  `mustChangePassword` (boolean, default `true`) no `user`. Login funciona
  normal; enquanto o campo for `true`, toda rota protegida redireciona para
  `/change-password` (bloqueante) antes de liberar o resto do app.
- **Só admin/owner** cria membros diretamente (mesma permissão que já existia
  para convidar — `viewerIsAdmin` em `members/page.tsx`).
- **Sem e-mail de fato**: a senha temporária aparece uma vez na tela para o
  admin copiar/repassar por fora (mesmo modelo do link de convite antigo,
  que também dependia de compartilhamento manual — a v1 não tem
  infraestrutura de e-mail).

## Risco técnico identificado e evitado

`auth.api.signUpEmail` SEMPRE cria uma sessão e seta cookie de sessão
(`setSessionCookie`, ver `node_modules/better-auth/dist/api/routes/sign-up.mjs`).
Chamado dentro da Server Action do admin, isso trocaria a sessão do admin
pela da pessoa recém-criada — logaria o navegador do admin como a pessoa
nova. Por isso a criação usa o caminho de baixo nível que a própria
`signUpEmail` usa internamente ANTES de criar sessão:

```ts
const ctx = await auth.$context; // AuthContext interno, sem I/O de sessão
const hash = await ctx.password.hash(tempPassword);
const newUser = await ctx.internalAdapter.createUser({ email, name, emailVerified: false });
await ctx.internalAdapter.linkAccount({ userId: newUser.id, providerId: "credential", accountId: newUser.id, password: hash });
await auth.api.addMember({ body: { userId: newUser.id, organizationId: ctx.orgId, role } });
```

`addMember` é `createAuthEndpoint.serverOnly` no plugin `organization` —
feito exatamente para "admin adiciona alguém já existente à org" sem convite,
com todas as validações do plugin (limite de membros, duplicidade, etc.).

## Componentes

1. **Schema**: `mustChangePassword` via `user.additionalFields` no
   `betterAuth()` config (`src/lib/auth.ts`) + coluna correspondente em
   `src/db/schema/auth.ts` + migration (default `true`, sem RLS — tabela do
   better-auth, fora do domínio).
2. **`createMemberWithTempPassword`** (Server Action em `members/actions.ts`,
   novo arquivo): valida admin/owner via `requireMemberContext`, Zod
   (nome, e-mail, papel, senha ≥ 8 caracteres), executa a sequência acima,
   retorna a senha temporária uma única vez na resposta (nunca persistida
   em claro, nunca logada).
3. **UI de Membros**: `InviteMemberDialog` → `AddMemberDialog` (gera senha
   sugerida com `crypto.randomUUID().slice(0,8)` editável, mostra resultado
   em card copiável pós-criação). Remove o bloco "Convites pendentes" e
   `InvitationActions`. Rota `/invite/[id]` removida ou desativada.
4. **`/change-password`**: página fora do `AppShell` (como `/onboarding`),
   form simples (nova senha + confirmação), usa `authClient.changePassword`
   do client já embutido no better-auth. Ao suceder, marca
   `mustChangePassword = false` (via `authClient.updateUser` ou endpoint
   dedicado) e redireciona para `/dashboard`.
5. **Bloqueio**: `requireOrgSession` (ou um novo `requireSession` ampliado)
   em `src/lib/session.ts` checa `session.user.mustChangePassword` e
   redireciona para `/change-password` quando `true` — mesmo padrão dos
   redirects existentes (`/onboarding`).
6. **Troca voluntária**: a mesma tela/form fica acessível a qualquer momento
   via um item novo no menu do usuário ("Alterar senha"), sem a condição de
   bloqueio (útil para trocar senha por vontade própria depois).

## Fora de escopo

E-mail transacional de fato (continua sendo compartilhamento manual),
recuperação de senha esquecida (fora desta rodada), 2FA.

## Verificação

Build, Vitest (sem lógica pura nova esperada), fluxo manual: admin cria
membro → login com senha temporária → bloqueio em `/change-password` →
troca → libera `/dashboard` → novo login não pede mais.
