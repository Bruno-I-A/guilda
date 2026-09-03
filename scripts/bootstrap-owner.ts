import "./load-env";

import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";

import { db } from "../src/db";
import * as schema from "../src/db/schema";
import { createUserWithPassword } from "../src/lib/auth-admin";
import { orgSlug } from "../src/lib/slug";

/**
 * Cria o PRIMEIRO dono de uma instância — a única forma de entrar num banco
 * vazio, já que o autocadastro está desligado (`disableSignUp` em auth.ts).
 *
 * Não é rota, não é tela: roda quem tem acesso ao servidor. É a diferença
 * entre uma escotilha de emergência e uma porta aberta na internet.
 *
 * A trava é a instância estar vazia. Com qualquer usuário já existente, este
 * script recusa e manda usar a tela de Membros — que exige admin/owner logado.
 * Assim ele não vira um jeito silencioso de fabricar contas num sistema em uso.
 *
 * Uso:
 *   npm run bootstrap:owner -- --nome "Bruno" --email bruno@x.com --org "Shift"
 * A senha é lida de BOOTSTRAP_PASSWORD, para não ficar no histórico do shell.
 */

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const nome = arg("nome");
  const email = arg("email");
  const org = arg("org");
  const senha = process.env.BOOTSTRAP_PASSWORD;

  const faltando = [
    !nome && "--nome",
    !email && "--email",
    !org && "--org",
    !senha && "BOOTSTRAP_PASSWORD (variável de ambiente)",
  ].filter(Boolean);
  if (faltando.length > 0) {
    console.error(`Faltou: ${faltando.join(", ")}`);
    console.error(
      'Ex.: BOOTSTRAP_PASSWORD=... npm run bootstrap:owner -- --nome "Bruno" --email b@x.com --org "Shift"',
    );
    process.exit(1);
  }
  if (senha!.length < 8) {
    console.error("A senha precisa de pelo menos 8 caracteres (mesma régua do better-auth).");
    process.exit(1);
  }

  // A trava: instância vazia. Contar usuários é mais honesto que contar orgs —
  // uma conta sem organização também é uma porta de entrada.
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.user);
  if (total > 0) {
    console.error(
      `Esta instância já tem ${total} usuário(s). O bootstrap só roda em banco vazio.`,
    );
    console.error("Para adicionar alguém, use a tela de Membros (exige admin ou owner).");
    process.exit(1);
  }

  const criado = await createUserWithPassword({
    name: nome!,
    email: email!,
    password: senha!,
    // A pessoa escolheu a própria senha — não há o que forçar a trocar.
    mustChangePassword: false,
  });
  if (!criado.ok) {
    console.error(`Não foi possível criar o usuário: ${criado.reason}`);
    process.exit(1);
  }

  const orgId = randomUUID();
  const createdAt = new Date();
  await db.insert(schema.organization).values({
    id: orgId,
    name: org!,
    slug: orgSlug(org!),
    createdAt,
  });
  await db.insert(schema.member).values({
    id: randomUUID(),
    organizationId: orgId,
    userId: criado.userId,
    role: "owner",
    createdAt,
  });

  const confere = await db.query.member.findFirst({
    where: eq(schema.member.userId, criado.userId),
  });
  if (!confere) {
    console.error("Usuário criado, mas o vínculo com a organização não foi gravado.");
    process.exit(1);
  }

  console.log(`Dono criado: ${email}`);
  console.log(`Organização: ${org} (${orgId})`);
  console.log("Entre pela tela de login. Os clãs são criados no primeiro acesso do owner.");
}

main()
  .then(() => process.exit(0))
  .catch((erro) => {
    console.error(erro);
    process.exit(1);
  });
