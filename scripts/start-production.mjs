import { spawn } from "node:child_process";

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

start("aplicação", ["server.js"]);
start("telegram-worker", [
  "--conditions=react-server",
  "--import=tsx",
  "scripts/telegram-worker.ts",
]);
