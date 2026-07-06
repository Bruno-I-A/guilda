/**
 * E2E da Fase 2 — fluxo completo de tarefas com dois usuários reais:
 * cadastro → org → convite → criar tarefa → iniciar → enviar →
 * rejeitar com nota → retomar → reenviar → aprovar.
 *
 * Pré-requisito: servidor rodando em http://localhost:3000 (npm start)
 * Uso: node scripts/e2e-phase2.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "http://localhost:3000";
const SHOTS = "docs/screenshots";
mkdirSync(SHOTS, { recursive: true });

const stamp = Date.now().toString(36);
const ana = { name: "Ana Lima", email: `ana-${stamp}@e2e.dev`, pass: "senha-e2e-123" };
const beto = { name: "Beto Costa", email: `beto-${stamp}@e2e.dev`, pass: "senha-e2e-456" };
const ORG = `Guilda E2E ${stamp}`;

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
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

// ── Ana: cadastro criando a organização ────────────────────────────
const anaCtx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  permissions: ["clipboard-read", "clipboard-write"],
});
const anaPage = await anaCtx.newPage();

console.log("1) Ana cria conta + organização");
await anaPage.goto(`${BASE}/sign-up`);
await anaPage.fill("#name", ana.name);
await anaPage.fill("#email", ana.email);
await anaPage.fill("#password", ana.pass);
await anaPage.fill("#organizationName", ORG);
await anaPage.click("button[type=submit]");
await anaPage.waitForURL("**/dashboard", { timeout: 20_000 });
check("Ana chegou ao dashboard", true);

// ── Convite para o Beto ─────────────────────────────────────────────
console.log("2) Ana convida Beto (link copiado)");
await anaPage.goto(`${BASE}/members`);
await anaPage.getByRole("button", { name: /Convidar/ }).click();
await anaPage.fill("#invite-email", beto.email);
await anaPage.getByRole("button", { name: /Criar convite e copiar link/ }).click();
await anaPage.waitForSelector(`text=${beto.email}`, { timeout: 10_000 });
const inviteLink = await anaPage.evaluate(() => navigator.clipboard.readText());
check(`link de convite copiado (${inviteLink.slice(0, 40)}…)`, inviteLink.includes("/invite/"));

// ── Beto: aceita o convite via link ─────────────────────────────────
console.log("3) Beto abre o link, cria conta e entra na org");
const betoCtx = await browser.newContext({ viewport: { width: 390, height: 844 } }); // mobile!
const betoPage = await betoCtx.newPage();
await betoPage.goto(inviteLink);
await expectVisible(betoPage, `text=Convite para ${ORG}`, "página do convite mostra a org");
await betoPage.getByRole("link", { name: /Criar conta e aceitar/ }).click();
await betoPage.waitForURL("**/sign-up**");
const emailReadonly = await betoPage.getAttribute("#email", "readonly");
check("e-mail do convite vem travado no formulário", emailReadonly !== null);
await betoPage.fill("#name", beto.name);
await betoPage.fill("#password", beto.pass);
await betoPage.click("button[type=submit]");
await betoPage.waitForURL("**/dashboard", { timeout: 20_000 });
check("Beto chegou ao dashboard (org do convite)", true);
await betoPage.screenshot({ path: `${SHOTS}/mobile-dashboard.png` });

// ── Ana cria a tarefa para o Beto ───────────────────────────────────
console.log("4) Ana cria tarefa para Beto (dificuldade 4, prioridade alta = 100 XP)");
await anaPage.goto(`${BASE}/tasks/new`);
await anaPage.fill("#title", "Preparar relatório mensal");
await anaPage.fill("#description", "Consolidar números de junho e montar a apresentação.");
await anaPage.locator("#assignee").click();
await anaPage.getByRole("option", { name: beto.name }).click();
await anaPage.getByRole("radio", { name: "Alta" }).click();
await anaPage.getByRole("radio", { name: /4 — Difícil/ }).click();
await expectVisible(anaPage, "text=100 XP", "preview de XP mostra 100");
await anaPage.getByRole("button", { name: /Criar missão/ }).click();
// aguarda a URL do DETALHE (uuid) — '/tasks/new' também casaria com glob
await anaPage.waitForURL(/\/tasks\/[0-9a-f]{8}-[0-9a-f-]{27}/, { timeout: 15_000 });
const taskUrl = anaPage.url();
await expectVisible(anaPage, "text=Pendente", "tarefa criada com status Pendente");
const anaSeesStart = await anaPage.getByRole("button", { name: "Iniciar" }).count();
check("Ana (criadora, não responsável) NÃO vê botão Iniciar", anaSeesStart === 0);

// ── Beto inicia e envia para aprovação ──────────────────────────────
console.log("5) Beto inicia e marca como feita");
await betoPage.goto(taskUrl);
await betoPage.getByRole("button", { name: "Iniciar" }).click();
await expectVisible(betoPage, "text=Em andamento", "status Em andamento após iniciar");
await betoPage.getByRole("button", { name: /Marcar como feita/ }).click();
await expectVisible(betoPage, "text=Aguardando aprovação", "status Aguardando aprovação");
const betoSeesApprove = await betoPage.getByRole("button", { name: "Aprovar" }).count();
check("Beto (responsável) NÃO vê botão Aprovar", betoSeesApprove === 0);
await betoPage.screenshot({ path: `${SHOTS}/mobile-task-awaiting.png` });

// ── Ana rejeita com nota ────────────────────────────────────────────
console.log("6) Ana rejeita com nota obrigatória");
await anaPage.goto(taskUrl);
await expectVisible(anaPage, "text=aguarda a sua aprovação", "banner de aprovação para Ana");
await anaPage.getByRole("button", { name: "Rejeitar" }).click();
const confirmReject = anaPage.getByRole("button", { name: /Rejeitar com nota/ });
check("botão de rejeitar desabilitado sem nota", await confirmReject.isDisabled());
await anaPage.fill("#reject-note", "Falta a aba de custos no relatório.");
await confirmReject.click();
await expectVisible(anaPage, "text=Devolvida", "status Devolvida após rejeição");
await expectVisible(anaPage, "text=Falta a aba de custos", "nota da rejeição visível");

// ── Beto retoma, reenvia; Ana aprova ────────────────────────────────
console.log("7) Beto retoma e reenvia; Ana aprova");
await betoPage.reload();
await betoPage.getByRole("button", { name: /Retomar ajustes/ }).click();
await expectVisible(betoPage, "text=Em andamento", "retomada volta para Em andamento");
await betoPage.getByRole("button", { name: /Marcar como feita/ }).click();
await expectVisible(betoPage, "text=Aguardando aprovação", "reenvio para aprovação");

await anaPage.reload();
await anaPage.getByRole("button", { name: "Aprovar" }).click();
await expectVisible(anaPage, "text=Concluída", "status Concluída após aprovação");
await expectVisible(anaPage, "text=aprovou a entrega", "linha do tempo registra aprovação");
await anaPage.screenshot({ path: `${SHOTS}/task-completed.png`, fullPage: true });

// ── Lista e filtros ─────────────────────────────────────────────────
console.log("8) Lista de tarefas e filtros");
await anaPage.goto(`${BASE}/tasks?tab=created&status=completed`);
await expectVisible(anaPage, "text=Preparar relatório mensal", "filtro criadas+concluídas encontra a tarefa");
await anaPage.goto(`${BASE}/tasks?tab=mine`);
await expectVisible(anaPage, "text=Nenhuma missão", "aba Minhas da Ana está vazia (estado vazio ok)");

await browser.close();

console.log(failures === 0 ? "\nE2E FASE 2: TUDO PASSOU ✓" : `\nE2E FASE 2: ${failures} FALHA(S) ✗`);
process.exit(failures === 0 ? 0 : 1);
