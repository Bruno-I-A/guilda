/**
 * E2E da Fase 3 — gamificação de ponta a ponta:
 * crédito de XP na aprovação, nível/progresso no perfil, leaderboard por
 * período, reversão com estorno e conclusão direta de auto-missão
 * (criador == responsável nunca passa por aprovação — regra de 2026-07-06).
 *
 * Pré-requisito: servidor em http://localhost:3000 (npm start)
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "http://localhost:3000";
const SHOTS = "docs/screenshots";
mkdirSync(SHOTS, { recursive: true });

const stamp = Date.now().toString(36);
const carla = { name: "Carla Nunes", email: `carla-${stamp}@e2e.dev`, pass: "senha-e2e-123" };
const dani = { name: "Dani Rocha", email: `dani-${stamp}@e2e.dev`, pass: "senha-e2e-456" };
const ORG = `Guilda XP ${stamp}`;

let failures = 0;
function check(label, condition) {
  if (condition) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.error(`  ✗ FALHOU: ${label}`);
  }
}
async function expectVisible(page, selector, label, timeout = 10_000) {
  try {
    await page.waitForSelector(selector, { timeout });
    check(label, true);
  } catch {
    check(label, false);
  }
}

const browser = await chromium.launch();
const carlaCtx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  permissions: ["clipboard-read", "clipboard-write"],
});
const carlaPage = await carlaCtx.newPage();
const daniCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const daniPage = await daniCtx.newPage();

async function createTask(page, { title, assignee, priority, difficulty }) {
  await page.goto(`${BASE}/tasks/new`);
  await page.fill("#title", title);
  await page.locator("#assignee").click();
  await page.getByRole("option", { name: assignee }).click();
  if (priority) {
    // prioridade agora é segmentada (botões com role=radio)
    await page.getByRole("radio", { name: priority, exact: true }).click();
  }
  if (difficulty) {
    // dificuldade agora são pips clicáveis (role=radio com aria-label "N — Rótulo")
    await page.getByRole("radio", { name: difficulty }).click();
  }
  await page.getByRole("button", { name: /Criar missão/ }).click();
  await page.waitForURL(/\/tasks\/[0-9a-f]{8}-[0-9a-f-]{27}/, { timeout: 15_000 });
  return page.url();
}

async function runTaskFlow(assigneePage, taskUrl) {
  await assigneePage.goto(taskUrl);
  await assigneePage.getByRole("button", { name: "Iniciar" }).click();
  await assigneePage.waitForSelector("text=Em andamento");
  await assigneePage.getByRole("button", { name: /Marcar como feita/ }).click();
  await assigneePage.waitForSelector("text=Aguardando aprovação");
}

console.log("1) Contas: Carla (owner) + Dani (member via convite)");
await carlaPage.goto(`${BASE}/sign-up`);
await carlaPage.fill("#name", carla.name);
await carlaPage.fill("#email", carla.email);
await carlaPage.fill("#password", carla.pass);
await carlaPage.fill("#organizationName", ORG);
await carlaPage.click("button[type=submit]");
await carlaPage.waitForURL("**/dashboard", { timeout: 20_000 });

await carlaPage.goto(`${BASE}/members`);
await carlaPage.getByRole("button", { name: /Convidar/ }).click();
await carlaPage.fill("#invite-email", dani.email);
await carlaPage.getByRole("button", { name: /Criar convite e copiar link/ }).click();
await carlaPage.waitForSelector(`text=${dani.email}`);
const inviteLink = await carlaPage.evaluate(() => navigator.clipboard.readText());

await daniPage.goto(inviteLink);
await daniPage.getByRole("link", { name: /Criar conta e aceitar/ }).click();
await daniPage.fill("#name", dani.name);
await daniPage.fill("#password", dani.pass);
await daniPage.click("button[type=submit]");
await daniPage.waitForURL("**/dashboard", { timeout: 20_000 });
check("setup completo", true);

console.log("2) Task A (120 XP) para Dani → aprovada por Carla");
const taskA = await createTask(carlaPage, {
  title: "Integrar gateway de pagamento",
  assignee: dani.name,
  priority: "Alta",
  difficulty: /5 — Muito difícil/,
});
await runTaskFlow(daniPage, taskA);
await carlaPage.goto(taskA);
await carlaPage.getByRole("button", { name: "Aprovar" }).click();
await expectVisible(carlaPage, "text=Concluída", "task A concluída");

await daniPage.goto(`${BASE}/profile`);
await expectVisible(daniPage, "text=120 XP no total", "perfil Dani: 120 XP");
await expectVisible(daniPage, "text=faltam 162 XP para o nível 2", "perfil Dani: nível 1, faltam 162 XP");

console.log("3) Task B (20 XP) para Dani → aprovada");
const taskB = await createTask(carlaPage, {
  title: "Atualizar dependências do projeto",
  assignee: dani.name,
  priority: "Baixa",
  difficulty: /1 — Muito fácil/,
});
await runTaskFlow(daniPage, taskB);
await carlaPage.goto(taskB);
await carlaPage.getByRole("button", { name: "Aprovar" }).click();
await carlaPage.waitForSelector("text=Concluída");
await daniPage.goto(`${BASE}/profile`);
await expectVisible(daniPage, "text=140 XP no total", "perfil Dani: 140 XP acumulados");

console.log("4) Task C: Carla para SI MESMA → conclui direto, sem aprovação");
const taskC = await createTask(carlaPage, {
  title: "Planejar retrospectiva do trimestre",
  assignee: carla.name,
});
await carlaPage.goto(taskC);
await carlaPage.getByRole("button", { name: "Iniciar" }).click();
await carlaPage.waitForSelector("text=Em andamento");
const carlaSeesSubmit = await carlaPage
  .getByRole("button", { name: /Marcar como feita/ })
  .count();
check("auto-missão NÃO oferece 'Marcar como feita'", carlaSeesSubmit === 0);
await carlaPage.getByRole("button", { name: "Concluir" }).click();
await expectVisible(carlaPage, "text=você ganhou 50 XP", "banner de XP ganho para Carla");

console.log("5) Leaderboard (semana): Dani 140 em 1º, Carla 50 em 2º");
await carlaPage.goto(`${BASE}/leaderboard`);
await expectVisible(carlaPage, "text=+140 XP", "leaderboard: Dani +140");
await expectVisible(carlaPage, "text=+50 XP", "leaderboard: Carla +50");
const firstRow = carlaPage.locator("[class*=divide-y] > div").first();
check("Dani em 1º lugar", (await firstRow.textContent())?.includes("Dani") ?? false);
await carlaPage.screenshot({ path: `${SHOTS}/leaderboard.png` });

console.log("6) Reversão da Task B: Dani volta a 120 XP com estorno no histórico");
await carlaPage.goto(taskB);
await carlaPage.getByRole("button", { name: /Reverter conclusão/ }).click();
await carlaPage.fill("#revert-note", "Aprovação por engano — faltou o lockfile.");
await carlaPage.getByRole("button", { name: /Reverter e estornar XP/ }).click();
await expectVisible(carlaPage, "text=Em andamento", "task B voltou para Em andamento");
await expectVisible(carlaPage, "text=reverteu a conclusão", "timeline registra a reversão");

await daniPage.goto(`${BASE}/profile`);
await expectVisible(daniPage, "text=120 XP no total", "perfil Dani: 120 XP após estorno");
await expectVisible(daniPage, "text=Conclusão revertida", "histórico mostra o estorno");
await expectVisible(daniPage, "text=-20 XP", "estorno de -20 XP visível");
await daniPage.screenshot({ path: `${SHOTS}/mobile-profile.png`, fullPage: true });

await carlaPage.goto(`${BASE}/leaderboard`);
await expectVisible(carlaPage, "text=+120 XP", "leaderboard atualizado: Dani +120");

console.log("7) Mesmo com Dani promovida a admin, auto-missão segue concluindo direto");
await carlaPage.goto(`${BASE}/members`);
await carlaPage.getByRole("button", { name: `Ações para ${dani.name}` }).click();
await carlaPage.getByRole("menuitem", { name: /Promover a admin/ }).click();
await carlaPage.waitForSelector(`text=${dani.name} agora é admin`);

const taskD = await createTask(carlaPage, {
  title: "Definir metas do próximo ciclo",
  assignee: carla.name,
});
await carlaPage.goto(taskD);
await carlaPage.getByRole("button", { name: "Iniciar" }).click();
await carlaPage.waitForSelector("text=Em andamento");
await carlaPage.getByRole("button", { name: "Concluir" }).click();
await expectVisible(
  carlaPage,
  "text=Concluída",
  "auto-missão concluída direto mesmo com outra admin na org",
);

await browser.close();
console.log(
  failures === 0 ? "\nE2E FASE 3: TUDO PASSOU ✓" : `\nE2E FASE 3: ${failures} FALHA(S) ✗`,
);
process.exit(failures === 0 ? 0 : 1);
