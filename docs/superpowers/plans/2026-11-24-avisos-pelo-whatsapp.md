# Avisos e missões pelo WhatsApp — plano de implementação

> Desenho: `docs/superpowers/specs/2026-11-24-avisos-pelo-whatsapp-design.md`.
> Execução inline nesta sessão, tarefa por tarefa, com teste antes do código.

**Objetivo:** todo aviso que ia pelo Telegram passa a sair pelo WhatsApp do
escritório (texto e botão na janela de 24 h, modelo Utility fora dela), líder/admin/
dono criam missão por mensagem, o número do integrante é confirmado por código e o
Telegram sai do código.

**Arquitetura:** os produtores de aviso passam a montar um `Notice` estruturado
(`src/lib/notices/`), que vira texto, botão ou parâmetros de modelo por funções puras.
A fila continua `member_whatsapp_outbox` (payload `version: 3`). Mensagens de número
confirmado vão para `member_whatsapp_commands`, processadas por um ciclo novo do
`support-worker`. Tudo transacional e idempotente pelas chaves de sempre.

**Stack:** Next 16, Drizzle + Postgres (RLS FORCE, `guilda_app`), Vitest + PGlite.

---

## Tarefa 1 — Migração 0112

`src/db/migrations/0112_member-whatsapp-notices.sql` + entrada no `_journal.json`
(idx 112) + `src/db/schema/domain.ts`.

- `member_whatsapp_connections`: `verified_at`, `verification_code_hash varchar(64)`,
  `verification_expires_at`.
- `member_notification_preferences`: mesmas colunas de `telegram_preferences`,
  `closing_notifications DEFAULT false`, única `(org_id, user_id)`; `INSERT … SELECT`
  copiando o Telegram.
- `member_whatsapp_templates (org_id, key, name, language, status, category,
  template_id, rejected_reason, checked_at, updated_at)`, PK `(org_id, key)`; copia
  `member_whatsapp_notification_config` como `novo_cliente`.
- `member_whatsapp_commands`: `external_id` único por org, `kind` (`text|button|other`),
  `text`, `button_id`, `status` (`pending|processing|done|failed`), lease e tentativas;
  funções `claim_member_whatsapp_commands` e `finish_member_whatsapp_command`
  (SECURITY DEFINER, como a fila de avisos).
- `member_whatsapp_outbox`: check de origem `num_nonnulls(...) <= 1`; função
  `defer_member_whatsapp_outbox(id, token, minutes)`.
- `informatives.whatsapp_connection_id` (FK) e `informative_source` ganha `whatsapp`.
- RLS ENABLE + FORCE + `org_isolation` nas tabelas novas; grants.

Verificação: `npm run check:rls`, teste PGlite aplicando as migrações.

## Tarefa 2 — Funções puras

- `src/domain/member-verification.ts`: `generateVerificationCode(random)`,
  `hashVerificationCode`, `parseVerificationMessage(text)`, `VERIFICATION_TTL_MS`.
- `src/lib/notices/notice.ts`: tipo `Notice` (famílias `new_mission`, `approval`,
  `mission_update`, `deadline`, `daily_summary`, `general`), `noticeText`,
  `noticeTemplate` (chave, parâmetros do corpo, caminho do link, payload do Aprovar),
  `noticeQuickReply`, `templateParam` (sem quebra de linha, curto) e
  `NOTICE_TEMPLATES` (corpo, exemplos, botões; corpo nunca termina em variável).
- `src/lib/notices/links.ts`: `appBaseUrl`, `dueDateLabel`.
- `src/lib/whatsapp/member-inbound.ts`: `parseMemberInbound(payload)` (texto, botão de
  modelo `type: button`, resposta interativa `interactive.button_reply`),
  `parseMemberButton(id)` (`task:start|approve:<uuid>`, `draft:confirm|cancel:<uuid>`).

Testes unitários para cada uma.

## Tarefa 3 — Enfileirar

`src/lib/notices/enqueue.ts`: `enqueueMemberNotice`, `enqueueOrgNotice`,
`enqueueClanNotice`, `enqueueInformativeAssignmentNotices`, `enqueueMemberReply`.
Só número confirmado e com a preferência ligada; broadcast com JOIN em `member`
(e clã ativo). Teste PGlite.

## Tarefa 4 — Trocar os produtores

`lib/tasks/create.ts` (sem aviso a si mesmo), `lib/tasks/transition-service.ts`,
`app/(app)/tasks/actions.ts`, `clans/[id]/closing-actions.ts`,
`clans/[id]/company-flow-actions.ts`, `lib/mural/notices.ts`,
`lib/informatives/confirm.ts` (aviso agrupado por pessoa).

## Tarefa 5 — Envio

- `meta-client.ts`: `sendWhatsAppButtons` (interativa com até 3 respostas),
  `sendWhatsAppTemplate` com `buttons` (link e resposta rápida),
  `createWhatsAppUtilityTemplate` com `buttons`.
- `member-notification-worker.ts`: só conexão confirmada; v3 dentro da janela →
  texto ou botões, fora → modelo aprovado (reconsulta o modelo a cada 15 min);
  silêncio adia; `reply` sempre como mensagem de sessão.
- Lembretes do dia (`src/lib/notices/schedule.ts`), uma vez por minuto no
  `support-worker`.

## Tarefa 6 — Entrada e comandos

- `inbound-worker.ts`: `GUILDA <código>` de número cadastrado → confirma; número
  confirmado → `member_whatsapp_commands`; os demais seguem para o Atendimento.
- `src/lib/whatsapp/member-commands.ts`: ciclo que responde texto (prévia do
  Informativo), botão (transição ou decisão) e o resto (ajuda).
- `informatives/confirm.ts` e `draft.ts`: origem `whatsapp`, conexão conferida.

## Tarefa 7 — Perfil

Cartão do WhatsApp: número e confirmação, avisos, preferências, modelos (admin).
Sai o cartão do Telegram. Medida renderizada em 375 e 1280 px antes do PR.

## Tarefa 8 — Tirar o Telegram

Apagar `src/lib/telegram/`, `scripts/telegram-worker.ts`, `app/api/telegram/`,
`profile/telegram-*`, a entrada do `start-production.mjs`, `TELEGRAM_*` de
`.env.example` e docs. Tabelas ficam.

## Tarefa 9 — Fechamento

`tsc`, lint, testes, `check:rls`, build, CLAUDE.md, Cerebro, CRM, commit e push na
develop, PR para a main.
