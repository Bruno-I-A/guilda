/**
 * Expediente contra um Postgres de verdade (PGlite), como guilda_app: grava e
 * lê a semana, os dias especiais sem repetir data, e a outra organização não vê nada.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, expect, test, vi } from "vitest";

import * as schema from "@/db/schema";
import type { WeekSchedule } from "@/domain/business-hours";
import { applyMigrations } from "@/lib/nfse/testing/pglite";

vi.mock("server-only", () => ({}));

const client = new PGlite();
const pgDb = drizzle(client, { schema });
vi.mock("@/db", () => ({ db: pgDb }));

const ORG = "org-expediente";
const OTHER = "org-vizinha";
const WEEK: WeekSchedule = {
  1: [["08:00", "12:00"], ["13:30", "18:00"]],
  2: [["08:00", "12:00"], ["13:30", "18:00"]],
  3: [["08:00", "12:00"], ["13:30", "18:00"]],
  4: [["08:00", "12:00"], ["13:30", "18:00"]],
  5: [["08:00", "12:00"], ["13:30", "17:00"]],
  6: [],
  7: [],
};

async function as<T>(orgId: string, run: Parameters<typeof import("@/db/org-tx").withOrgTx<T>>[1]) {
  const { withOrgTx } = await import("@/db/org-tx");
  return withOrgTx(orgId, run);
}

beforeAll(async () => {
  await applyMigrations(client);
  await client.exec(`
    INSERT INTO organization (id, name, slug, created_at) VALUES ('${ORG}', 'Escritório', 'expediente', now()), ('${OTHER}', 'Vizinho', 'vizinho', now());
    INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ('admin', 'Bruno', 'admin@x', true, now(), now());
  `);
  await client.exec("SET ROLE guilda_app;");
  await import("./business-hours");
}, 120_000);

afterAll(async () => {
  await client.close();
});

test("sem semana salva, o escritório conta como sempre aberto; salvar de novo atualiza", async () => {
  const { loadBusinessSchedule, saveBusinessWeek, clearBusinessWeek } = await import("./business-hours");
  expect(await as(ORG, (t) => loadBusinessSchedule(t, ORG, "2026-11-23"))).toEqual({ week: null, specialDays: [] });

  await as(ORG, (t) => saveBusinessWeek(t, { orgId: ORG, userId: "admin", week: WEEK, now: new Date() }));
  expect((await as(ORG, (t) => loadBusinessSchedule(t, ORG, "2026-11-23"))).week).toEqual(WEEK);

  const longer = { ...WEEK, 6: [["08:00", "12:00"]] as const };
  await as(ORG, (t) => saveBusinessWeek(t, { orgId: ORG, userId: "admin", week: longer, now: new Date() }));
  expect((await as(ORG, (t) => loadBusinessSchedule(t, ORG, "2026-11-23"))).week?.[6]).toEqual([["08:00", "12:00"]]);

  await as(ORG, (t) => clearBusinessWeek(t, ORG));
  expect((await as(ORG, (t) => loadBusinessSchedule(t, ORG, "2026-11-23"))).week).toBeNull();
});

test("dias especiais: pula data repetida, lê só de hoje em diante e remove só o da organização", async () => {
  const { loadBusinessSchedule, addSpecialDays, removeSpecialDay } = await import("./business-hours");
  const first = await as(ORG, (t) =>
    addSpecialDays(t, {
      orgId: ORG,
      userId: "admin",
      days: [
        { day: "2026-11-20", name: "Consciência Negra", periods: [] },
        { day: "2026-12-24", name: "Véspera de Natal", periods: [["08:00", "12:00"]] },
      ],
    }),
  );
  expect(first).toEqual({ added: 2 });
  const second = await as(ORG, (t) =>
    addSpecialDays(t, {
      orgId: ORG,
      userId: "admin",
      days: [
        { day: "2026-12-24", name: "Outro nome", periods: [] },
        { day: "2026-12-25", name: "Natal", periods: [] },
      ],
    }),
  );
  expect(second).toEqual({ added: 1 });

  const schedule = await as(ORG, (t) => loadBusinessSchedule(t, ORG, "2026-12-01"));
  expect(schedule.specialDays.map(({ day, name, periods }) => ({ day, name, periods }))).toEqual([
    { day: "2026-12-24", name: "Véspera de Natal", periods: [["08:00", "12:00"]] },
    { day: "2026-12-25", name: "Natal", periods: [] },
  ]);

  // A outra organização não enxerga nem remove o que é do escritório.
  expect((await as(OTHER, (t) => loadBusinessSchedule(t, OTHER, "2026-01-01"))).specialDays).toEqual([]);
  const christmas = schedule.specialDays[1].id;
  expect(await as(OTHER, (t) => removeSpecialDay(t, { orgId: OTHER, id: christmas }))).toBe(false);
  expect(await as(ORG, (t) => removeSpecialDay(t, { orgId: ORG, id: christmas }))).toBe(true);
  expect((await as(ORG, (t) => loadBusinessSchedule(t, ORG, "2026-12-01"))).specialDays.map((day) => day.day)).toEqual(["2026-12-24"]);
});

test("a organização não grava expediente em nome de outra (RLS)", async () => {
  const { saveBusinessWeek } = await import("./business-hours");
  await expect(as(OTHER, (t) => saveBusinessWeek(t, { orgId: ORG, userId: "admin", week: WEEK, now: new Date() }))).rejects.toThrow();
});
