# Exclusão permanente de empresa-cliente — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que admin/owner apague uma empresa-cliente de teste e tudo que dependeu
dela (missões, fechamentos, carteira, compromissos), preservando o XP já creditado no
ledger de quem trabalhou nela.

**Architecture:** Um único `DELETE FROM clients` resolve a cascata inteira via `ON DELETE`
nas FKs — sem função `SECURITY DEFINER`, sem DELETE manual multi-tabela. `xp_ledger.task_id`
e `closing_year_id` viram `ON DELETE SET NULL` (o ledger nunca é tocado, só perde o
vínculo); `guild_notices.client_id` também vira `SET NULL` (aviso já publicado
permanece); todo o resto (`tasks`, `task_events`, `accounting_closings`,
`accounting_closing_years`, `fiscal_portfolios`, `fiscal_portfolio_events`,
`client_commitments`) vira `CASCADE`. `task_transfers` também vira `CASCADE` a partir de
`tasks` — exceção pontual e escopada à regra "insert-only" que hoje bloqueia
`deleteTask` para missão transferida.

**Tech Stack:** Next.js 15 App Router (Server Actions), Drizzle ORM + drizzle-kit,
PostgreSQL, Zod, shadcn/ui (Dialog), Vitest.

Spec aprovada: [`docs/superpowers/specs/2026-08-19-exclusao-permanente-cliente-design.md`](../specs/2026-08-19-exclusao-permanente-cliente-design.md)

---

## Task 1: Schema — `onDelete` das FKs de `clients`/`tasks` + migration

**Files:**
- Modify: `src/db/schema/domain.ts`
- Create: `src/db/migrations/0033_<nome-gerado-pelo-drizzle-kit>.sql` (gerado, não escrito à mão)

Dez pontos do schema apontam para `clients` ou `tasks` sem `onDelete` explícito (o
padrão do Postgres é bloquear o DELETE do pai — `NO ACTION`). Esta tarefa muda cada um
para `cascade` ou `set null` conforme a spec.

- [ ] **Passo 1: `tasks.clientId` → cascade**

Em `src/db/schema/domain.ts`, dentro de `export const tasks = pgTable(...)`:

```ts
    clanId: uuid("clan_id"),
    clientId: uuid("client_id").references(() => clients.id),
    // Agrupa o "pacote" de missões nascidas do mesmo informativo — é o que a
```

vira:

```ts
    clanId: uuid("clan_id"),
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "cascade",
    }),
    // Agrupa o "pacote" de missões nascidas do mesmo informativo — é o que a
```

- [ ] **Passo 2: `task_events.taskId` → cascade**

```ts
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id),
    actorId: text("actor_id")
```

vira:

```ts
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    actorId: text("actor_id")
```

- [ ] **Passo 3: `task_transfers` (FK composta) → cascade**

```ts
    foreignKey({
      name: "task_transfers_org_task_fk",
      columns: [t.orgId, t.taskId],
      foreignColumns: [tasks.orgId, tasks.id],
    }),
    foreignKey({
      name: "task_transfers_org_from_clan_fk",
```

vira:

```ts
    foreignKey({
      name: "task_transfers_org_task_fk",
      columns: [t.orgId, t.taskId],
      foreignColumns: [tasks.orgId, tasks.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "task_transfers_org_from_clan_fk",
```

Isto é uma exceção CONSCIENTE e ESCOPADA à regra "insert-only" de `task_transfers`
(UPDATE/DELETE revogados do role da aplicação na migration 0022): a linha de
transferência ainda não pode ser apagada por um UPDATE/DELETE direto do app, mas
desaparece quando a MISSÃO inteira é apagada por causa da empresa ter sido excluída.
`deleteTask` continua bloqueando missão transferida — não muda nesta tarefa.

- [ ] **Passo 4: `xp_ledger.taskId` e `xp_ledger.closingYearId` → set null**

```ts
    taskId: uuid("task_id").references(() => tasks.id),
    taskEventId: uuid("task_event_id"),
    closingYearId: uuid("closing_year_id").references(
      () => accountingClosingYears.id,
    ),
```

vira:

```ts
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    taskEventId: uuid("task_event_id"),
    closingYearId: uuid("closing_year_id").references(
      () => accountingClosingYears.id,
      { onDelete: "set null" },
    ),
```

Este é o núcleo do pedido: o lançamento de XP nunca é tocado, só perde o vínculo com a
missão/ano que apagou. `src/lib/xp-queries.ts` (`getXpHistory`) já faz LEFT JOIN e
`src/app/(app)/profile/page.tsx` já tem o fallback
`entry.taskTitle ?? entry.closingTitle ?? REASON_LABELS[entry.reason]` — nenhum dos
dois precisa mudar.

- [ ] **Passo 5: `accounting_closings.clientId` → cascade**

```ts
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    title: varchar("title", { length: 160 }).notNull(),
```

vira:

```ts
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 160 }).notNull(),
```

- [ ] **Passo 6: `accounting_closing_years.clientId` → cascade**

```ts
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    year: smallint("year").notNull(),
```

vira:

```ts
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    year: smallint("year").notNull(),
```

- [ ] **Passo 7: `guild_notices.clientId` → set null**

```ts
    body: text("body").notNull(),
    clientId: uuid("client_id").references(() => clients.id),
    informativeId: uuid("informative_id").references(() => informatives.id),
    requiresAck: boolean("requires_ack").notNull().default(false),
```

vira:

```ts
    body: text("body").notNull(),
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "set null",
    }),
    informativeId: uuid("informative_id").references(() => informatives.id),
    requiresAck: boolean("requires_ack").notNull().default(false),
```

Aviso já publicado no mural é comunicação que a Guilda já confirmou/leu — diferente de
missão/fechamento (trabalho interno). O texto do aviso já cita o nome da empresa como
texto estático, então continua legível sem o vínculo.

- [ ] **Passo 8: `fiscal_portfolios.clientId` → cascade**

```ts
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    userId: text("user_id")
```

vira:

```ts
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    userId: text("user_id")
```

- [ ] **Passo 9: `fiscal_portfolio_events.clientId` → cascade**

```ts
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    fromUserId: text("from_user_id").references(() => user.id),
```

vira:

```ts
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    fromUserId: text("from_user_id").references(() => user.id),
```

- [ ] **Passo 10: `client_commitments.clientId` → cascade**

```ts
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    title: varchar("title", { length: 200 }).notNull(),
```

vira:

```ts
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 200 }).notNull(),
```

`client_commitment_periods` já é `onDelete: "cascade"` a partir de `client_commitments`
(passo nenhum necessário ali — a cascata de dois níveis já funciona).
`task_assignee_suggestions` já é `onDelete: "cascade"` a partir de `tasks` (idem).

- [ ] **Passo 11: Gerar a migration**

Run: `npm run db:generate`

Expected: cria `src/db/migrations/0033_<nome>.sql` com uma sequência de
`ALTER TABLE ... DROP CONSTRAINT ...` seguida de `ALTER TABLE ... ADD CONSTRAINT ...
... ON DELETE CASCADE` (ou `SET NULL`) para cada uma das dez FKs acima, mais a
atualização de `src/db/migrations/meta/_journal.json` e `meta/0033_snapshot.json`.

- [ ] **Passo 12: Revisar a migration gerada**

Abrir o arquivo `0033_*.sql` gerado e conferir que cada `ADD CONSTRAINT` citado no
passo 11 tem `ON DELETE CASCADE` ou `ON DELETE SET NULL` correspondente ao passo
certo acima (11 constraints: as 10 dos passos 1–10, mais nenhuma outra deveria
aparecer). Diferente da migration 0031 (que tinha um `CREATE UNIQUE INDEX` fora de
ordem), este diff só mexe em `DROP/ADD CONSTRAINT` — não deveria ter problema de
ordenação, mas confirme visualmente antes de aplicar.

- [ ] **Passo 13: Aplicar a migration**

Run: `npm run db:migrate`
Expected: saída sem erro, terminando em algo como `Migrations applied successfully`
(mesmo formato das migrations 0031/0032 já aplicadas nesta sessão).

- [ ] **Passo 14: Checar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Passo 15: Commit**

```bash
git add src/db/schema/domain.ts src/db/migrations/
git commit -m "feat: exclusao em cascata de empresa-cliente preserva xp do ledger"
```

---

## Task 2: Server Actions — resumo de exclusão e exclusão permanente

**Files:**
- Modify: `src/app/(app)/clients/actions.ts`

- [ ] **Passo 1: Adicionar imports necessários**

Em `src/app/(app)/clients/actions.ts`:

```ts
import { and, eq, isNull } from "drizzle-orm";
```

vira:

```ts
import { and, count, eq, isNull } from "drizzle-orm";
```

E:

```ts
import {
  parseClientImportRows,
  type ClientImportCellValue,
} from "@/lib/clients-import";
```

vira:

```ts
import {
  parseClientImportRows,
  type ClientImportCellValue,
} from "@/lib/clients-import";
import { isAdminRole } from "@/lib/session";
```

- [ ] **Passo 2: Escrever `getClientDeletionSummary`**

No final de `src/app/(app)/clients/actions.ts` (depois de `importClientsFromSpreadsheet`),
adicionar:

```ts
const deletionSummarySchema = z.object({ clientId: z.uuid() });

export interface ClientDeletionSummary {
  clientName: string;
  taskCount: number;
  closingCount: number;
  commitmentCount: number;
  portfolioHolderName: string | null;
}

/**
 * Contagem para o dialog de confirmação — a mesma consulta que fundamenta a
 * mensagem "vai apagar N missões, M fechamentos, P compromissos" antes do
 * usuário decidir se confirma. Roda na mesma transação que a leitura do
 * cliente para não haver corrida entre "mostrar o resumo" e "excluir".
 */
export async function getClientDeletionSummary(
  input: z.input<typeof deletionSummarySchema>,
): Promise<ActionResult<ClientDeletionSummary>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  if (!isAdminRole(ctx.role)) {
    return err("Apenas admin/owner pode excluir uma empresa permanentemente.");
  }

  const parsed = deletionSummarySchema.safeParse(input);
  if (!parsed.success) return err("Empresa inválida.");

  const summary = await withOrgTx(ctx.orgId, async (tx) => {
    const [client] = await tx
      .select({ id: schema.clients.id, name: schema.clients.name })
      .from(schema.clients)
      .where(
        and(
          eq(schema.clients.id, parsed.data.clientId),
          eq(schema.clients.orgId, ctx.orgId),
        ),
      );
    if (!client) return null;

    const [[taskRow], [closingRow], [commitmentRow], [portfolioRow]] = await Promise.all([
      tx
        .select({ value: count() })
        .from(schema.tasks)
        .where(
          and(eq(schema.tasks.orgId, ctx.orgId), eq(schema.tasks.clientId, client.id)),
        ),
      tx
        .select({ value: count() })
        .from(schema.accountingClosings)
        .where(
          and(
            eq(schema.accountingClosings.orgId, ctx.orgId),
            eq(schema.accountingClosings.clientId, client.id),
          ),
        ),
      tx
        .select({ value: count() })
        .from(schema.clientCommitments)
        .where(
          and(
            eq(schema.clientCommitments.orgId, ctx.orgId),
            eq(schema.clientCommitments.clientId, client.id),
          ),
        ),
      tx
        .select({ name: schema.user.name })
        .from(schema.fiscalPortfolios)
        .innerJoin(schema.user, eq(schema.user.id, schema.fiscalPortfolios.userId))
        .where(
          and(
            eq(schema.fiscalPortfolios.orgId, ctx.orgId),
            eq(schema.fiscalPortfolios.clientId, client.id),
          ),
        )
        .limit(1),
    ]);

    return {
      clientName: client.name,
      taskCount: taskRow.value,
      closingCount: closingRow.value,
      commitmentCount: commitmentRow.value,
      portfolioHolderName: portfolioRow?.name ?? null,
    };
  });

  if (!summary) return err("Empresa não encontrada.");
  return { ok: true, data: summary };
}
```

- [ ] **Passo 3: Escrever `deleteClientPermanently`**

Logo depois de `getClientDeletionSummary`, adicionar:

```ts
const deletePermanentlySchema = z.object({
  clientId: z.uuid(),
  confirmName: z.string().trim().min(1, "Digite o nome da empresa para confirmar."),
});

/**
 * Exclusão física de uma empresa-cliente, em cascata: missões, eventos de
 * missão, transferências, fechamentos, anos de fechamento, carteira,
 * histórico de carteira e compromissos somem junto (ON DELETE CASCADE nas
 * FKs — ver migration 0033). `xp_ledger.task_id`/`closing_year_id` e
 * `guild_notices.client_id` viram NULL em vez de apagar (ON DELETE SET
 * NULL): o XP já creditado nunca é tocado, só perde o rastro de onde veio.
 *
 * Mais restrito que `setClientActive` (que qualquer membro faz): exige
 * admin/owner, porque o estrago é permanente. Não exige desativar antes —
 * digitar o nome exato já é a barreira principal.
 */
export async function deleteClientPermanently(
  input: z.input<typeof deletePermanentlySchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  if (!isAdminRole(ctx.role)) {
    return err("Apenas admin/owner pode excluir uma empresa permanentemente.");
  }

  const parsed = deletePermanentlySchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult> => {
    const [client] = await tx
      .select({ id: schema.clients.id, name: schema.clients.name })
      .from(schema.clients)
      .where(
        and(
          eq(schema.clients.id, parsed.data.clientId),
          eq(schema.clients.orgId, ctx.orgId),
        ),
      )
      .for("update");
    if (!client) return err("Empresa não encontrada.");

    if (parsed.data.confirmName !== client.name) {
      return err("O nome digitado não confere com o nome da empresa.");
    }

    await tx
      .delete(schema.clients)
      .where(and(eq(schema.clients.id, client.id), eq(schema.clients.orgId, ctx.orgId)));

    return { ok: true };
  });

  if (result.ok) {
    revalidatePath("/clients");
    revalidatePath("/clans/[id]", "page");
    revalidatePath("/profile");
    revalidatePath("/leaderboard");
  }
  return result;
}
```

- [ ] **Passo 4: Checar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Passo 5: Commit**

```bash
git add src/app/\(app\)/clients/actions.ts
git commit -m "feat: server actions de resumo e exclusao permanente de empresa-cliente"
```

---

## Task 3: UI — dialog de exclusão em `/clients`

**Files:**
- Create: `src/app/(app)/clients/delete-client-dialog.tsx`
- Modify: `src/app/(app)/clients/client-actions.tsx`
- Modify: `src/app/(app)/clients/page.tsx`

- [ ] **Passo 1: Criar o dialog**

Criar `src/app/(app)/clients/delete-client-dialog.tsx`:

```tsx
"use client";

import { LoaderCircle, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  deleteClientPermanently,
  getClientDeletionSummary,
  type ClientDeletionSummary,
} from "./actions";

/**
 * Botão + dialog de exclusão permanente. O resumo (quantas missões,
 * fechamentos, compromissos, quem tem a carteira) é buscado ANTES de abrir o
 * dialog — mesmo padrão do GitHub para apagar repositório: mostra o estrago,
 * só então pede o nome exato para habilitar o botão destrutivo.
 */
export function DeleteClientButton({
  clientId,
  clientName,
}: {
  clientId: string;
  clientName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<ClientDeletionSummary | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [loadingSummary, startLoadingSummary] = useTransition();
  const [deleting, startDeleting] = useTransition();

  function openDialog() {
    startLoadingSummary(async () => {
      const result = await getClientDeletionSummary({ clientId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setSummary(result.data ?? null);
      setConfirmText("");
      setOpen(true);
    });
  }

  function handleDelete() {
    startDeleting(async () => {
      const result = await deleteClientPermanently({
        clientId,
        confirmName: confirmText,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Empresa excluída permanentemente.");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Excluir ${clientName} permanentemente`}
        disabled={loadingSummary}
        onClick={openDialog}
      >
        {loadingSummary ? (
          <LoaderCircle className="animate-spin" aria-hidden />
        ) : (
          <Trash2 aria-hidden />
        )}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Excluir &quot;{clientName}&quot; permanentemente</DialogTitle>
            <DialogDescription>
              Esta ação não pode ser desfeita. Apaga a empresa e tudo relacionado a
              ela.
            </DialogDescription>
          </DialogHeader>
          {summary ? (
            <div className="grid gap-3 text-sm">
              <ul className="grid gap-1 text-muted-foreground">
                <li>{summary.taskCount} missão(ões)</li>
                <li>{summary.closingCount} fechamento(s)</li>
                <li>{summary.commitmentCount} compromisso(s)</li>
                {summary.portfolioHolderName ? (
                  <li>Carteira com {summary.portfolioHolderName}</li>
                ) : null}
              </ul>
              <p className="text-muted-foreground">
                XP já creditado por missões desta empresa é preservado no histórico
                de quem o ganhou — só o nome da missão some.
              </p>
              <div className="grid gap-2">
                <Label htmlFor="confirm-client-name">
                  Digite{" "}
                  <span className="font-medium text-foreground">
                    {summary.clientName}
                  </span>{" "}
                  para confirmar
                </Label>
                <Input
                  id="confirm-client-name"
                  value={confirmText}
                  onChange={(event) => setConfirmText(event.target.value)}
                  autoComplete="off"
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={!summary || confirmText !== summary.clientName || deleting}
              onClick={handleDelete}
            >
              {deleting ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
              Excluir permanentemente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Passo 2: Passar `isAdmin` para `ClientRowActions`**

Em `src/app/(app)/clients/client-actions.tsx`, adicionar o import do novo dialog junto
aos demais imports locais:

```ts
import {
  createClient,
  importClientsFromSpreadsheet,
  setClientActive,
  updateClient,
  type ImportClientsResult,
} from "./actions";
```

vira:

```ts
import {
  createClient,
  importClientsFromSpreadsheet,
  setClientActive,
  updateClient,
  type ImportClientsResult,
} from "./actions";
import { DeleteClientButton } from "./delete-client-dialog";
```

Depois, mudar a assinatura e o corpo de `ClientRowActions`:

```tsx
export function ClientRowActions({ client }: { client: ClientView }) {
```

vira:

```tsx
export function ClientRowActions({
  client,
  isAdmin,
}: {
  client: ClientView;
  isAdmin: boolean;
}) {
```

E, dentro do `return`, depois do botão de arquivar/reativar e antes do bloco
`{editOpen ? ... : null}`:

```tsx
      >
        {client.active ? <Archive aria-hidden /> : <ArchiveRestore aria-hidden />}
      </Button>

      {editOpen ? (
```

vira:

```tsx
      >
        {client.active ? <Archive aria-hidden /> : <ArchiveRestore aria-hidden />}
      </Button>
      {isAdmin ? (
        <DeleteClientButton clientId={client.id} clientName={client.name} />
      ) : null}

      {editOpen ? (
```

- [ ] **Passo 3: Buscar o papel do usuário e passar `isAdmin` em `page.tsx`**

Em `src/app/(app)/clients/page.tsx`, o import de sessão hoje é:

```ts
import { requireOrgSession } from "@/lib/session";
```

vira:

```ts
import { getActiveMember, isAdminRole, requireOrgSession } from "@/lib/session";
```

E é preciso importar `redirect`, que a página ainda não usa — no topo do arquivo:

```ts
import { and, asc, desc, eq, ilike, type SQL } from "drizzle-orm";
import { Building2, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
```

vira:

```ts
import { and, asc, desc, eq, ilike, type SQL } from "drizzle-orm";
import { Building2, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
```

Dentro de `ClientsPage`, logo após `const session = await requireOrgSession();`:

```ts
  const session = await requireOrgSession();
  const params = await searchParams;
```

vira:

```ts
  const session = await requireOrgSession();
  const viewer = await getActiveMember();
  if (!viewer) redirect("/onboarding");
  const isAdmin = isAdminRole(viewer.role);
  const params = await searchParams;
```

E, na renderização de cada linha, passar a prop nova:

```tsx
              <ClientRowActions
                client={{
                  id: client.id,
                  name: client.name,
                  taxRegime: client.taxRegime,
                  cnpj: client.cnpj,
                  active: client.active,
                }}
              />
```

vira:

```tsx
              <ClientRowActions
                client={{
                  id: client.id,
                  name: client.name,
                  taxRegime: client.taxRegime,
                  cnpj: client.cnpj,
                  active: client.active,
                }}
                isAdmin={isAdmin}
              />
```

- [ ] **Passo 4: Checar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Passo 5: Lint**

Run: `npm run lint`
Expected: sem erros novos.

- [ ] **Passo 6: Commit**

```bash
git add src/app/\(app\)/clients/delete-client-dialog.tsx src/app/\(app\)/clients/client-actions.tsx src/app/\(app\)/clients/page.tsx
git commit -m "feat: dialog de exclusao permanente de empresa em /clients"
```

---

## Task 4: Verificação completa

**Files:** nenhum (só validação)

- [ ] **Passo 1: Suite automatizada**

Run: `npm run test`
Expected: todos os testes passam, sem regressão nos arquivos tocados nas sessões
anteriores (`draft.test.ts`, `notices.test.ts`, `task-sync.test.ts`,
`commitments.test.ts`, `clan-tabs.test.ts`, etc.).

- [ ] **Passo 2: `check:rls`**

Run: `npm run check:rls`
Expected: sem regressão — nenhuma tabela nova nasceu nesta feature, então a lista de
tabelas cobertas em `scripts/check-rls.mjs` não muda.

- [ ] **Passo 3: Build**

Run: `npm run build`
Expected: build limpo, sem erros de tipo ou lint bloqueando.

- [ ] **Passo 4: Fluxo completo no navegador**

Com o servidor de dev rodando (`npm run dev`, porta 4000) e logado como admin/owner:

1. Ir em `/clients`, cadastrar uma empresa de teste (ex.: "Teste Exclusão LTDA").
2. Criar uma missão para essa empresa (via informativo ou diretamente em `/tasks`),
   atribuir a um usuário e concluí-la — confirma que XP foi creditado (checar
   `/profile` do usuário responsável, nível/XP total sobem).
3. Voltar em `/clients`, clicar no ícone de lixeira na linha da empresa de teste.
4. Confirmar que o dialog mostra a contagem certa (1 missão, 0 fechamentos, 0
   compromissos, e carteira se a empresa foi para o clã Fiscal).
5. Digitar um nome ERRADO — confirmar que o botão "Excluir permanentemente"
   continua desabilitado.
6. Digitar o nome exato da empresa — confirmar que o botão habilita — e clicar.
7. Confirmar: toast de sucesso, empresa some da lista em `/clients`.
8. Ir em `/tasks` (ou onde a missão aparecia) — confirmar que ela sumiu.
9. Voltar no `/profile` do usuário que concluiu a missão — confirmar que o XP
   total NÃO mudou, e que o histórico de XP mostra a entrada com o rótulo
   genérico "Missão concluída" (fallback de `REASON_LABELS`) em vez do título da
   missão apagada.
10. Se a empresa tinha ido para a carteira fiscal, checar a aba Carteira do clã
    Fiscal — confirmar que a linha sumiu.

- [ ] **Passo 5: Push**

```bash
git push origin main
```

Expected: os três commits das Tasks 1–3 (mais qualquer commit de ajuste desta
verificação) sobem para `origin/main`. Confirmar antes que o commit da spec
(`docs: spec da exclusao permanente de empresa-cliente`) também já está em
`origin/main` — se não estiver, ele sobe junto.
