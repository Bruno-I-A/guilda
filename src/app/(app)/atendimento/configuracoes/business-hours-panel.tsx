"use client";

import { Clock, LoaderCircle, Plus, Save, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  checkPeriods,
  MAX_PERIODS_PER_DAY,
  WEEKDAY_LABELS,
  WEEKDAYS,
  type IsoWeekday,
  type WeekSchedule,
} from "@/domain/business-hours";

import { clearWeek, saveWeek } from "./business-hours-actions";

type EditablePeriod = [string, string];
type EditableWeek = Record<IsoWeekday, EditablePeriod[]>;

const WORKDAY: EditablePeriod[] = [["08:00", "12:00"], ["13:30", "18:00"]];
const SUGGESTED_WEEK: EditableWeek = { 1: WORKDAY, 2: WORKDAY, 3: WORKDAY, 4: WORKDAY, 5: WORKDAY, 6: [], 7: [] };

function editable(week: WeekSchedule | null): EditableWeek {
  const source = week ?? SUGGESTED_WEEK;
  return Object.fromEntries(WEEKDAYS.map((day) => [day, source[day].map(([start, end]) => [start, end])])) as EditableWeek;
}

function capitalized(text: string): string {
  return text.charAt(0).toLocaleUpperCase("pt-BR") + text.slice(1);
}

/**
 * Expediente do escritório (2026-11-23): cada dia aberto ou fechado, com até
 * dois períodos (manhã e tarde). Fora dele, o agente avisa quando a equipe volta.
 */
export function BusinessHoursPanel({ initial, status }: { initial: WeekSchedule | null; status: string }) {
  const router = useRouter();
  const [week, setWeek] = useState<EditableWeek>(() => editable(initial));
  const [confirmClear, setConfirmClear] = useState(false);
  const [pending, start] = useTransition();

  function update(day: IsoWeekday, periods: EditablePeriod[]) {
    setWeek((current) => ({ ...current, [day]: periods }));
  }

  function save() {
    for (const day of WEEKDAYS) {
      const problem = checkPeriods(week[day]);
      if (problem) {
        toast.error(`${capitalized(WEEKDAY_LABELS[day])}: ${problem}`);
        return;
      }
    }
    start(async () => {
      const result = await saveWeek(week);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Expediente salvo.");
      router.refresh();
    });
  }

  function clear() {
    setConfirmClear(false);
    start(async () => {
      const result = await clearWeek();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setWeek(editable(null));
      toast.success("Expediente removido. O escritório conta como sempre aberto.");
      router.refresh();
    });
  }

  return (
    <section className="panel-cut grid min-w-0 grid-cols-1 gap-5 border border-border bg-card p-5" aria-busy={pending}>
      <div className="flex min-w-0 gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center border border-primary/30 bg-primary/10 text-primary">
          <Clock className="size-5" aria-hidden />
        </div>
        <div className="min-w-0">
          <h2>Expediente</h2>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            Horário de Brasília. Fora dele, o agente faz a triagem igual, avisa o cliente quando a equipe volta e o aviso à
            equipe espera a abertura.
          </p>
          <p className="mt-2 text-sm font-medium" aria-live="polite">{status}</p>
        </div>
      </div>

      {!initial ? (
        <p className="text-xs text-muted-foreground">
          Ainda não salvo: este é só um ponto de partida. Até salvar, o escritório conta como sempre aberto.
        </p>
      ) : null}

      <ul className="grid min-w-0 divide-y divide-border border-y border-border">
        {WEEKDAYS.map((day) => {
          const periods = week[day];
          const open = periods.length > 0;
          return (
            <li key={day} className="grid min-w-0 gap-2 py-3 sm:grid-cols-[10rem_1fr] sm:items-center">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 shrink-0 accent-primary"
                  checked={open}
                  onChange={(event) => update(day, event.target.checked ? [["08:00", "18:00"]] : [])}
                />
                <span className="font-medium">{capitalized(WEEKDAY_LABELS[day])}</span>
              </label>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                {!open ? <span className="text-sm text-muted-foreground">Fechado</span> : null}
                {periods.map(([startTime, endTime], index) => (
                  <span key={index} className="flex items-center gap-1">
                    <Input
                      type="time"
                      step={300}
                      aria-label={`${WEEKDAY_LABELS[day]}, início do período ${index + 1}`}
                      className="w-[7.25rem]"
                      value={startTime}
                      onChange={(event) => update(day, periods.map((period, at) => (at === index ? [event.target.value, period[1]] : period)))}
                    />
                    <span className="text-xs text-muted-foreground">às</span>
                    <Input
                      type="time"
                      step={300}
                      aria-label={`${WEEKDAY_LABELS[day]}, fim do período ${index + 1}`}
                      className="w-[7.25rem]"
                      value={endTime}
                      onChange={(event) => update(day, periods.map((period, at) => (at === index ? [period[0], event.target.value] : period)))}
                    />
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Tirar o período ${index + 1} de ${WEEKDAY_LABELS[day]}`}
                      onClick={() => update(day, periods.filter((_, at) => at !== index))}
                    >
                      <X aria-hidden />
                    </Button>
                  </span>
                ))}
                {open && periods.length < MAX_PERIODS_PER_DAY ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => update(day, [...periods, [periods.at(-1)?.[1] ?? "13:30", "18:00"]])}
                  >
                    <Plus aria-hidden /> período
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={save} disabled={pending}>
          {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Save aria-hidden />}
          Salvar expediente
        </Button>
        {initial && !confirmClear ? (
          <Button type="button" variant="ghost" disabled={pending} onClick={() => setConfirmClear(true)}>
            <Trash2 aria-hidden /> Remover expediente
          </Button>
        ) : null}
        {confirmClear ? (
          <span className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">O escritório passa a contar como sempre aberto.</span>
            <Button type="button" size="sm" variant="destructive" onClick={clear}>Remover</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmClear(false)}>Cancelar</Button>
          </span>
        ) : null}
      </div>
    </section>
  );
}
