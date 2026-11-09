import pg from "pg";

try {
  process.loadEnvFile(".env");
} catch {
  // CI e containers recebem as variáveis pelo ambiente.
}

const connectionString =
  process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("Banco não configurado");

const expectedTables = [
  "support_contacts",
  "support_conversation_events",
  "support_conversation_notes",
  "support_ai_runs",
  "support_conversations",
  "support_inbound_events",
  "support_message_events",
  "support_messages",
  "support_outbox",
  "support_whatsapp_channels",
];
const expectedFunctions = [
  "claim_support_inbound_events",
  "claim_support_outbox",
  "finish_support_inbound_event",
  "finish_support_outbox",
  "lookup_support_whatsapp_channel",
];

const client = new pg.Client({ connectionString });
await client.connect();
try {
  const tables = await client.query(`
    SELECT relname, relrowsecurity, relforcerowsecurity
    FROM pg_class
    WHERE relname = ANY($1::text[]) AND relkind = 'r'
    ORDER BY relname
  `, [expectedTables]);
  const functions = await client.query(`
    SELECT proname
    FROM pg_proc
    WHERE proname = ANY($1::text[])
    ORDER BY proname
  `, [expectedFunctions]);
  const grants = await client.query(`
    SELECT
      has_table_privilege('guilda_app', 'support_messages', 'select') AS msg_select,
      has_table_privilege('guilda_app', 'support_messages', 'update') AS msg_update,
      has_table_privilege('guilda_app', 'support_messages', 'delete') AS msg_delete,
      has_column_privilege('guilda_app', 'support_inbound_events', 'status', 'update') AS inbound_status_update,
      has_column_privilege('guilda_app', 'support_inbound_events', 'payload', 'update') AS inbound_payload_update
  `);

  const missingTables = expectedTables.filter(
    (name) => !tables.rows.some((row) => row.relname === name),
  );
  const unsafeRls = tables.rows.filter(
    (row) => !row.relrowsecurity || !row.relforcerowsecurity,
  );
  const foundFunctions = new Set(functions.rows.map((row) => row.proname));
  const missingFunctions = expectedFunctions.filter((name) => !foundFunctions.has(name));
  const permissions = grants.rows[0];

  if (
    missingTables.length ||
    unsafeRls.length ||
    missingFunctions.length ||
    !permissions.msg_select ||
    permissions.msg_update ||
    permissions.msg_delete ||
    !permissions.inbound_status_update ||
    permissions.inbound_payload_update
  ) {
    throw new Error(JSON.stringify({ missingTables, unsafeRls, missingFunctions, permissions }));
  }

  console.log(
    `Schema de atendimento verificado: ${tables.rows.length} tabelas com FORCE RLS, ` +
      `${functions.rows.length} funções e histórico append-only.`,
  );
} finally {
  await client.end();
}
