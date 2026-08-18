import { spawn } from "node:child_process";

const DRIZZLE_KIT = "node_modules/drizzle-kit/bin.cjs";

/**
 * Aplica as migrations ANTES de servir qualquer requisicao.
 *
 * O painel de hospedagem constroi somente o Dockerfile, entao o servico
 * `migrate` do docker-compose.yml nunca roda em producao. Sem isto o app
 * sobe apontando para um banco desatualizado e quebra na primeira query de
 * tabela nova (foi o que aconteceu com guild_notices).
 *
 * `drizzle-kit migrate` e idempotente: ele registra o que ja aplicou e nao
 * repete. Se falhar, o processo morre aqui — melhor o container reiniciar
 * do que servir um app com o schema errado.
 */
function runMigrations() {
  return new Promise((resolve, reject) => {
    console.log("Aplicando migrations do banco...");
    const child = spawn(process.execPath, [DRIZZLE_KIT, "migrate"], {
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        console.log("Migrations aplicadas.");
        resolve();
        return;
      }
      reject(
        new Error(
          `drizzle-kit migrate falhou (${signal ? `sinal ${signal}` : `código ${code}`}).`,
        ),
      );
    });
  });
}

const children = new Set();
let shuttingDown = false;

function start(name, args) {
  const child = spawn(process.execPath, args, {
    env: process.env,
    stdio: "inherit",
  });
  children.add(child);
  child.once("exit", (code, signal) => {
    children.delete(child);
    if (shuttingDown) return;
    console.error(
      `${name} encerrou inesperadamente (${signal ? `sinal ${signal}` : `código ${code ?? 1}`}).`,
    );
    shutdown(signal ? 1 : (code ?? 1));
  });
  child.once("error", (error) => {
    console.error(`Não foi possível iniciar ${name}:`, error.message);
    shutdown(1);
  });
  return child;
}

function shutdown(exitCode, signal = "SIGTERM") {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill(signal);

  const deadline = setTimeout(() => {
    for (const child of children) child.kill("SIGKILL");
  }, 10_000);
  deadline.unref();

  Promise.all(
    [...children].map(
      (child) => new Promise((resolve) => child.once("exit", resolve)),
    ),
  ).finally(() => process.exit(exitCode));
}

process.once("SIGTERM", () => shutdown(0, "SIGTERM"));
process.once("SIGINT", () => shutdown(0, "SIGINT"));

try {
  await runMigrations();
} catch (error) {
  console.error("Falha ao aplicar as migrations:", error.message);
  process.exit(1);
}

start("aplicação", ["server.js"]);
start("telegram-worker", [
  "--conditions=react-server",
  "--import=tsx",
  "scripts/telegram-worker.ts",
]);
