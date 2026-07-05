import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import * as schema from "@/db/schema";

/** Membros da organização (tabelas do better-auth — sem RLS). */
export async function listOrgMembers(orgId: string) {
  return db
    .select({
      userId: schema.member.userId,
      role: schema.member.role,
      name: schema.user.name,
      email: schema.user.email,
    })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
    .where(eq(schema.member.organizationId, orgId))
    .orderBy(schema.user.name);
}
