import { defineConfig } from "drizzle-kit";

// drizzle-kit não carrega .env sozinho; Node 22 tem loadEnvFile nativo.
try {
  process.loadEnvFile(".env");
} catch {
  // sem .env (ex.: CI) — as variáveis já devem estar no ambiente
}

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  throw new Error("MIGRATION_DATABASE_URL (ou DATABASE_URL) não definida");
}

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
