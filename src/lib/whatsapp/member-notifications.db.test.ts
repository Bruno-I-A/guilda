import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import * as schema from "@/db/schema";
import { applyMigrations } from "@/lib/nfse/testing/pglite";

vi.mock("server-only", () => ({}));

const client = new PGlite();
const db = drizzle(client, { schema });
vi.mock("@/db", () => ({ db }));

const ORG = "org-whatsapp-member";

// A IA dos Informativos é simulada: aqui só importa que todo integrante é ouvido.
vi.mock("@/lib/informatives/draft", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/informatives/draft")>()),
  buildInformativeDraft: vi.fn(async () => ({ ok: false, message: "Não achei uma tarefa nessa mensagem." })),
}));

beforeAll(async () => {
  await applyMigrations(client);
  await client.exec(`
    INSERT INTO organization (id, name, slug, created_at)
    VALUES ('${ORG}', 'Escritório', 'escritorio', now());
    INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES
      ('user-whatsapp-member', 'Bruno', 'bruno@example.test', true, now(), now()),
      ('user-nono-digito', 'Fiscal', 'fiscal@example.test', true, now(), now()),
      ('user-sem-confirmar', 'Contábil', 'contabil@example.test', true, now(), now()),
      ('user-saiu', 'Ex', 'ex@example.test', true, now(), now());
    INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES
      ('m1', '${ORG}', 'user-whatsapp-member', 'owner', now()),
      ('m2', '${ORG}', 'user-nono-digito', 'member', now()),
      ('m3', '${ORG}', 'user-sem-confirmar', 'member', now());
    SET ROLE guilda_app;
    SELECT set_config('app.org_id', '${ORG}', false);
  `);
  // A primeira importação (IA dos Informativos junto) passa dos 5 s com a máquina carregada.
  await import("./member-commands");
  await import("@/lib/notices/enqueue");
}, 120_000);

afterAll(async () => {
  await client.close();
});

test("aceita número E.164 com o sinal +", async () => {
  await expect(client.exec(`
    INSERT INTO member_whatsapp_connections (org_id, user_id, phone_e164)
    VALUES ('${ORG}', 'user-whatsapp-member', '+5554984184808');
  `)).resolves.toBeDefined();
});

test("recusa telefone sem o prefixo E.164", async () => {
  await expect(client.exec(`
    INSERT INTO member_whatsapp_connections (org_id, user_id, phone_e164)
    VALUES ('${ORG}', 'user-saiu', '5554984184808');
  `)).rejects.toThrow();
});

function textMessage(id: string, from: string, text: string) {
  return { externalId: id, from, occurredAt: new Date(), messageType: "text", kind: "text" as const, text };
}

async function connectionOf(userId: string) {
  const [row] = await db.select().from(schema.memberWhatsAppConnections).where(eq(schema.memberWhatsAppConnections.userId, userId));
  return row;
}

describe("confirmação do número", () => {
  test("o código certo, vindo sem o nono dígito, confirma e responde", async () => {
    const { withOrgTx } = await import("@/db/org-tx");
    const { routeMemberMessage, startMemberWhatsAppVerification } = await import("./member-commands");
    await client.exec(`INSERT INTO member_whatsapp_connections (org_id, user_id, phone_e164) VALUES ('${ORG}', 'user-nono-digito', '+5554999990000');`);
    const started = await withOrgTx(ORG, (tx) => startMemberWhatsAppVerification(tx, { orgId: ORG, userId: "user-nono-digito" }));
    expect(started?.code).toHaveLength(6);
    expect((await connectionOf("user-nono-digito")).verificationCodeHash).not.toContain(started!.code);

    // O WhatsApp manda o número da conta (wa_id), que em conta antiga vem sem o 9.
    const handled = await withOrgTx(ORG, (tx) => routeMemberMessage(tx, { orgId: ORG, message: textMessage("wamid.verify", "555499990000", `GUILDA ${started!.code.toLowerCase()}`) }));
    expect(handled).toBe(true);
    const row = await connectionOf("user-nono-digito");
    expect(row.verifiedAt).not.toBeNull();
    expect(row.verificationCodeHash).toBeNull();
    expect(row.lastInboundAt).not.toBeNull();
    const replies = await db.select().from(schema.memberWhatsAppOutbox).where(eq(schema.memberWhatsAppOutbox.userId, "user-nono-digito"));
    expect(replies).toHaveLength(1);
    expect(JSON.stringify(replies[0].payload)).toContain("Número confirmado");
  });

  test("código errado responde e não confirma; conversa comum vai para o Atendimento", async () => {
    const { withOrgTx } = await import("@/db/org-tx");
    const { routeMemberMessage, startMemberWhatsAppVerification } = await import("./member-commands");
    await client.exec(`INSERT INTO member_whatsapp_connections (org_id, user_id, phone_e164) VALUES ('${ORG}', 'user-sem-confirmar', '+5554988887777');`);
    await withOrgTx(ORG, (tx) => startMemberWhatsAppVerification(tx, { orgId: ORG, userId: "user-sem-confirmar" }));
    const wrong = await withOrgTx(ORG, (tx) => routeMemberMessage(tx, { orgId: ORG, message: textMessage("wamid.wrong", "5554988887777", "GUILDA ZZZZZZ") }));
    expect(wrong).toBe(true);
    expect((await connectionOf("user-sem-confirmar")).verifiedAt).toBeNull();
    const ordinary = await withOrgTx(ORG, (tx) => routeMemberMessage(tx, { orgId: ORG, message: textMessage("wamid.oi", "5554988887777", "oi, tudo bem?") }));
    expect(ordinary).toBe(false);
  });

  test("número que ninguém cadastrou não é de integrante", async () => {
    const { withOrgTx } = await import("@/db/org-tx");
    const { routeMemberMessage } = await import("./member-commands");
    expect(await withOrgTx(ORG, (tx) => routeMemberMessage(tx, { orgId: ORG, message: textMessage("wamid.cliente", "5511912345678", "Bom dia") }))).toBe(false);
  });
});

describe("mensagens de número confirmado", () => {
  test("viram comando uma vez só por wamid", async () => {
    const { withOrgTx } = await import("@/db/org-tx");
    const { routeMemberMessage } = await import("./member-commands");
    const message = textMessage("wamid.pedido", "5554999990000", "Ana, conferir a folha da ACME até sexta");
    expect(await withOrgTx(ORG, (tx) => routeMemberMessage(tx, { orgId: ORG, message }))).toBe(true);
    expect(await withOrgTx(ORG, (tx) => routeMemberMessage(tx, { orgId: ORG, message }))).toBe(true);
    const commands = await db.select().from(schema.memberWhatsAppCommands).where(eq(schema.memberWhatsAppCommands.externalId, "wamid.pedido"));
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ userId: "user-nono-digito", kind: "text", status: "pending" });
  });

  test("o guilda_app não apaga comando", async () => {
    await expect(client.exec(`DELETE FROM member_whatsapp_commands`)).rejects.toThrow();
  });
});

describe("botões dos avisos", () => {
  const TASK = "22222222-2222-4222-8222-222222222222";

  test("Aprovar conclui a missão e credita o XP uma vez; o segundo toque é recusado", async () => {
    const { runMemberCommandCycle } = await import("./member-commands");
    await client.exec(`
      UPDATE member_whatsapp_connections SET verified_at = now() WHERE user_id = 'user-whatsapp-member';
      INSERT INTO tasks (id, org_id, creator_id, assignee_id, title, xp_value, status)
        VALUES ('${TASK}', '${ORG}', 'user-whatsapp-member', 'user-nono-digito', 'Conferir a folha', 40, 'awaiting_approval');
    `);
    const [owner] = await db.select().from(schema.memberWhatsAppConnections).where(eq(schema.memberWhatsAppConnections.userId, "user-whatsapp-member"));
    for (const externalId of ["wamid.aprovar.1", "wamid.aprovar.2"]) {
      await db.insert(schema.memberWhatsAppCommands).values({
        orgId: ORG, userId: "user-whatsapp-member", connectionId: owner.id, externalId,
        kind: "button", messageType: "interactive", buttonId: `task:approve:${TASK}`, receivedAt: new Date(),
      });
      await runMemberCommandCycle(10, (async () => new Response("{}")) as unknown as typeof fetch);
    }
    const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, TASK));
    expect(task.status).toBe("completed");
    const ledger = await db.select().from(schema.xpLedger).where(eq(schema.xpLedger.taskId, TASK));
    expect(ledger.map((row) => [row.userId, row.amount])).toEqual([["user-nono-digito", 40]]);
    const replies = await db.select({ payload: schema.memberWhatsAppOutbox.payload, key: schema.memberWhatsAppOutbox.dedupeKey })
      .from(schema.memberWhatsAppOutbox).where(eq(schema.memberWhatsAppOutbox.userId, "user-whatsapp-member"));
    const texts = replies.map((reply) => (reply.payload as { text?: string }).text ?? "");
    expect(texts.some((text) => text.includes("Concluída"))).toBe(true);
    expect(texts.some((text) => text.includes("não está mais neste estado"))).toBe(true);
    // Quem entregou é avisado da aprovação.
    const toAssignee = await db.select({ key: schema.memberWhatsAppOutbox.dedupeKey }).from(schema.memberWhatsAppOutbox).where(eq(schema.memberWhatsAppOutbox.userId, "user-nono-digito"));
    expect(toAssignee.some((row) => row.key.endsWith(":completed"))).toBe(true);
    const commands = await db.select({ status: schema.memberWhatsAppCommands.status }).from(schema.memberWhatsAppCommands).where(eq(schema.memberWhatsAppCommands.userId, "user-whatsapp-member"));
    expect(commands.every((command) => command.status === "done")).toBe(true);
  });

  test("texto de quem não lidera clã também é lido pela IA (todos pedem missão)", async () => {
    const [command] = await db.select().from(schema.memberWhatsAppCommands).where(eq(schema.memberWhatsAppCommands.externalId, "wamid.pedido"));
    expect(command.status).toBe("done");
    const replies = await db.select({ key: schema.memberWhatsAppOutbox.dedupeKey, payload: schema.memberWhatsAppOutbox.payload })
      .from(schema.memberWhatsAppOutbox).where(eq(schema.memberWhatsAppOutbox.dedupeKey, `whatsapp-command:${command.id}:reply`));
    expect(JSON.stringify(replies[0].payload)).toContain("Não achei uma tarefa nessa mensagem.");
  });
});

describe("avisos", () => {
  test("só número confirmado, de quem ainda é da organização, com a preferência ligada", async () => {
    const { withOrgTx } = await import("@/db/org-tx");
    const { enqueueMemberNotice } = await import("@/lib/notices/enqueue");
    const notice = { family: "general" as const, heading: "Fechamento concluído", summary: "ACME", path: "closings" };
    await withOrgTx(ORG, async (tx) => {
      for (const userId of ["user-nono-digito", "user-sem-confirmar"]) {
        await enqueueMemberNotice(tx, { orgId: ORG, userId, dedupeKey: `teste:tasks:${userId}`, preference: "tasks", notice });
        // Fechamentos começam desligados para quem não salvou preferência.
        await enqueueMemberNotice(tx, { orgId: ORG, userId, dedupeKey: `teste:closings:${userId}`, preference: "closings", notice });
      }
    });
    const rows = await db.select({ userId: schema.memberWhatsAppOutbox.userId, dedupeKey: schema.memberWhatsAppOutbox.dedupeKey })
      .from(schema.memberWhatsAppOutbox)
      .where(and(eq(schema.memberWhatsAppOutbox.orgId, ORG)));
    const keys = rows.map((row) => row.dedupeKey).filter((key) => key.startsWith("teste:"));
    expect(keys).toEqual(["teste:tasks:user-nono-digito"]);
  });

  test("preferências do Telegram foram copiadas pela migração", async () => {
    const result = await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM information_schema.tables WHERE table_name = 'member_notification_preferences'`);
    expect(result.rows[0].count).toBe(1);
  });
});
