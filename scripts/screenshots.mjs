/**
 * Gera os screenshots do README a partir da organização demo (npm run seed).
 * Pré-requisito: servidor em http://localhost:3000 + seed aplicado.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "http://localhost:3000";
const SHOTS = "docs/screenshots";
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();

async function login(page, email) {
  await page.goto(`${BASE}/sign-in`);
  await page.fill("#email", email);
  await page.fill("#password", "demo123456");
  await page.click("button[type=submit]");
  await page.waitForURL("**/dashboard", { timeout: 20_000 });
}

// Desktop — Helena (owner)
const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await desktop.newPage();
await login(page, "helena@demo.guilda.dev");

await page.goto(`${BASE}/tasks?tab=all`);
await page.waitForSelector("text=Preparar apresentação para o conselho");
await page.screenshot({ path: `${SHOTS}/tasks-list.png` });

await page.getByRole("link", { name: /Preparar apresentação para o conselho/ }).click();
await page.waitForSelector("text=aguarda a sua aprovação");
await page.screenshot({ path: `${SHOTS}/task-completed.png`, fullPage: true });

await page.goto(`${BASE}/leaderboard?period=month`);
await page.waitForSelector("text=Juliana Melo");
await page.screenshot({ path: `${SHOTS}/leaderboard.png` });

// Mobile — Juliana (member)
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
const mpage = await mobile.newPage();
await login(mpage, "juliana@demo.guilda.dev");
await mpage.screenshot({ path: `${SHOTS}/mobile-dashboard.png` });

await mpage.goto(`${BASE}/profile`);
await mpage.waitForSelector("text=Histórico de XP");
await mpage.screenshot({ path: `${SHOTS}/mobile-profile.png`, fullPage: true });

await mpage.goto(`${BASE}/tasks`);
await mpage.waitForSelector("text=Mapear processos do financeiro");
await mpage.screenshot({ path: `${SHOTS}/mobile-task-awaiting.png` });

await browser.close();
console.log("Screenshots atualizados em docs/screenshots/");
