import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";

import type { Db } from "@/db";
import * as schema from "@/db/schema";

export type AuthDatabase = Db;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function retiredEmail(userId: string): string {
  const fingerprint = createHash("sha256").update(userId).digest("hex");
  return `removed-${fingerprint}@guilda.invalid`;
}

async function retireOrphanedUser(
  database: AuthDatabase,
  selector: { email: string } | { userId: string },
): Promise<boolean> {
  return database.transaction(async (tx) => {
    const condition =
      "email" in selector
        ? eq(schema.user.email, normalizeEmail(selector.email))
        : eq(schema.user.id, selector.userId);

    const [target] = await tx
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(condition)
      .limit(1)
      .for("update");

    if (!target) return false;

    const [membership] = await tx
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(eq(schema.member.userId, target.id))
      .limit(1);

    if (membership) return false;

    await tx
      .delete(schema.session)
      .where(eq(schema.session.userId, target.id));
    await tx
      .delete(schema.account)
      .where(eq(schema.account.userId, target.id));
    await tx
      .update(schema.user)
      .set({
        email: retiredEmail(target.id),
        emailVerified: false,
        mustChangePassword: false,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.user.id, target.id),
          "email" in selector
            ? eq(schema.user.email, normalizeEmail(selector.email))
            : eq(schema.user.id, target.id),
        ),
      );

    return true;
  });
}

export function releaseOrphanedUserEmailInDb(
  database: AuthDatabase,
  email: string,
): Promise<boolean> {
  return retireOrphanedUser(database, { email });
}

export function retireUserIfOrphanedInDb(
  database: AuthDatabase,
  userId: string,
): Promise<boolean> {
  return retireOrphanedUser(database, { userId });
}
