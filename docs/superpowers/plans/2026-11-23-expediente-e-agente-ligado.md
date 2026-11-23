# Agente para todos e expediente — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o agente de IA do Atendimento ter três modos (Desligado · Só teste · Todos os clientes) e conhecer o expediente do escritório, avisando fora dele quando a equipe volta e segurando o aviso à equipe até a abertura.

**Architecture:**
- As contas de horário ficam numa função pura, `src/domain/business-hours.ts`: Brasília, semana com dois períodos e dias especiais.
- O repositório `src/lib/support/business-hours.ts` lê e grava duas tabelas novas com RLS.
- O modo do agente troca o booleano `test_enabled` pelo enum `agent_mode`.
- O inbound worker abre a rodada em conversa nova no modo `live`.
- O turno (`turn.ts`) passa o expediente para `decision.ts`, que monta as falas, e agenda o aviso à equipe.

**Tech Stack:** Next.js 16 (App Router), Drizzle + Postgres (RLS, role `guilda_app`), Zod, Vitest + PGlite, shadcn/ui, lucide.

Desenho: `docs/superpowers/specs/2026-11-23-expediente-e-agente-ligado-design.md`.

Comandos:
- Testes: `npx vitest run <arquivos> --maxWorkers=1 --no-file-parallelism`.
- Tipos: `npx tsc --noEmit`.
- Lint: `npx eslint <arquivos>`.
- Commits em português sem acento, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Mapa de arquivos

| Arquivo | Papel |
|---|---|
| `src/domain/business-hours.ts` (novo) | Horário de Brasília, `hoursAt`, `nextOpening`, `openingPhrase`, `hourLabel`, `checkPeriods`, `parseWeek`, `parsePeriods`, `nationalHolidays` |
| `src/domain/business-hours.test.ts` (novo) | Testes puros |
| `src/db/migrations/0110_support-agent-mode-business-hours.sql` (novo) + `meta/_journal.json` | Enum `support_agent_mode`, coluna `agent_mode`, tabelas `support_business_hours` e `support_special_days` |
| `src/db/schema/support.ts` | Schema Drizzle dos itens acima |
| `src/domain/support-agent.ts` (+ teste) | `AgentMode`, `agentDeliveryBlock` com `mode` |
| `src/lib/support/agent/settings.ts` | `loadAgentSettings` → `{ mode, testKeyword }`, `saveAgentSettings`, `startAgentRound` |
| `src/lib/whatsapp/outbound-worker.ts` | Lê `agent_mode` |
| `src/lib/whatsapp/inbound-worker.ts` | Rodada em conversa nova no modo `live` |
| `src/lib/support/inbox.ts` | Rótulos dos eventos novos |
| `src/lib/support/business-hours.ts` (novo) + `business-hours.db.test.ts` | Repositório do expediente |
| `src/lib/support/agent/decision.ts` (+ teste) | Falas fora do expediente |
| `src/lib/support/agent/turn.ts` | Lê o expediente e agenda o aviso |
| `src/lib/whatsapp/member-notifications.ts` | `scheduledFor` no aviso de conversa |
| `src/app/(app)/atendimento/configuracoes/agent-actions.ts` (novo; substitui `agent-test-actions.ts`) | Action do modo |
| `src/app/(app)/atendimento/configuracoes/agent-panel.tsx` (novo; substitui `agent-test-panel.tsx`) | Cartão "Agente de IA" |
| `src/app/(app)/atendimento/configuracoes/business-hours-actions.ts` (novo) | Actions do expediente e dos dias especiais |
| `src/app/(app)/atendimento/configuracoes/business-hours-panel.tsx` (novo) | Cartão "Expediente" |
| `src/app/(app)/atendimento/configuracoes/special-days-panel.tsx` (novo) | Cartão "Dias especiais" |
| `src/app/(app)/atendimento/configuracoes/page.tsx` | Liga os cartões |

---

### Task 1: Horário de Brasília e expediente (domínio puro)

**Files:**
- Create: `src/domain/business-hours.ts`
- Test: `src/domain/business-hours.test.ts`

- [ ] **Step 1: Escrever os testes**

```ts
import { describe, expect, test } from "vitest";

import {
  checkPeriods,
  hourLabel,
  hoursAt,
  nationalHolidays,
  nextOpening,
  openingPhrase,
  parsePeriods,
  parseWeek,
  type BusinessSchedule,
  type WeekSchedule,
} from "./business-hours";

const WORK: WeekSchedule = {
  1: [["08:00", "12:00"], ["13:30", "18:00"]],
  2: [["08:00", "12:00"], ["13:30", "18:00"]],
  3: [["08:00", "12:00"], ["13:30", "18:00"]],
  4: [["08:00", "12:00"], ["13:30", "18:00"]],
  5: [["08:00", "12:00"], ["13:30", "18:00"]],
  6: [],
  7: [],
};
const schedule = (specialDays: BusinessSchedule["specialDays"] = []): BusinessSchedule => ({ week: WORK, specialDays });
// Brasília é UTC-3: 09:00 em Brasília = 12:00Z.
const brt = (iso: string) => new Date(`${iso}-03:00`);

describe("hoursAt", () => {
  test("sem expediente cadastrado é sempre aberto", () => {
    expect(hoursAt({ week: null, specialDays: [] }, brt("2026-11-22T03:00"))).toEqual({ open: true, nextOpening: null, closesAt: null });
  });
  test("aberto de manhã, fecha no almoço", () => {
    expect(hoursAt(schedule(), brt("2026-11-23T09:00"))).toEqual({ open: true, nextOpening: null, closesAt: brt("2026-11-23T12:00") });
  });
  test("no almoço está fechado e volta hoje às 13h30", () => {
    const now = brt("2026-11-23T12:30");
    const hours = hoursAt(schedule(), now);
    expect(hours).toEqual({ open: false, nextOpening: brt("2026-11-23T13:30"), closesAt: null });
    expect(openingPhrase(hours.nextOpening, now)).toBe("hoje às 13h30");
  });
  test("sexta à noite volta segunda; feriado na segunda empurra para terça", () => {
    const now = brt("2026-11-27T19:00");
    expect(openingPhrase(nextOpening(schedule(), now), now)).toBe("segunda-feira, 30/11, às 8h");
    const holiday = schedule([{ day: "2026-11-30", name: "Feriado municipal", periods: [] }]);
    expect(openingPhrase(nextOpening(holiday, now), now)).toBe("terça-feira, 01/12, às 8h");
  });
  test("quinta à noite volta amanhã; madrugada de segunda volta hoje", () => {
    const thursday = brt("2026-11-26T20:00");
    expect(openingPhrase(nextOpening(schedule(), thursday), thursday)).toBe("amanhã às 8h");
    const dawn = brt("2026-11-23T00:30");
    expect(openingPhrase(nextOpening(schedule(), dawn), dawn)).toBe("hoje às 8h");
  });
  test("meio período: o dia especial substitui a semana", () => {
    const christmas = schedule([
      { day: "2026-12-24", name: "Véspera de Natal", periods: [["08:00", "12:00"]] },
      { day: "2026-12-25", name: "Natal", periods: [] },
    ]);
    expect(hoursAt(christmas, brt("2026-12-24T10:00")).open).toBe(true);
    const afternoon = brt("2026-12-24T14:00");
    expect(hoursAt(christmas, afternoon)).toMatchObject({ open: false, nextOpening: brt("2026-12-28T08:00") });
    expect(openingPhrase(nextOpening(christmas, afternoon), afternoon)).toBe("segunda-feira, 28/12, às 8h");
  });
  test("sábado excepcional abre", () => {
    const saturday = schedule([{ day: "2026-11-28", name: "Plantão", periods: [["08:00", "12:00"]] }]);
    expect(hoursAt(saturday, brt("2026-11-28T09:00")).open).toBe(true);
  });
  test("semana toda fechada não tem próxima abertura", () => {
    const closed: WeekSchedule = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] };
    const now = brt("2026-11-23T09:00");
    expect(hoursAt({ week: closed, specialDays: [] }, now)).toEqual({ open: false, nextOpening: null, closesAt: null });
    expect(openingPhrase(null, now)).toBe("no próximo expediente");
  });
});

describe("textos e validação", () => {
  test("hora cheia sem minutos, quebrada com minutos", () => {
    expect(hourLabel(8 * 60)).toBe("8h");
    expect(hourLabel(13 * 60 + 30)).toBe("13h30");
    expect(hourLabel(9 * 60 + 5)).toBe("9h05");
  });
  test("períodos: formato, ordem, sobreposição e no máximo dois", () => {
    expect(checkPeriods([["08:00", "12:00"], ["13:30", "18:00"]])).toBeNull();
    expect(checkPeriods([])).toBeNull();
    expect(checkPeriods([["8:00", "12:00"]])).toMatch(/formato/);
    expect(checkPeriods([["12:00", "08:00"]])).toMatch(/terminar depois/);
    expect(checkPeriods([["08:00", "13:00"], ["12:00", "18:00"]])).toMatch(/sobrepor/);
    expect(checkPeriods([["13:30", "18:00"], ["08:00", "12:00"]])).toMatch(/sobrepor/);
    expect(checkPeriods([["07:00", "08:00"], ["09:00", "10:00"], ["11:00", "12:00"]])).toMatch(/dois períodos/);
  });
  test("o que vem do banco é conferido: semana inválida vira null, período inválido some", () => {
    expect(parseWeek(WORK)).toEqual(WORK);
    expect(parseWeek({ ...WORK, 3: [["18:00", "08:00"]] })).toBeNull();
    expect(parseWeek({ 1: [] })).toBeNull();
    expect(parseWeek(null)).toBeNull();
    expect(parsePeriods([["08:00", "12:00"]])).toEqual([["08:00", "12:00"]]);
    expect(parsePeriods("lixo")).toEqual([]);
  });
});

describe("nationalHolidays", () => {
  test("Páscoa de anos conhecidos e os móveis derivados", () => {
    const days = (year: number) => Object.fromEntries(nationalHolidays(year).map((holiday) => [holiday.name, holiday]));
    expect(days(2025)["Sexta-feira Santa"].day).toBe("2025-04-18");
    const y2026 = days(2026);
    expect(y2026["Sexta-feira Santa"].day).toBe("2026-04-03");
    expect(y2026["Carnaval (segunda-feira)"]).toEqual({ day: "2026-02-16", name: "Carnaval (segunda-feira)", optional: true });
    expect(y2026["Carnaval (terça-feira)"].day).toBe("2026-02-17");
    expect(y2026["Corpus Christi"]).toEqual({ day: "2026-06-04", name: "Corpus Christi", optional: true });
    expect(days(2027)["Carnaval (terça-feira)"].day).toBe("2027-02-09");
    expect(days(2027)["Sexta-feira Santa"].day).toBe("2027-03-26");
  });
  test("fixos, em ordem de data, sem ponto facultativo entre os obrigatórios", () => {
    const list = nationalHolidays(2027);
    expect(list.map((holiday) => holiday.day)).toEqual([...list.map((holiday) => holiday.day)].sort());
    expect(list.filter((holiday) => !holiday.optional).map((holiday) => holiday.day.slice(5))).toEqual([
      "01-01", "03-26", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25",
    ]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/domain/business-hours.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar `src/domain/business-hours.ts`**

```ts
/**
 * Expediente do escritório no Atendimento (2026-11-23, pedido do Bruno): semana
 * com até dois períodos por dia (manhã e tarde) e dias especiais (feriado, meio
 * período). Puro: o horário é o de Brasília e o relógio entra por parâmetro.
 * Sem semana cadastrada, o escritório conta como sempre aberto.
 */
import { APP_TIME_ZONE } from "@/lib/date-time";

export type Period = readonly [string, string];
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type WeekSchedule = Readonly<Record<IsoWeekday, readonly Period[]>>;
export type SpecialDay = Readonly<{ day: string; name: string; periods: readonly Period[] }>;
export type BusinessSchedule = Readonly<{ week: WeekSchedule | null; specialDays: readonly SpecialDay[] }>;
export type HoursNow = Readonly<{ open: boolean; nextOpening: Date | null; closesAt: Date | null }>;
export type HolidaySuggestion = Readonly<{ day: string; name: string; optional: boolean }>;

export const WEEKDAYS: readonly IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7];
export const WEEKDAY_LABELS: Readonly<Record<IsoWeekday, string>> = {
  1: "segunda-feira",
  2: "terça-feira",
  3: "quarta-feira",
  4: "quinta-feira",
  5: "sexta-feira",
  6: "sábado",
  7: "domingo",
};
export const MAX_PERIODS_PER_DAY = 2;
export const ALWAYS_OPEN: HoursNow = { open: true, nextOpening: null, closesAt: null };
/** Até onde procurar a próxima abertura: um ano e pouco cobre qualquer recesso. */
const SEARCH_DAYS = 400;

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function minutesOf(time: string): number | null {
  const match = TIME.exec(time);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** "8h", "13h30", "9h05": como se fala o horário. */
export function hourLabel(minutes: number): string {
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)}h${rest ? String(rest).padStart(2, "0") : ""}`;
}

/** Devolve o problema dos períodos de um dia, ou null. */
export function checkPeriods(periods: readonly Period[]): string | null {
  if (periods.length > MAX_PERIODS_PER_DAY) return "Use no máximo dois períodos por dia.";
  let previousEnd = -1;
  for (const [start, end] of periods) {
    const from = minutesOf(start);
    const to = minutesOf(end);
    if (from === null || to === null) return "Use horários no formato 08:00.";
    if (from >= to) return "O período precisa terminar depois de começar.";
    if (from < previousEnd) return "Os períodos não podem se sobrepor, e o da manhã vem primeiro.";
    previousEnd = to;
  }
  return null;
}

function isPeriodList(value: unknown): value is Period[] {
  return Array.isArray(value) && value.every((item) => Array.isArray(item) && item.length === 2 && typeof item[0] === "string" && typeof item[1] === "string");
}

/** Períodos guardados no banco: o que não tiver a forma certa conta como fechado. */
export function parsePeriods(value: unknown): Period[] {
  if (!isPeriodList(value) || checkPeriods(value) !== null) return [];
  return value.map(([start, end]) => [start, end] as const);
}

/** Semana guardada no banco: inválida vira null (sempre aberto), nunca exceção. */
export function parseWeek(value: unknown): WeekSchedule | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const week = {} as Record<IsoWeekday, Period[]>;
  for (const day of WEEKDAYS) {
    const periods = record[String(day)];
    if (!isPeriodList(periods) || checkPeriods(periods) !== null) return null;
    week[day] = periods.map(([start, end]) => [start, end] as const);
  }
  return week;
}

const clock = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function wallClock(instant: Date): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = Object.fromEntries(clock.formatToParts(instant).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Dia (AAAA-MM-DD) e minuto do dia em Brasília. */
export function localClock(instant: Date): { day: string; minutes: number } {
  const wall = wallClock(instant);
  return {
    day: `${wall.year}-${String(wall.month).padStart(2, "0")}-${String(wall.day).padStart(2, "0")}`,
    minutes: wall.hour * 60 + wall.minute,
  };
}

function offsetMs(instant: number): number {
  const wall = wallClock(new Date(instant));
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) - Math.floor(instant / 1000) * 1000;
}

/** O instante de um horário de Brasília (dia + minuto do dia). */
export function zonedTime(day: string, minutes: number): Date {
  const [year, month, date] = day.split("-").map(Number);
  const guess = Date.UTC(year, month - 1, date, Math.floor(minutes / 60), minutes % 60);
  const first = guess - offsetMs(guess);
  return new Date(guess - offsetMs(first));
}

export function addDays(day: string, amount: number): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + amount)).toISOString().slice(0, 10);
}

export function weekdayOf(day: string): IsoWeekday {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  return (weekday === 0 ? 7 : weekday) as IsoWeekday;
}

export function isValidDay(day: string): boolean {
  return DAY.test(day) && addDays(day, 0) === day;
}

function periodsOn(schedule: BusinessSchedule, week: WeekSchedule, day: string): readonly Period[] {
  return schedule.specialDays.find((special) => special.day === day)?.periods ?? week[weekdayOf(day)];
}

/** O próximo começo de período depois de `now`, ou null se tudo estiver fechado. */
export function nextOpening(schedule: BusinessSchedule, now: Date): Date | null {
  if (!schedule.week) return null;
  const today = localClock(now);
  for (let offset = 0; offset <= SEARCH_DAYS; offset += 1) {
    const day = addDays(today.day, offset);
    for (const [start] of periodsOn(schedule, schedule.week, day)) {
      const minutes = minutesOf(start);
      if (minutes !== null && (offset > 0 || minutes > today.minutes)) return zonedTime(day, minutes);
    }
  }
  return null;
}

export function hoursAt(schedule: BusinessSchedule, now: Date): HoursNow {
  if (!schedule.week) return ALWAYS_OPEN;
  const today = localClock(now);
  for (const [start, end] of periodsOn(schedule, schedule.week, today.day)) {
    const from = minutesOf(start);
    const to = minutesOf(end);
    if (from !== null && to !== null && today.minutes >= from && today.minutes < to) {
      return { open: true, nextOpening: null, closesAt: zonedTime(today.day, to) };
    }
  }
  return { open: false, nextOpening: nextOpening(schedule, now), closesAt: null };
}

/** "hoje às 13h30", "amanhã às 8h", "segunda-feira, 30/11, às 8h" ou "no próximo expediente". */
export function openingPhrase(opening: Date | null, now: Date): string {
  if (!opening) return "no próximo expediente";
  const today = localClock(now).day;
  const target = localClock(opening);
  const hour = hourLabel(target.minutes);
  if (target.day === today) return `hoje às ${hour}`;
  if (target.day === addDays(today, 1)) return `amanhã às ${hour}`;
  const [, month, date] = target.day.split("-");
  return `${WEEKDAY_LABELS[weekdayOf(target.day)]}, ${date}/${month}, às ${hour}`;
}

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano). */
function easter(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Feriados nacionais do ano para o Bruno marcar os que o escritório fecha.
 * Carnaval e Corpus Christi são ponto facultativo: vêm desmarcados na tela.
 */
export function nationalHolidays(year: number): HolidaySuggestion[] {
  const pascoa = easter(year);
  const fixed = (monthDay: string, name: string): HolidaySuggestion => ({ day: `${year}-${monthDay}`, name, optional: false });
  return [
    fixed("01-01", "Confraternização Universal"),
    { day: addDays(pascoa, -48), name: "Carnaval (segunda-feira)", optional: true },
    { day: addDays(pascoa, -47), name: "Carnaval (terça-feira)", optional: true },
    { day: addDays(pascoa, -2), name: "Sexta-feira Santa", optional: false },
    fixed("04-21", "Tiradentes"),
    fixed("05-01", "Dia do Trabalho"),
    { day: addDays(pascoa, 60), name: "Corpus Christi", optional: true },
    fixed("09-07", "Independência do Brasil"),
    fixed("10-12", "Nossa Senhora Aparecida"),
    fixed("11-02", "Finados"),
    fixed("11-15", "Proclamação da República"),
    fixed("11-20", "Dia Nacional de Zumbi e da Consciência Negra"),
    fixed("12-25", "Natal"),
  ].sort((left, right) => left.day.localeCompare(right.day));
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/domain/business-hours.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/business-hours.ts src/domain/business-hours.test.ts
git commit -m "feat(atendimento): contas do expediente do escritorio"
```

### Task 2: Migração e schema (modo do agente e tabelas do expediente)

**Files:**
- Create: `src/db/migrations/0110_support-agent-mode-business-hours.sql`
- Modify: `src/db/migrations/meta/_journal.json` (nova entrada)
- Modify: `src/db/schema/support.ts` (enum, coluna, tabelas)

- [ ] **Step 1: Escrever a migração**

```sql
-- Agente para todos e expediente do escritorio (2026-11-23). Escrita a mao, como a 0103 a 0109.
-- O modo substitui o interruptor do teste; test_enabled fica no banco sem uso,
-- para o app antigo nao quebrar durante a troca (mesmo cuidado de support_contacts.client_id).
CREATE TYPE "public"."support_agent_mode" AS ENUM('off', 'test', 'live');--> statement-breakpoint
ALTER TABLE "support_agent_settings" ADD COLUMN "agent_mode" "support_agent_mode" DEFAULT 'off' NOT NULL;--> statement-breakpoint
UPDATE "support_agent_settings" SET "agent_mode" = 'test' WHERE "test_enabled";--> statement-breakpoint
ALTER TABLE "support_agent_settings" DROP CONSTRAINT "support_agent_settings_enabled_check";--> statement-breakpoint
ALTER TABLE "support_agent_settings" ADD CONSTRAINT "support_agent_settings_mode_keyword_check" CHECK ("agent_mode" <> 'test' OR "test_keyword" IS NOT NULL);--> statement-breakpoint
CREATE TABLE "support_business_hours" (
	"org_id" text PRIMARY KEY NOT NULL,
	"week" jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "support_business_hours" ADD CONSTRAINT "support_business_hours_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_business_hours" ADD CONSTRAINT "support_business_hours_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "support_special_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"day" date NOT NULL,
	"name" varchar(80) NOT NULL,
	"periods" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "support_special_days" ADD CONSTRAINT "support_special_days_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_special_days" ADD CONSTRAINT "support_special_days_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "support_special_days_org_day_uidx" ON "support_special_days" USING btree ("org_id","day");--> statement-breakpoint
ALTER TABLE "support_business_hours" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "support_business_hours" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "support_business_hours"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "support_special_days" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "support_special_days" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "support_special_days"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
-- Configuracao editavel: o admin muda a semana, cadastra e remove dia especial.
GRANT SELECT, INSERT, UPDATE, DELETE ON "support_business_hours" TO guilda_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "support_special_days" TO guilda_app;
```

- [ ] **Step 2: Acrescentar a entrada no journal**, depois da 0109:

```json
    {
      "idx": 110,
      "version": "7",
      "when": 1795528800000,
      "tag": "0110_support-agent-mode-business-hours",
      "breakpoints": true
    }
```

- [ ] **Step 3: Atualizar `src/db/schema/support.ts`**
  - Novo enum, perto dos outros: `export const supportAgentMode = pgEnum("support_agent_mode", ["off", "test", "live"]);`
  - Em `supportAgentSettings`:
    - acrescentar `agentMode: supportAgentMode("agent_mode").notNull().default("off")`;
    - manter `testEnabled` com o comentário `// Legado (0110): o modo agora é agent_mode; a coluna fica sem uso.`;
    - trocar o check `support_agent_settings_enabled_check` por `check("support_agent_settings_mode_keyword_check", sql\`${t.agentMode} <> 'test' OR ${t.testKeyword} IS NOT NULL\`)`.
  - Comentário em `aiTestStartedAt`: `// Início da rodada do agente (teste ou todos); o nome é histórico.`
  - Tabelas novas, com o padrão do arquivo (FK de `org_id` para `organization`, `updated_by` e `created_by` para `user`, `date("day", { mode: "string" })`, `jsonb`), índice único `support_special_days_org_day_uidx` em `(orgId, day)`:

```ts
export const supportBusinessHours = pgTable("support_business_hours", {
  orgId: text("org_id").primaryKey().references(() => organization.id, { onDelete: "cascade" }),
  week: jsonb("week").$type<Record<string, [string, string][]>>().notNull(),
  updatedBy: text("updated_by").references(() => user.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const supportSpecialDays = pgTable(
  "support_special_days",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    day: date("day", { mode: "string" }).notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    periods: jsonb("periods").$type<[string, string][]>().notNull().default([]),
    createdBy: text("created_by").references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("support_special_days_org_day_uidx").on(t.orgId, t.day)],
);
```

- [ ] **Step 4: Rodar `npx tsc --noEmit`**. Ainda deve falhar só onde `testEnabled` é lido para decidir. A Task 3 conserta.

- [ ] **Step 5: Commit** (junto com a Task 3, para não deixar a develop sem compilar).

### Task 3: Modo do agente no lugar do interruptor

**Files:**
- Modify: `src/domain/support-agent.ts`, `src/domain/support-agent.test.ts`
- Modify: `src/lib/support/agent/settings.ts`, `src/lib/support/agent/turn.ts:63`
- Modify: `src/lib/whatsapp/outbound-worker.ts:55,133`
- Modify: `src/lib/support/inbox.ts:204-205`
- Modify: `src/lib/support/agent/agent.db.test.ts`, `src/lib/support/inbox.db.test.ts:591`

- [ ] **Step 1: Testes do domínio** (`support-agent.test.ts`):
  - troca o `ok` por `{ ..., mode: "test" as const }`;
  - o caso desligado vira `agentDeliveryBlock({ ...ok, mode: "off" })` → `/desligado/`;
  - acrescenta: `expect(agentDeliveryBlock({ ...ok, mode: "live" })).toBeNull()`.

- [ ] **Step 2: `src/domain/support-agent.ts`**

```ts
export type AgentMode = "off" | "test" | "live";
export const AGENT_MODES: readonly AgentMode[] = ["off", "test", "live"];

/**
 * Mensagem da IA só sai à Meta com o agente ligado (teste ou todos), dentro
 * da rodada que a gerou e sem pessoa no comando. Devolve o motivo, ou null.
 */
export function agentDeliveryBlock(input: { payloadRound: unknown; roundStartedAt: Date | null; status: string; mode: AgentMode }): string | null {
  if (input.mode === "off") return "Agente de IA desligado: a mensagem da IA ficou na Guilda.";
  const round = typeof input.payloadRound === "string" ? new Date(input.payloadRound).getTime() : Number.NaN;
  if (!input.roundStartedAt || round !== input.roundStartedAt.getTime()) {
    return "Mensagem da IA fora da rodada do agente: ficou na Guilda.";
  }
  if (input.status === "human_active" || input.status === "resolved") {
    return "Uma pessoa assumiu a conversa: a mensagem da IA ficou na Guilda.";
  }
  return null;
}
```

- [ ] **Step 3: `src/lib/support/agent/settings.ts`** (substitui o tipo, a leitura e a gravação; `startTestRound` vira `startAgentRound`)

```ts
export type AgentSettings = { mode: AgentMode; testKeyword: string | null };

export async function loadAgentSettings(tx: OrgTx, orgId: string): Promise<AgentSettings> {
  const [row] = await tx.select({ mode: s.agentMode, testKeyword: s.testKeyword }).from(s).where(eq(s.orgId, orgId)).limit(1);
  return row ?? { mode: "off", testKeyword: null };
}

/**
 * Só admin chega aqui (a action confere). "Só teste" exige a palavra; em "Todos"
 * ela é opcional e ainda reinicia a rodada. Desligar é o freio: a rodada aberta
 * vai para uma pessoa e o worker de saída segura o que já estava na fila.
 */
export async function saveAgentSettings(
  tx: OrgTx,
  input: { orgId: string; userId: string; mode: AgentMode; keyword: string; now: Date },
): Promise<ActionResult<{ closedRounds: number }>> {
  const typed = input.keyword.trim();
  const keyword = typed ? normalizeTestKeyword(typed) : null;
  if (typed && !keyword) return err("Use uma palavra só, de 3 a 40 letras ou números, sem espaço.");
  if (input.mode === "test" && !keyword) return err("Informe a palavra-chave para ligar o teste.");
  const values = { agentMode: input.mode, testKeyword: keyword, updatedBy: input.userId, updatedAt: input.now };
  await tx.insert(s).values({ orgId: input.orgId, ...values }).onConflictDoUpdate({ target: s.orgId, set: values });
  if (input.mode !== "off") return { ok: true, data: { closedRounds: 0 } };
  // ...o mesmo fechamento de rodadas de hoje, com aiPauseReason "agent_disabled" e detail.reason "agent_disabled".
}

/** Abre (ou reinicia) a rodada: pela palavra-chave ou por conversa nova com o agente para todos. */
export async function startAgentRound(tx: OrgTx, input: { orgId: string; conversationId: string; at: Date; reason: "test_keyword" | "agent_live" }): Promise<void> {
  // corpo igual ao de startTestRound; o evento grava detail: { reason: input.reason }
}
```

- [ ] **Step 4: Ligações**
  - **`turn.ts:63`:** `if ((await loadAgentSettings(tx, input.orgId)).mode === "off") return "agente_desligado";`
  - **`outbound-worker.ts`:**
    - o select passa a ler `agentMode: schema.supportAgentSettings.agentMode` no lugar de `testEnabled`;
    - a chamada passa `mode: item.agentMode ?? "off"`.
  - **`inbox.ts` `eventLabel`:**
    - `ai_resumed` + `agent_live` → `"Agente de IA começou o atendimento"`;
    - `ai_paused` + (`test_disabled` | `agent_disabled`) → `` `${who} desligou o agente de IA` ``.
    - Os dois rótulos antigos continuam valendo para o histórico.

- [ ] **Step 5: Ajustar os testes de banco**
  - **`agent.db.test.ts`:**
    - `setAgent(enabled, keyword)` passa a chamar `saveAgentSettings` com `mode: enabled ? "test" : "off"`;
    - as mensagens de bloqueio esperadas passam a ser `"Agente de IA desligado: a mensagem da IA ficou na Guilda."` e `"Mensagem da IA fora da rodada do agente: ficou na Guilda."`;
    - o rótulo esperado passa a ser `"Bruno desligou o agente de IA"`;
    - `aiPauseReason` esperado: `"agent_disabled"`;
    - o teste "a configuração recusa palavra inválida" usa `mode`.
  - **`inbox.db.test.ts:591`:** o `lastError` passa a ser `"Agente de IA desligado: a mensagem da IA ficou na Guilda."`.
  - **`inbound-worker.ts:338-341`:** troca por

```ts
const settings = await loadAgentSettings(tx, input.orgId);
if (settings.mode !== "off" && matchTestKeyword(input.message.text ?? null, settings.testKeyword).matched) {
  await startAgentRound(tx, { orgId: input.orgId, conversationId: conversation.id, at: input.message.occurredAt, reason: "test_keyword" });
}
```

- [ ] **Step 6: Teste da migração.** Em `agent.db.test.ts`, um teste que grava `test_enabled = true` e `agent_mode = 'off'` como dono (`RESET ROLE`), roda de novo o `UPDATE` da 0110 e confere `agent_mode = 'test'`, como `inbox.db.test.ts` faz com a 0108.

- [ ] **Step 7: Rodar**

`npx tsc --noEmit` e `npx vitest run src/domain/support-agent.test.ts src/lib/support/agent src/lib/support/inbox.db.test.ts --maxWorkers=1 --no-file-parallelism`
Expected: PASS.

- [ ] **Step 8: Commit** (Tasks 2 e 3): `feat(atendimento): modo do agente (desligado, so teste, todos) e tabelas do expediente`

### Task 4: No modo "Todos", conversa nova abre rodada

**Files:**
- Modify: `src/lib/whatsapp/inbound-worker.ts` (perto da linha 338)
- Test: `src/lib/support/agent/agent.db.test.ts`

- [ ] **Step 1: Teste**

```ts
test("com o agente para todos, conversa nova abre rodada sem palavra; a que está com a equipe não", async () => {
  const { saveAgentSettings } = await import("./settings");
  setClock(2000);
  // Já existe e está com a equipe antes de ligar.
  const existing = await customerSays("5554900000090", "Oi, sobre a guia", 1950);
  expect(await conversation(existing)).toMatchObject({ status: "needs_human", aiTestStartedAt: null });
  await tx((t) => saveAgentSettings(t, { orgId: ORG, userId: "admin", mode: "live", keyword: "", now: new Date() }));

  const fresh = await customerSays("5554900000091", "Preciso da guia do DAS", 1990);
  expect(await conversation(fresh)).toMatchObject({ status: "ai_active", aiTestStartedAt: at(1990) });
  await customerSays("5554900000090", "Alguém pode ver?", 1995);
  expect(await conversation(existing)).toMatchObject({ status: "needs_human", aiTestStartedAt: null });

  replies = [{ setor: "fiscal" }];
  await cycle();
  expect((await aiTexts(fresh)).at(-1)).toMatch(/Encaminhei ao setor Fiscal/);
  await tx((t) => saveAgentSettings(t, { orgId: ORG, userId: "admin", mode: "off", keyword: "", now: new Date() }));
});
```

- [ ] **Step 2: Rodar e ver falhar** (`aiTestStartedAt` nulo na conversa nova).

- [ ] **Step 3: Implementar** (`inbound-worker.ts`, no lugar do bloco da Task 3)

```ts
// Agente (2026-11-23): a palavra-chave abre ou reinicia a rodada no teste e no modo
// "Todos"; no modo "Todos", toda conversa nova já começa com o agente.
if (input.message.direction === "inbound" && input.message.actor === "customer") {
  const settings = await loadAgentSettings(tx, input.orgId);
  const at = input.message.occurredAt;
  if (settings.mode !== "off" && matchTestKeyword(input.message.text ?? null, settings.testKeyword).matched) {
    await startAgentRound(tx, { orgId: input.orgId, conversationId: conversation.id, at, reason: "test_keyword" });
  } else if (settings.mode === "live" && conversation.created) {
    await startAgentRound(tx, { orgId: input.orgId, conversationId: conversation.id, at, reason: "agent_live" });
  }
}
```

- [ ] **Step 4: Rodar** `npx vitest run src/lib/support/agent/agent.db.test.ts --maxWorkers=1`. Expected: PASS.

- [ ] **Step 5: Commit:** `feat(atendimento): agente para todos abre rodada em conversa nova`

### Task 5: Repositório do expediente

**Files:**
- Create: `src/lib/support/business-hours.ts`
- Test: `src/lib/support/business-hours.db.test.ts`

- [ ] **Step 1: Teste (PGlite como `guilda_app`)**
  - Usa o mesmo cabeçalho de `agent.db.test.ts`: PGlite, `applyMigrations`, organização e usuário admin, `SET ROLE guilda_app`.
  - Casos:
    1. Sem linha, `loadBusinessSchedule` devolve `week: null`.
    2. `saveBusinessWeek` grava e a leitura devolve a semana. Gravar de novo atualiza.
    3. `addSpecialDays` grava dois dias e pula a data repetida (devolve `{ added: 1 }` na segunda chamada com uma nova e uma repetida).
    4. `loadBusinessSchedule(tx, orgId, "2026-12-01")` não traz dia especial anterior a 01/12.
    5. `removeSpecialDay` apaga só o da organização.
    6. Outra organização não enxerga as linhas (RLS).
    7. `clearBusinessWeek` volta a `week: null`.

- [ ] **Step 2: Implementar**

```ts
import "server-only";

import { and, asc, eq, gte } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { parsePeriods, parseWeek, type BusinessSchedule, type SpecialDay, type WeekSchedule } from "@/domain/business-hours";

const hoursTable = schema.supportBusinessHours;
const daysTable = schema.supportSpecialDays;

export type StoredSpecialDay = SpecialDay & { id: string };

/** Semana e dias especiais de hoje em diante (dia em Brasília, AAAA-MM-DD). */
export async function loadBusinessSchedule(tx: OrgTx, orgId: string, today: string): Promise<BusinessSchedule & { specialDays: StoredSpecialDay[] }> {
  const [row] = await tx.select({ week: hoursTable.week }).from(hoursTable).where(eq(hoursTable.orgId, orgId)).limit(1);
  const days = await tx
    .select({ id: daysTable.id, day: daysTable.day, name: daysTable.name, periods: daysTable.periods })
    .from(daysTable)
    .where(and(eq(daysTable.orgId, orgId), gte(daysTable.day, today)))
    .orderBy(asc(daysTable.day));
  return {
    week: row ? parseWeek(row.week) : null,
    specialDays: days.map((day) => ({ id: day.id, day: day.day, name: day.name, periods: parsePeriods(day.periods) })),
  };
}

export async function saveBusinessWeek(tx: OrgTx, input: { orgId: string; userId: string; week: WeekSchedule; now: Date }): Promise<void> {
  const week = Object.fromEntries(Object.entries(input.week).map(([day, periods]) => [day, periods.map(([start, end]) => [start, end])])) as Record<string, [string, string][]>;
  const values = { week, updatedBy: input.userId, updatedAt: input.now };
  await tx.insert(hoursTable).values({ orgId: input.orgId, ...values }).onConflictDoUpdate({ target: hoursTable.orgId, set: values });
}

/** Sem semana, o escritório volta a contar como sempre aberto. */
export async function clearBusinessWeek(tx: OrgTx, orgId: string): Promise<void> {
  await tx.delete(hoursTable).where(eq(hoursTable.orgId, orgId));
}

/** Grava os dias novos; data já cadastrada fica como estava. */
export async function addSpecialDays(tx: OrgTx, input: { orgId: string; userId: string; days: readonly SpecialDay[] }): Promise<{ added: number }> {
  if (input.days.length === 0) return { added: 0 };
  const inserted = await tx
    .insert(daysTable)
    .values(input.days.map((day) => ({
      orgId: input.orgId,
      day: day.day,
      name: day.name,
      periods: day.periods.map(([start, end]) => [start, end] as [string, string]),
      createdBy: input.userId,
    })))
    .onConflictDoNothing()
    .returning({ id: daysTable.id });
  return { added: inserted.length };
}

export async function removeSpecialDay(tx: OrgTx, input: { orgId: string; id: string }): Promise<boolean> {
  const removed = await tx.delete(daysTable).where(and(eq(daysTable.orgId, input.orgId), eq(daysTable.id, input.id))).returning({ id: daysTable.id });
  return removed.length > 0;
}
```

- [ ] **Step 3: Rodar** `npx vitest run src/lib/support/business-hours.db.test.ts --maxWorkers=1`. Expected: PASS.

- [ ] **Step 4: Commit:** `feat(atendimento): guardar expediente e dias especiais`

### Task 6: Falas fora do expediente

**Files:**
- Modify: `src/lib/support/agent/decision.ts`
- Test: `src/lib/support/agent/decision.test.ts`

- [ ] **Step 1: Testes**
  - Com `NOW` sendo 09:00 de 19/11/2026 (quinta) e `CLOSED = { open: false, nextOpening: new Date("2026-11-20T11:00:00Z"), closesAt: null }` (amanhã às 8h):
    1. `decideBeforeClassifying({ current: "oi", facts: FIRST, runsInRound: 0, clans: CLANS, now: NOW, hours: CLOSED })` dá `ask_subject` com o texto `"Bom dia! Estamos fora do horário de atendimento e a equipe retorna amanhã às 8h. Enquanto isso, já adianto seu atendimento. " + ASK_SUBJECT_TEXT`.
    2. `decideAfterClassifying({ result: result({}), facts: SPOKE, clans: CLANS, now: NOW, hours: CLOSED })` dá handoff com o texto `"Encaminhei ao setor Fiscal. A equipe retorna amanhã às 8h e continua daqui."`.
    3. Handoff na primeira fala fora do expediente (`facts: FIRST`, `turn_cap`) dá `"Bom dia! Estamos fora do horário de atendimento. Encaminhei para a nossa equipe, que retorna amanhã às 8h e continua daqui."`. O aviso não sai duplicado.
    4. Sem `hours`, ou com `hours: ALWAYS_OPEN`, os textos de hoje não mudam: os testes atuais continuam passando.

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Implementar em `decision.ts`**
  - `import { ALWAYS_OPEN, openingPhrase, type HoursNow } from "@/domain/business-hours";`
  - `opening(facts, now, hours)`:
    - `facts.aiSpoke` → `""`;
    - aberto → `` `${greeting}! ` ``;
    - fechado → `` `${greeting}! Estamos fora do horário de atendimento e a equipe retorna ${openingPhrase(hours.nextOpening, now)}. Enquanto isso, já adianto seu atendimento. ` ``.
  - `handoff`:
    - recebe `hours`, com `back = openingPhrase(hours.nextOpening, now)`;
    - aberto → os textos de hoje;
    - fechado → `` `Encaminhei ao setor ${label}. A equipe retorna ${back} e continua daqui.` `` ou `` `Encaminhei para a nossa equipe, que retorna ${back} e continua daqui.` ``;
    - começo fechado na primeira fala → `` `${greeting}! Estamos fora do horário de atendimento. ` ``.
  - `decideBeforeClassifying` e `decideAfterClassifying` ganham `hours?: HoursNow` (padrão `ALWAYS_OPEN`) e o repassam.

- [ ] **Step 4: Rodar** `npx vitest run src/lib/support/agent/decision.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit:** `feat(atendimento): agente avisa fora do expediente quando a equipe volta`

### Task 7: O turno lê o expediente e agenda o aviso à equipe

**Files:**
- Modify: `src/lib/support/agent/turn.ts`
- Modify: `src/lib/whatsapp/member-notifications.ts` (`enqueueMemberSupportHandoffNotifications`)
- Test: `src/lib/support/agent/agent.db.test.ts`

- [ ] **Step 1: Teste**

```ts
test("fora do expediente: o agente avisa, encaminha e o aviso à equipe espera a abertura", async () => {
  const { saveBusinessWeek, clearBusinessWeek } = await import("../business-hours");
  const open = [["08:00", "12:00"], ["13:30", "18:00"]] as const;
  // Só segunda: o relógio do teste é quinta, 19/11, às 9h (T0) mais os segundos.
  await tx((t) => saveBusinessWeek(t, { orgId: ORG, userId: "admin", week: { 1: open, 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] }, now: new Date() }));
  await setAgent(true);
  setClock(3000);
  const id = await customerSays("5554900000092", "batata, preciso da guia do DAS da Academia", 2990);
  replies = [{ setor: "fiscal" }];
  await cycle();
  expect((await aiTexts(id)).at(-1)).toBe(
    "Bom dia! Estamos fora do horário de atendimento. Encaminhei ao setor Fiscal. A equipe retorna segunda-feira, 23/11, às 8h e continua daqui.",
  );
  const notices = await tx((t) => t.select().from(schema.memberWhatsAppOutbox).where(eq(schema.memberWhatsAppOutbox.supportConversationId, id)));
  expect(notices.length).toBeGreaterThan(0);
  for (const notice of notices) expect(notice.scheduledFor).toEqual(new Date("2026-11-23T11:00:00Z"));
  await tx((t) => clearBusinessWeek(t, ORG));
  await setAgent(false);
});
```

A empresa do encaminhamento depende da Carteira, como no teste "o encaminhamento avisa no WhatsApp". Se o aviso exigir a conversa vinculada, o teste vincula a conversa à `COMPANY` antes do `cycle()`, como os outros testes do arquivo fazem.

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Implementar**
  - **`member-notifications.ts`:**
    - o input de `enqueueMemberSupportHandoffNotifications` ganha `scheduledFor?: Date`;
    - o insert passa `...(input.scheduledFor ? { scheduledFor: input.scheduledFor } : {})`.
  - **`turn.ts`, no claim:**
    - `const schedule = await loadBusinessSchedule(tx, orgId, localClock(new Date()).day);`
    - devolve `schedule`.
  - **`turn.ts`, fora da transação:**
    - `const hours = hoursAt(claimed.schedule, now);`
    - passa `hours` às duas `decide*`;
    - `applyAgentDecision` recebe `noticeAt: hours.open ? null : hours.nextOpening`;
    - repassa `scheduledFor: input.noticeAt ?? undefined` no enqueue.
  - Comentário: *"Fora do expediente o aviso à equipe espera a abertura (2026-11-23, decisão do Bruno). A regra das 24 horas da Meta é conferida no envio."*

- [ ] **Step 4: Rodar** `npx vitest run src/lib/support/agent --maxWorkers=1 --no-file-parallelism`. Expected: PASS.

- [ ] **Step 5: Commit:** `feat(atendimento): turno do agente le o expediente e agenda o aviso a equipe`

### Task 8: Actions (modo, expediente e dias especiais)

**Files:**
- Create: `src/app/(app)/atendimento/configuracoes/agent-actions.ts` (apaga `agent-test-actions.ts`)
- Create: `src/app/(app)/atendimento/configuracoes/business-hours-actions.ts`

- [ ] **Step 1: `agent-actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { withOrgTx } from "@/db/org-tx";
import { AGENT_MODES } from "@/domain/support-agent";
import { err, requireMemberContext, type ActionResult } from "@/lib/action-context";
import { isAdminRole } from "@/lib/session";
import { saveAgentSettings } from "@/lib/support/agent/settings";

const agentSchema = z.object({
  mode: z.enum(AGENT_MODES as unknown as ["off", "test", "live"]),
  keyword: z.string().max(60, "Use uma palavra só."),
});

/** Modo do agente (2026-11-23): só admin liga, desliga ou troca a palavra-chave. */
export async function saveAgentMode(input: z.input<typeof agentSchema>): Promise<ActionResult<{ closedRounds: number }>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  if (!isAdminRole(ctx.role)) return err("Somente admin ou owner muda o agente de IA.");
  const parsed = agentSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const result = await withOrgTx(ctx.orgId, (tx) =>
    saveAgentSettings(tx, { orgId: ctx.orgId, userId: ctx.userId, mode: parsed.data.mode, keyword: parsed.data.keyword, now: new Date() }),
  );
  if (result.ok) {
    revalidatePath("/atendimento/configuracoes");
    revalidatePath("/atendimento");
  }
  return result;
}
```

- [ ] **Step 2: `business-hours-actions.ts`**
  - Mesmo cabeçalho: `"use server"`, `requireMemberContext`, `isAdminRole`, Zod, `revalidatePath("/atendimento/configuracoes")`.
  - **`saveWeek(input)`:**
    - schema `z.object({ 1: periods, 2: periods, ..., 7: periods })`, com `const period = z.tuple([z.string(), z.string()]); const periods = z.array(period).max(2);`;
    - para cada dia, `checkPeriods`, e o erro vem com o nome do dia (`` `${WEEKDAY_LABELS[day]}: ${problem}` ``);
    - grava com `saveBusinessWeek`.
  - **`clearWeek()`:** `clearBusinessWeek`.
  - **`addSpecialDaysAction(input: { days: { day; name; periods }[] })`:**
    - até 30 dias;
    - `isValidDay(day)`;
    - nome `trim()` de 1 a 80;
    - `checkPeriods`;
    - devolve `{ added }`.
  - **`removeSpecialDayAction({ id })`:** `z.string().uuid()`, e `removeSpecialDay`. Se não achar, devolve `err("Dia especial não encontrado.")`.

- [ ] **Step 3: `npx tsc --noEmit` e `npx eslint` nos dois arquivos.** Expected: limpo.

- [ ] **Step 4: Commit:** `feat(atendimento): actions do modo do agente e do expediente`

### Task 9: Tela (Agente de IA, Expediente, Dias especiais)

**Files:**
- Create: `agent-panel.tsx` (apaga `agent-test-panel.tsx`), `business-hours-panel.tsx`, `special-days-panel.tsx`, todos em `src/app/(app)/atendimento/configuracoes/`
- Modify: `page.tsx`

- [ ] **Step 1: `agent-panel.tsx`**
  - Mesma moldura do painel atual (`panel-cut`, ícone `Bot`, `<h2>Agente de IA</h2>`, aviso `aiReady`).
  - Controle de três botões `aria-pressed` (Desligado · Só teste · Todos os clientes), com uma frase do que cada um faz:
    - Desligado: "A IA só lê as conversas para sugerir; nada vai ao cliente."
    - Só teste: "Só quem começa a mensagem com a palavra-chave conversa com a IA."
    - Todos os clientes: "Toda conversa nova começa com a IA: ela pergunta, responde pela base e encaminha ao clã."
  - Campo da palavra-chave visível em "Só teste" (obrigatório) e em "Todos" ("opcional: reinicia a rodada numa conversa que já está com a equipe").
  - Salvar chama `saveAgentMode`. Se o modo escolhido for `live` e o salvo não for, abre antes um `Dialog` de confirmação com o texto da privacidade e os botões "Ligar para todos" e "Cancelar".
  - Toast:
    - "Agente desligado." (ou "N conversas foram para a equipe.");
    - "Teste do agente ligado.";
    - "Agente atendendo todos os clientes."

- [ ] **Step 2: `business-hours-panel.tsx`**
  - Props: `initial: WeekSchedule | null` e `status: string` (a frase calculada no servidor).
  - Estado: `Record<IsoWeekday, Period[]>`. Sem semana salva, começa com seg a sex 08:00–12:00 e 13:30–18:00, sáb e dom fechados, e um aviso "Ainda não salvo: enquanto isso o escritório conta como sempre aberto".
  - Uma linha por dia:
    - rótulo do dia;
    - caixa "Aberto" (desmarcar zera os períodos);
    - os períodos com dois `<input type="time" step={300}>`, botão de remover e "+ período" até dois.
  - Em tela estreita, os horários quebram embaixo do dia (`flex flex-wrap`).
  - Botões: "Salvar expediente" (`saveWeek`) e, se havia semana salva, "Remover expediente" (`clearWeek`), com confirmação.
  - No topo, a frase `status`, por exemplo "Agora: aberto até 12h".

- [ ] **Step 3: `special-days-panel.tsx`**
  - Props: `days: { id; day; name; periods }[]` e `suggestions: { year: number; holidays: HolidaySuggestion[] }[]`, com o ano corrente e o seguinte, calculados no servidor e sem as datas já cadastradas.
  - Lista:
    - data "24/12/2026 · quinta-feira";
    - nome;
    - "Fechado" ou "8h–12h";
    - botão remover (`removeSpecialDayAction`).
  - "+ Dia especial" abre um formulário em linha:
    - data (`type="date"`);
    - nome;
    - rádio "Fechado o dia todo" ou "Horário próprio", com até 2 períodos;
    - salvar com `addSpecialDaysAction({ days: [ ... ] })`.
  - "Sugerir feriados" abre um `Dialog`:
    - por ano, as caixas dos feriados, com os obrigatórios marcados, os opcionais desmarcados e "(ponto facultativo)";
    - "Adicionar N" grava os marcados como fechado o dia todo.
  - Toast: "N dias adicionados".

- [ ] **Step 4: `page.tsx`**
  - Carrega `loadBusinessSchedule(tx, orgId, localClock(now).day)`.
  - Calcula `hoursAt` e monta a frase:
    - sem semana: "Sem expediente cadastrado: o agente não avisa fora do horário";
    - aberto: `` `Agora: aberto até ${hourLabel(localClock(closesAt).minutes)}` ``;
    - fechado: `` `Agora: fechado · abre ${openingPhrase(nextOpening, now)}` ``.
  - Monta as sugestões dos dois anos, sem as datas já cadastradas.
  - Renderiza `AgentPanel`, `BusinessHoursPanel` e `SpecialDaysPanel` no lugar do `AgentTestPanel`.

- [ ] **Step 5: Verificar renderizado**
  - Harness temporário `render-harness.tmp.test.ts`, que importa uma `render-harness-view.tmp.tsx`:
    - CSS de `.next/static/chunks/*.css` com as fontes embutidas;
    - `<html>` com as classes `__variable` das fontes;
    - saída em `.tmp/configuracoes/index.html`.
  - Renderiza os três cartões em estados:
    - agente em "Todos";
    - semana com almoço;
    - dia sem período;
    - 3 dias especiais com nomes longos.
  - Mede em 375 e 1280 px que `document.documentElement.scrollWidth <= innerWidth`, que os horários não estouram o cartão e que os botões não se sobrepõem.
  - Apaga o harness depois.

- [ ] **Step 6: Commit:** `feat(atendimento): tela do agente, do expediente e dos dias especiais`

### Task 10: Documentação, verificação e PR

- [ ] **CLAUDE.md**, seção Atendimento: um bullet "**Agente para todos e expediente (2026-11-23, pedido do Bruno)**" com:
  - os três modos e o freio;
  - conversa nova abre rodada;
  - o expediente com semana, dias especiais e sugestão de feriados;
  - a fala fora do expediente;
  - o aviso à equipe agendado e o risco das 24 horas;
  - "o aviso de privacidade continua pendente e é do Bruno antes de ligar Todos".
- [ ] Spec: seção "Feito assim (23/11/2026)" com o que mudou em relação ao desenho, se algo mudou.
- [ ] Suíte inteira: `npx vitest run --maxWorkers=2`. `npx tsc --noEmit`. `npm run lint`. `npx next build` sem aviso de rastreamento.
- [ ] Commit, push na develop, PR develop → main com o corpo em português e o rodapé do Claude Code. Pedir ao Bruno o "pode mesclar".
- [ ] Teste real depois de publicar (Bruno):
  1. Cadastrar o expediente.
  2. Deixar em "Só teste".
  3. Mandar a palavra fora do horário e conferir o aviso e o encaminhamento.
  4. Só depois do aviso de privacidade, ligar "Todos".
