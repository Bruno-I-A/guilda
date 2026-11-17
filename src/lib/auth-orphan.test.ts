import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import * as schema from "@/db/schema";
import {
  releaseOrphanedUserEmailInDb,
  retireUserIfOrphanedInDb,
  revokeOrganizationSessionsInDb,
  type AuthDatabase,
} from "@/lib/auth-orphan-db";
import { applyMigrations } from "@/lib/nfse/testing/pglite";

const originalEmail = "financeiro@example.com";

describe("liberação de e-mail de usuário removido", () => {
  const client = new PGlite();
  const database = drizzle(client, { schema });
  const authDatabase = database as unknown as AuthDatabase;

  beforeAll(async () => {
    await applyMigrations(client);
  }, 30_000);

  beforeEach(async () => {
    await client.exec(`
      DELETE FROM "session";
      DELETE FROM "account";
      DELETE FROM "member";
      DELETE FROM "organization";
      DELETE FROM "user";
    `);
  });

  afterAll(async () => {
    await client.close();
  });

  test("preserva a identidade antiga e libera o e-mail para uma nova pessoa", async () => {
    const now = new Date();
    await database.insert(schema.user).values({
      id: "old-user",
      name: "Pessoa antiga",
      email: originalEmail,
      emailVerified: true,
      mustChangePassword: true,
    });
    await database.insert(schema.account).values({
      id: "old-account",
      accountId: "old-user",
      providerId: "credential",
      userId: "old-user",
      password: "hash-antigo",
    });
    await database.insert(schema.session).values({
      id: "old-session",
      token: "token-antigo",
      userId: "old-user",
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      releaseOrphanedUserEmailInDb(authDatabase, originalEmail),
    ).resolves.toBe(true);

    const oldUser = await database.query.user.findFirst({
      where: (user, { eq }) => eq(user.id, "old-user"),
    });
    expect(oldUser).toMatchObject({
      id: "old-user",
      name: "Pessoa antiga",
      emailVerified: false,
      mustChangePassword: false,
    });
    expect(oldUser?.email).toMatch(
      /^removed-[a-f0-9]{64}@guilda\.invalid$/,
    );
    expect(
      await database.query.account.findMany({
        where: (account, { eq }) => eq(account.userId, "old-user"),
      }),
    ).toHaveLength(0);
    expect(
      await database.query.session.findMany({
        where: (session, { eq }) => eq(session.userId, "old-user"),
      }),
    ).toHaveLength(0);

    await expect(
      database.insert(schema.user).values({
        id: "new-user",
        name: "Pessoa nova",
        email: originalEmail,
      }),
    ).resolves.toBeDefined();
  });

  test("não libera o e-mail de quem ainda pertence a uma organização", async () => {
    await database.insert(schema.user).values({
      id: "active-user",
      name: "Pessoa ativa",
      email: originalEmail,
    });
    await database.insert(schema.organization).values({
      id: "org-1",
      name: "Organização",
      slug: "organizacao",
      createdAt: new Date(),
    });
    await database.insert(schema.member).values({
      id: "member-1",
      organizationId: "org-1",
      userId: "active-user",
      role: "member",
      createdAt: new Date(),
    });
    await database.insert(schema.account).values({
      id: "active-account",
      accountId: "active-user",
      providerId: "credential",
      userId: "active-user",
      password: "hash-ativo",
    });

    await expect(
      releaseOrphanedUserEmailInDb(authDatabase, originalEmail),
    ).resolves.toBe(false);

    const activeUser = await database.query.user.findFirst({
      where: (user, { eq }) => eq(user.id, "active-user"),
    });
    expect(activeUser?.email).toBe(originalEmail);
    expect(
      await database.query.account.findMany({
        where: (account, { eq }) => eq(account.userId, "active-user"),
      }),
    ).toHaveLength(1);
  });

  test("remoção derruba só as sessões que apontam para a organização de onde a pessoa saiu", async () => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60_000);
    await database.insert(schema.user).values({
      id: "two-orgs-user",
      name: "Pessoa com duas organizações",
      email: originalEmail,
    });
    await database.insert(schema.organization).values([
      { id: "org-office", name: "Escritório", slug: "escritorio", createdAt: now },
      { id: "org-own", name: "Própria", slug: "propria", createdAt: now },
    ]);
    await database.insert(schema.member).values({
      id: "member-own",
      organizationId: "org-own",
      userId: "two-orgs-user",
      role: "owner",
      createdAt: now,
    });
    await database.insert(schema.session).values([
      { id: "s-office-1", token: "t-office-1", userId: "two-orgs-user", activeOrganizationId: "org-office", expiresAt, createdAt: now, updatedAt: now },
      { id: "s-office-2", token: "t-office-2", userId: "two-orgs-user", activeOrganizationId: "org-office", expiresAt, createdAt: now, updatedAt: now },
      { id: "s-own", token: "t-own", userId: "two-orgs-user", activeOrganizationId: "org-own", expiresAt, createdAt: now, updatedAt: now },
      { id: "s-none", token: "t-none", userId: "two-orgs-user", activeOrganizationId: null, expiresAt, createdAt: now, updatedAt: now },
    ]);

    // Ainda tem a organização própria: a aposentadoria não age...
    await expect(retireUserIfOrphanedInDb(authDatabase, "two-orgs-user")).resolves.toBe(false);
    // ...então são as sessões do escritório que precisam cair.
    await expect(
      revokeOrganizationSessionsInDb(authDatabase, "two-orgs-user", "org-office"),
    ).resolves.toBe(2);

    const remaining = await database.query.session.findMany({
      where: (session, { eq }) => eq(session.userId, "two-orgs-user"),
    });
    expect(remaining.map((session) => session.id).sort()).toEqual(["s-none", "s-own"]);
  });

  test("a remoção do último vínculo libera as credenciais pelo userId", async () => {
    await database.insert(schema.user).values({
      id: "removed-user",
      name: "Pessoa removida",
      email: originalEmail,
    });
    await database.insert(schema.account).values({
      id: "removed-account",
      accountId: "removed-user",
      providerId: "credential",
      userId: "removed-user",
      password: "hash-antigo",
    });

    await expect(
      retireUserIfOrphanedInDb(authDatabase, "removed-user"),
    ).resolves.toBe(true);

    const removedUser = await database.query.user.findFirst({
      where: (user, { eq }) => eq(user.id, "removed-user"),
    });
    expect(removedUser?.email).not.toBe(originalEmail);
    expect(
      await database.query.account.findMany({
        where: (account, { eq }) => eq(account.userId, "removed-user"),
      }),
    ).toHaveLength(0);
  });
});
