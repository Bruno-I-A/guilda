import { existsSync, readFileSync } from "node:fs";
import pg from "pg";

// Lê a DATABASE_URL do .env: é o role guilda_app (NAO-superuser), o unico
// para o qual o RLS realmente se aplica.
const env = existsSync(".env") ? readFileSync(".env", "utf8") : "";
const url = process.env.DATABASE_URL ?? env.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
if (!url) throw new Error("Defina DATABASE_URL ou crie um arquivo .env.");

const client = new pg.Client({ connectionString: url });
await client.connect();

const NEW_TABLES = [
  "task_assignee_suggestions",
  "guild_notices",
  "guild_notice_reads",
  "informatives",
  "fiscal_portfolios",
  "fiscal_portfolio_events",
  "clan_campaigns",
  "client_commitments",
  "client_commitment_periods",
  "fiscal_client_profiles",
  "fiscal_client_profile_events",
  "fiscal_client_aliases",
  "fiscal_import_batches",
  "fiscal_import_rows",
  "fiscal_control_periods",
  "fiscal_control_events",
  "office_fee_profiles",
  "office_fee_profile_events",
  "office_fee_control_periods",
  "office_fee_control_events",
];

const APPEND_ONLY_TABLES = [
  "guild_notice_reads",
  "fiscal_portfolio_events",
  "fiscal_client_profile_events",
  "fiscal_control_events",
  "office_fee_profile_events",
  "office_fee_control_events",
];

const SPLIT_POLICY_TABLES = new Set([
  "fiscal_portfolio_events",
  "fiscal_client_profile_events",
  "fiscal_control_events",
  "office_fee_profile_events",
  "office_fee_control_events",
]);

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

console.log("\n== 2. Politicas de isolamento presentes ==");
const pol = await client.query(
  `SELECT tablename, policyname FROM pg_policies
    WHERE tablename = ANY($1)`,
  [NEW_TABLES],
);
for (const t of NEW_TABLES) {
  const policies = pol.rows
    .filter((r) => r.tablename === t)
    .map((r) => r.policyname);
  const ok = SPLIT_POLICY_TABLES.has(t)
    ? policies.includes("org_isolation_select") && policies.includes("org_isolation_insert")
    : policies.includes("org_isolation");
  check(t, ok, policies.join(","));
}

console.log("\n== 3. Historicos imutaveis por PRIVILEGIO ==");
for (const table of APPEND_ONLY_TABLES) {
  const priv = await client.query(
    `SELECT privilege_type FROM information_schema.role_table_grants
      WHERE table_name = $1 AND grantee = current_user`,
    [table],
  );
  const granted = priv.rows.map((r) => r.privilege_type);
  check(`${table}: SELECT`, granted.includes("SELECT"), granted.join(","));
  check(`${table}: INSERT`, granted.includes("INSERT"));
  check(`${table}: UPDATE revogado`, !granted.includes("UPDATE"));
  check(`${table}: DELETE revogado`, !granted.includes("DELETE"));
}

console.log("\n== 4. Isolamento entre tenants (tudo com ROLLBACK) ==");
const organizations = await client.query(`SELECT id FROM organization ORDER BY created_at`);
let orgId;
for (const candidate of organizations.rows) {
  await client.query(`SELECT set_config('app.org_id', $1, false)`, [candidate.id]);
  const profile = await client.query(`SELECT id FROM fiscal_client_profiles LIMIT 1`);
  const member = await client.query(
    `SELECT user_id FROM member WHERE organization_id = $1 LIMIT 1`,
    [candidate.id],
  );
  if (profile.rowCount > 0 && member.rowCount > 0) {
    orgId = candidate.id;
    break;
  }
}
if (!orgId) throw new Error("Nenhuma organização com ficha fiscal e integrante foi encontrada.");
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
  await client.query("SAVEPOINT foreign_insert_probe");
  try {
    await client.query(
      `INSERT INTO guild_notices (org_id, author_id, kind, title, body)
       VALUES ($1,$2,'notice','invasao','corpo')`,
      [orgId, userId],
    );
  } catch {
    blocked = true;
    await client.query("ROLLBACK TO SAVEPOINT foreign_insert_probe");
  }
  await client.query("RELEASE SAVEPOINT foreign_insert_probe");
  check("gravar em tenant alheio e BLOQUEADO", blocked);

  await client.query(`SELECT set_config('app.org_id', $1, true)`, [orgId]);
  const fiscalMine = await client.query(`SELECT id FROM fiscal_client_profiles`);
  check("fichas fiscais visiveis no proprio tenant", fiscalMine.rowCount > 0,
    `viu ${fiscalMine.rowCount} ficha(s)`);

  const control = await client.query(
    `INSERT INTO fiscal_control_periods (
       org_id, client_id, period_year, period_month, profile_id, profile_version,
       profile_snapshot, tax_regime_snapshot, movements_status, incoming_status,
       outgoing_status, guide_status, nfs_status, delivery_status, status,
       created_by, updated_by
     )
     SELECT p.org_id, p.client_id, 2100, 12, p.id, p.version,
            jsonb_build_object('version', p.version), c.tax_regime,
            'pending', 'pending', 'pending', 'pending', 'pending', 'pending',
            'not_started', $1, $1
       FROM fiscal_client_profiles AS p
       INNER JOIN clients AS c ON c.org_id = p.org_id AND c.id = p.client_id
      LIMIT 1
     RETURNING id`,
    [userId],
  );

  let profileSyncBeforeStartAllowed = false;
  await client.query("SAVEPOINT profile_sync_before_start_probe");
  try {
    const synced = await client.query(
      `UPDATE fiscal_control_periods
          SET profile_version = profile_version + 1,
              profile_snapshot = jsonb_build_object('version', profile_version + 1)
        WHERE id = $1`,
      [control.rows[0].id],
    );
    profileSyncBeforeStartAllowed = synced.rowCount === 1;
  } catch {
    await client.query("ROLLBACK TO SAVEPOINT profile_sync_before_start_probe");
  }
  await client.query("RELEASE SAVEPOINT profile_sync_before_start_probe");
  check("ficha pode sincronizar antes do inicio", profileSyncBeforeStartAllowed);

  await client.query(
    `UPDATE fiscal_control_periods
        SET movements_status = 'completed', status = 'in_progress'
      WHERE id = $1`,
    [control.rows[0].id],
  );

  let snapshotBlockedAfterStart = false;
  await client.query("SAVEPOINT immutable_snapshot_after_start_probe");
  try {
    await client.query(
      `UPDATE fiscal_control_periods
          SET profile_version = profile_version + 1,
              profile_snapshot = jsonb_build_object('version', profile_version + 1)
        WHERE id = $1`,
      [control.rows[0].id],
    );
  } catch {
    snapshotBlockedAfterStart = true;
    await client.query("ROLLBACK TO SAVEPOINT immutable_snapshot_after_start_probe");
  }
  await client.query("RELEASE SAVEPOINT immutable_snapshot_after_start_probe");
  check("snapshot mensal imutavel apos inicio", snapshotBlockedAfterStart);

  const operationalUpdate = await client.query(
    `UPDATE fiscal_control_periods
        SET monthly_notes = 'alteracao operacional permitida'
      WHERE id = $1`,
    [control.rows[0].id],
  );
  check("andamento mensal pode ser atualizado", operationalUpdate.rowCount === 1);

  // O controle de honorários tem o mesmo contrato: o retrato da empresa e
  // da regra mensal não pode mudar, mas a observação operacional continua
  // editável. O teste roda inteiramente dentro do ROLLBACK desta auditoria.
  let [officeProfile] = (
    await client.query(
      `SELECT id FROM office_fee_profiles
        WHERE org_id = $1
        LIMIT 1`,
      [orgId],
    )
  ).rows;
  if (!officeProfile) {
    const createdOfficeProfile = await client.query(
      `INSERT INTO office_fee_profiles (
         org_id, client_id, billing_method, charges_additional_installment,
         monthly_fee, created_by, updated_by
       )
       SELECT p.org_id, p.client_id, 'asaas', false, 1, $1, $1
         FROM fiscal_client_profiles AS p
        WHERE p.org_id = $2
        LIMIT 1
       RETURNING id`,
      [userId, orgId],
    );
    [officeProfile] = createdOfficeProfile.rows;
  }
  const officeControl = await client.query(
    `INSERT INTO office_fee_control_periods (
       org_id, client_id, period_year, period_month,
       client_name_snapshot, client_cnpj_snapshot,
       profile_id, profile_version, profile_snapshot, responsible_user_id,
       invoice_status, additional_installment_status, collection_status,
       status, created_by, updated_by
     )
     SELECT p.org_id, p.client_id, 2100, 11,
            c.name, c.cnpj,
            p.id, p.version,
            jsonb_build_object('version', p.version), NULL,
            'pending', 'not_applicable', 'pending',
            'not_started', $1, $1
       FROM office_fee_profiles AS p
       INNER JOIN clients AS c ON c.org_id = p.org_id AND c.id = p.client_id
      WHERE p.id = $2
     RETURNING id`,
    [userId, officeProfile.id],
  );
  let officeSnapshotBlocked = false;
  await client.query("SAVEPOINT immutable_office_fee_snapshot_probe");
  try {
    await client.query(
      `UPDATE office_fee_control_periods
          SET client_name_snapshot = 'nao deve alterar'
        WHERE id = $1`,
      [officeControl.rows[0].id],
    );
  } catch {
    officeSnapshotBlocked = true;
    await client.query("ROLLBACK TO SAVEPOINT immutable_office_fee_snapshot_probe");
  }
  await client.query("RELEASE SAVEPOINT immutable_office_fee_snapshot_probe");
  check("snapshot mensal de honorários e IMUTAVEL", officeSnapshotBlocked);

  const officeOperationalUpdate = await client.query(
    `UPDATE office_fee_control_periods
        SET monthly_notes = 'alteracao operacional permitida'
      WHERE id = $1`,
    [officeControl.rows[0].id],
  );
  check("andamento de honorários pode ser atualizado", officeOperationalUpdate.rowCount === 1);

  const campaign = await client.query(
    `INSERT INTO clan_campaigns (
       org_id, clan_id, name, period_year, period_month, created_by
     )
     SELECT $1, id, 'RLS probe fiscal', 2100, 12, $2
       FROM clans
      WHERE org_id = $1 AND active = true
      LIMIT 1
     RETURNING id`,
    [orgId, userId],
  );
  const campaignLink = await client.query(
    `UPDATE fiscal_control_periods
        SET campaign_id = $1
      WHERE id = $2`,
    [campaign.rows[0].id, control.rows[0].id],
  );
  check("campanha pode adotar competencia existente", campaignLink.rowCount === 1);

  await client.query(`SELECT set_config('app.org_id', $1, true)`, [OTHER]);
  const fiscalForeign = await client.query(`SELECT id FROM fiscal_client_profiles`);
  check("fichas fiscais do outro tenant ficam INVISIVEIS", fiscalForeign.rowCount === 0,
    `viu ${fiscalForeign.rowCount} ficha(s)`);
} finally {
  await client.query("ROLLBACK");
}

await client.end();
console.log(failures === 0 ? "\nTODAS AS CHECAGENS PASSARAM\n" : `\n${failures} FALHA(S)\n`);
process.exit(failures === 0 ? 0 : 1);
