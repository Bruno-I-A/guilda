import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

// A aplicação conecta com o role dedicado NÃO-superuser (guilda_app):
// é isso que faz o Row Level Security valer de fato (RLS não se aplica
// ao owner das tabelas nem a superuser sem FORCE).
function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL não definida");
  }
  return new Pool({ connectionString, max: 10 });
}

// Cache global para não vazar conexões no hot-reload do dev server.
const globalForDb = globalThis as unknown as { __guildaPool?: Pool };

const pool = globalForDb.__guildaPool ?? createPool();
if (process.env.NODE_ENV !== "production") {
  globalForDb.__guildaPool = pool;
}

export const db: NodePgDatabase<typeof schema> = drizzle(pool, { schema });

export type Db = typeof db;
