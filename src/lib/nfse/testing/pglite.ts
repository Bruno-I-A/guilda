import { readFileSync } from "node:fs";
import path from "node:path";

import type { PGlite } from "@electric-sql/pglite";

/**
 * Prepara um PGlite como os ambientes reais: role guilda_app com os default
 * privileges (docker/dev/init/01-roles.sql) e todas as migrações. Depois do
 * seed, o teste roda `SET ROLE guilda_app;`.
 */
export async function applyMigrations(client: PGlite): Promise<void> {
  const dir = path.resolve(process.cwd(), "src/db/migrations");
  const journal = JSON.parse(readFileSync(path.join(dir, "meta/_journal.json"), "utf8")) as {
    entries: { tag: string }[];
  };
  await client.exec(`
    CREATE ROLE guilda_app NOLOGIN NOSUPERUSER;
    GRANT USAGE ON SCHEMA public TO guilda_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO guilda_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO guilda_app;
  `);
  for (const entry of journal.entries) {
    for (const statement of readFileSync(path.join(dir, `${entry.tag}.sql`), "utf8").split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }
}
