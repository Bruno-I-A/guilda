"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { withOrgTx } from "@/db/org-tx";
import { checkPeriods, isValidDay, WEEKDAY_LABELS, WEEKDAYS, type SpecialDay, type WeekSchedule } from "@/domain/business-hours";
import { err, requireMemberContext, type ActionResult } from "@/lib/action-context";
import { isAdminRole } from "@/lib/session";
import { addSpecialDays, clearBusinessWeek, removeSpecialDay, saveBusinessWeek } from "@/lib/support/business-hours";

/**
 * Expediente do escritório (2026-11-23): só admin ou owner muda a semana e os
 * dias especiais. O agente lê isso para avisar fora do horário.
 */

const period = z.tuple([z.string().max(5), z.string().max(5)]);
const periods = z.array(period).max(2, "Use no máximo dois períodos por dia.");
const weekSchema = z.object({ 1: periods, 2: periods, 3: periods, 4: periods, 5: periods, 6: periods, 7: periods });
const specialDaySchema = z.object({
  day: z.string().refine(isValidDay, "Data inválida."),
  name: z.string().trim().min(1, "Dê um nome ao dia.").max(80, "Nome com até 80 caracteres."),
  periods,
});
const specialDaysSchema = z.object({ days: z.array(specialDaySchema).min(1).max(30, "No máximo 30 dias por vez.") });
const removeSchema = z.object({ id: z.string().uuid() });

async function adminContext() {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  if (!isAdminRole(ctx.role)) return err("Somente admin ou owner muda o expediente.");
  return ctx;
}

function refresh() {
  revalidatePath("/atendimento/configuracoes");
}

export async function saveWeek(input: z.input<typeof weekSchema>): Promise<ActionResult> {
  const ctx = await adminContext();
  if (!ctx.ok) return ctx;
  const parsed = weekSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Expediente inválido.");
  for (const day of WEEKDAYS) {
    const problem = checkPeriods(parsed.data[day]);
    if (problem) return err(`${WEEKDAY_LABELS[day]}: ${problem}`);
  }
  const week = parsed.data as WeekSchedule;
  await withOrgTx(ctx.orgId, (tx) => saveBusinessWeek(tx, { orgId: ctx.orgId, userId: ctx.userId, week, now: new Date() }));
  refresh();
  return { ok: true };
}

/** Sem semana, o escritório volta a contar como sempre aberto. */
export async function clearWeek(): Promise<ActionResult> {
  const ctx = await adminContext();
  if (!ctx.ok) return ctx;
  await withOrgTx(ctx.orgId, (tx) => clearBusinessWeek(tx, ctx.orgId));
  refresh();
  return { ok: true };
}

export async function addSpecialDaysAction(input: z.input<typeof specialDaysSchema>): Promise<ActionResult<{ added: number }>> {
  const ctx = await adminContext();
  if (!ctx.ok) return ctx;
  const parsed = specialDaysSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Dia especial inválido.");
  for (const day of parsed.data.days) {
    const problem = checkPeriods(day.periods);
    if (problem) return err(`${day.name}: ${problem}`);
  }
  const days: SpecialDay[] = parsed.data.days;
  const result = await withOrgTx(ctx.orgId, (tx) => addSpecialDays(tx, { orgId: ctx.orgId, userId: ctx.userId, days }));
  refresh();
  return { ok: true, data: result };
}

export async function removeSpecialDayAction(input: z.input<typeof removeSchema>): Promise<ActionResult> {
  const ctx = await adminContext();
  if (!ctx.ok) return ctx;
  const parsed = removeSchema.safeParse(input);
  if (!parsed.success) return err("Dia especial inválido.");
  const removed = await withOrgTx(ctx.orgId, (tx) => removeSpecialDay(tx, { orgId: ctx.orgId, id: parsed.data.id }));
  if (!removed) return err("Dia especial não encontrado.");
  refresh();
  return { ok: true };
}
