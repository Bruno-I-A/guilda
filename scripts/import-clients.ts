/**
 * Carga de empresas-cliente via CSV (Fase 5a).
 *
 * Uso: npm run import:clients -- caminho/arquivo.csv --org <slug>
 * Formato: nome;cnpj;regime  (cabeçalho opcional; cnpj pode ficar vazio;
 * regime aceita mei/simples/presumido/association/real ou os rótulos humanos)
 *
 * Idempotente: upsert por CNPJ (sem CNPJ, casa por nome exato). Reimportar
 * o mesmo arquivo não duplica nada. Relatório no console ao final.
 */
import "./load-env";

import { readFileSync } from "node:fs";
import { and, eq, isNull } from "drizzle-orm";

import { db } from "../src/db";
import { withOrgTx } from "../src/db/org-tx";
import * as schema from "../src/db/schema";
import { parseClientCsvLine } from "../src/lib/clients-csv";

function fail(message: string): never {
  console.error(`ERRO: ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const orgFlag = args.indexOf("--org");
if (orgFlag === -1 || !args[orgFlag + 1]) {
  fail("informe a organização: npm run import:clients -- arquivo.csv --org <slug>");
}
const orgSlug = args[orgFlag + 1];
const csvPath = args.find((a, i) => i !== orgFlag && i !== orgFlag + 1 && !a.startsWith("--"));
if (!csvPath) {
  fail("informe o arquivo: npm run import:clients -- arquivo.csv --org <slug>");
}

async function main() {
  const org = await db.query.organization.findFirst({
    where: eq(schema.organization.slug, orgSlug),
  });
  if (!org) fail(`organização com slug "${orgSlug}" não encontrada`);

  let content: string;
  try {
    content = readFileSync(csvPath!, "utf8");
  } catch {
    fail(`não consegui ler o arquivo "${csvPath}"`);
  }

  const lines = content.split(/\r?\n/);
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const rejected: string[] = [];

  await withOrgTx(org.id, async (tx) => {
    for (let i = 0; i < lines.length; i++) {
      const result = parseClientCsvLine(lines[i]);
      if (result.kind === "skip") continue;
      if (result.kind === "error") {
        rejected.push(`linha ${i + 1}: ${result.error}`);
        continue;
      }
      const { name, cnpj, taxRegime } = result.row;

      // Chave de dedup: CNPJ quando presente; senão, nome exato (sem CNPJ).
      const existing = cnpj
        ? await tx.query.clients.findFirst({
            where: and(
              eq(schema.clients.orgId, org.id),
              eq(schema.clients.cnpj, cnpj),
            ),
          })
        : await tx.query.clients.findFirst({
            where: and(
              eq(schema.clients.orgId, org.id),
              eq(schema.clients.name, name),
              isNull(schema.clients.cnpj),
            ),
          });

      if (!existing) {
        await tx.insert(schema.clients).values({
          orgId: org.id,
          name,
          taxRegime,
          cnpj: cnpj ?? null,
        });
        created++;
      } else if (existing.name !== name || existing.taxRegime !== taxRegime) {
        await tx
          .update(schema.clients)
          .set({ name, taxRegime })
          .where(eq(schema.clients.id, existing.id));
        updated++;
      } else {
        unchanged++;
      }
    }
  });

  console.log(`Importação concluída para "${org.name}" (${orgSlug}):`);
  console.log(`  criadas:      ${created}`);
  console.log(`  atualizadas:  ${updated}`);
  console.log(`  sem mudança:  ${unchanged}`);
  console.log(`  rejeitadas:   ${rejected.length}`);
  for (const reason of rejected) console.log(`    - ${reason}`);
  process.exit(rejected.length > 0 ? 2 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
