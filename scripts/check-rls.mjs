import { readFileSync } from "node:fs";
import pg from "pg";

// Lê a DATABASE_URL do .env: é o role guilda_app (NAO-superuser), o unico
// para o qual o RLS realmente se aplica.
const env = readFileSync(".env", "utf8");
const url = env.match(/^DATABASE_URL=(.+)$/m)[1].trim();

const client = new pg.Client({ connectionString: url });
await client.connect();

const NEW_TABLES = [
  "task_assignee_suggestions",
  "guild_notices",
  "guild_notice_reads",
  "informatives",
];

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "  OK  " : " FALHA"} ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failures += 1;
};

console.log("\n== 1. RLS habilitado e forcado nas tabelas novas ==");
const rls = await client.query(
  `SELECT relname, relrowsecurity, relforcerowsecurity
     FROM pg_class WHERE relname = ANY($1)`,
  [NEW_TABLES],
);
for (const t of NEW_TABLES) {
  const row = rls.rows.find((r) => r.relname === t);
  check(t, Boolean(row?.relrowsecurity && row?.relforcerowsecurity),
    row ? `enabled=${row.relrowsecurity} forced=${row.relforcerowsecurity}` : "tabela ausente");
}

console.log("\n== 2. Politica org_isolation presente ==");
const pol = await client.query(
  `SELECT tablename FROM pg_policies
    WHERE policyname = 'org_isolation' AND tablename = ANY($1)`,
  [NEW_TABLES],
);
for (const t of NEW_TABLES) {
  check(t, pol.rows.some((r) => r.tablename === t));
}

console.log("\n== 3. Confirmacao de leitura e imutavel por PRIVILEGIO ==");
const priv = await client.query(
  `SELECT privilege_type FROM information_schema.role_table_grants
    WHERE table_name = 'guild_notice_reads' AND grantee = current_user`,
);
const granted = priv.rows.map((r) => r.privilege_type);
check("SELECT concedido", granted.includes("SELECT"), granted.join(","));
check("INSERT concedido", granted.includes("INSERT"));
check("UPDATE revogado", !granted.includes("UPDATE"));
check("DELETE revogado", !granted.includes("DELETE"));

console.log("\n== 4. Isolamento entre tenants (tudo com ROLLBACK) ==");
const org = await client.query(`SELECT id FROM organization LIMIT 1`);
const orgId = org.rows[0].id;
const usr = await client.query(
  `SELECT user_id FROM member WHERE organization_id = $1 LIMIT 1`, [orgId]);
const userId = usr.rows[0].user_id;
const OTHER = "00000000-0000-4000-8000-000000000999";

await client.query("BEGIN");
try {
  await client.query(`SELECT set_config('app.org_id', $1, true)`, [orgId]);
  const ins = await client.query(
    `INSERT INTO guild_notices (org_id, author_id, kind, title, body)
     VALUES ($1,$2,'notice','RLS probe','corpo') RETURNING id`,
    [orgId, userId],
  );
  check("insere no proprio tenant", ins.rowCount === 1);

  const mine = await client.query(`SELECT id FROM guild_notices WHERE id = $1`, [ins.rows[0].id]);
  check("le no proprio tenant", mine.rowCount === 1);

  // Troca o tenant da sessao: a linha tem de sumir.
  await client.query(`SELECT set_config('app.org_id', $1, true)`, [OTHER]);
  const foreign = await client.query(`SELECT id FROM guild_notices WHERE id = $1`, [ins.rows[0].id]);
  check("linha do outro tenant fica INVISIVEL", foreign.rowCount === 0,
    `viu ${foreign.rowCount} linha(s)`);

  // Tentar gravar com org_id alheio deve bater no WITH CHECK.
  let blocked = false;
  try {
    await client.query(
      `INSERT INTO guild_notices (org_id, author_id, kind, title, body)
       VALUES ($1,$2,'notice','invasao','corpo')`,
      [orgId, userId],
    );
  } catch {
    blocked = true;
  }
  check("gravar em tenant alheio e BLOQUEADO", blocked);
} finally {
  await client.query("ROLLBACK");
}

await client.end();
console.log(failures === 0 ? "\nTODAS AS CHECAGENS PASSARAM\n" : `\n${failures} FALHA(S)\n`);
process.exit(failures === 0 ? 0 : 1);
