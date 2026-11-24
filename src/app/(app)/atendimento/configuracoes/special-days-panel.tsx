"use client";

import { CalendarDays, LoaderCircle, Plus, Sparkles, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  checkPeriods,
  hourLabel,
  minutesOf,
  WEEKDAY_LABELS,
  weekdayOf,
  type HolidaySuggestion,
  type Period,
} from "@/domain/business-hours";

import { addSpecialDaysAction, removeSpecialDayAction } from "./business-hours-actions";

export type SpecialDayView = { id: string; day: string; name: string; periods: readonly Period[] };
export type HolidayYear = { year: number; holidays: readonly HolidaySuggestion[] };

function dateLabel(day: string): string {
  const [year, month, date] = day.split("-");
  return `${date}/${month}/${year} · ${WEEKDAY_LABELS[weekdayOf(day)]}`;
}

function periodsLabel(periods: readonly Period[]): string {
  if (periods.length === 0) return "Fechado";
  return periods.map(([start, end]) => `${hourLabel(minutesOf(start) ?? 0)}–${hourLabel(minutesOf(end) ?? 0)}`).join(" e ");
}

/**
 * Dias especiais (2026-11-23): feriados e dias de horário diferente. O dia
 * especial substitui a semana naquela data; sem horário, fecha o dia todo.
 */
export function SpecialDaysPanel({ days, suggestions }: { days: readonly SpecialDayView[]; suggestions: readonly HolidayYear[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [suggesting, setSuggesting] = useState(false);

  function remove(id: string) {
    start(async () => {
      const result = await removeSpecialDayAction({ id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Dia especial removido.");
      router.refresh();
    });
  }

  return (
    <section className="panel-cut grid min-w-0 grid-cols-1 gap-5 border border-border bg-card p-5" aria-busy={pending}>
      <div className="flex min-w-0 gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center border border-primary/30 bg-primary/10 text-primary">
          <CalendarDays className="size-5" aria-hidden />
        </div>
        <div className="min-w-0">
          <h2>Dias especiais</h2>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            Feriados e dias de horário diferente, como véspera de Natal. Naquele dia vale o que estiver aqui, não a semana.
          </p>
        </div>
      </div>

      {days.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum dia especial daqui para frente.</p>
      ) : (
        <ul className="grid min-w-0 divide-y divide-border border-y border-border">
          {days.map((day) => (
            <li key={day.id} className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium" title={day.name}>{day.name}</span>
                <span className="block text-xs text-muted-foreground">{dateLabel(day.day)}</span>
              </span>
              <span className="text-sm">{periodsLabel(day.periods)}</span>
              <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remover ${day.name}`} disabled={pending} onClick={() => remove(day.id)}>
                <Trash2 aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {adding ? <SpecialDayForm onDone={() => setAdding(false)} /> : null}

      <div className="flex flex-wrap gap-2">
        {!adding ? (
          <Button type="button" variant="outline" onClick={() => setAdding(true)}>
            <Plus aria-hidden /> Dia especial
          </Button>
        ) : null}
        <Button type="button" variant="ghost" onClick={() => setSuggesting(true)}>
          <Sparkles aria-hidden /> Sugerir feriados
        </Button>
      </div>

      <HolidaySuggestions open={suggesting} onOpenChange={setSuggesting} suggestions={suggestions} />
    </section>
  );
}

export function SpecialDayForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [day, setDay] = useState("");
  const [name, setName] = useState("");
  const [closed, setClosed] = useState(true);
  const [period, setPeriod] = useState<[string, string]>(["08:00", "12:00"]);

  function save() {
    const periods: [string, string][] = closed ? [] : [period];
    const problem = checkPeriods(periods);
    if (problem) {
      toast.error(problem);
      return;
    }
    start(async () => {
      const result = await addSpecialDaysAction({ days: [{ day, name, periods }] });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.data?.added ? "Dia especial adicionado." : "Essa data já estava cadastrada.");
      onDone();
      router.refresh();
    });
  }

  return (
    <div className="grid min-w-0 gap-3 border border-border p-4" aria-busy={pending}>
      <div className="grid min-w-0 gap-3 sm:grid-cols-[11rem_1fr]">
        <div className="grid gap-1.5">
          <Label htmlFor="special-day-date">Data</Label>
          <Input id="special-day-date" type="date" value={day} onChange={(event) => setDay(event.target.value)} />
        </div>
        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor="special-day-name">Nome</Label>
          <Input id="special-day-name" value={name} maxLength={80} placeholder="Aniversário do município" onChange={(event) => setName(event.target.value)} />
        </div>
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Horário</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="special-day-kind" className="accent-primary" checked={closed} onChange={() => setClosed(true)} />
          Fechado o dia todo
        </label>
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <input type="radio" name="special-day-kind" className="accent-primary" checked={!closed} onChange={() => setClosed(false)} />
          Horário próprio
          {!closed ? (
            <span className="flex items-center gap-1">
              <Input type="time" step={300} aria-label="Início" className="w-[7.25rem]" value={period[0]} onChange={(event) => setPeriod([event.target.value, period[1]])} />
              <span className="text-xs text-muted-foreground">às</span>
              <Input type="time" step={300} aria-label="Fim" className="w-[7.25rem]" value={period[1]} onChange={(event) => setPeriod([period[0], event.target.value])} />
            </span>
          ) : null}
        </label>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={save} disabled={pending || !day || !name.trim()}>
          {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
          Adicionar
        </Button>
        <Button type="button" variant="ghost" onClick={onDone} disabled={pending}>Cancelar</Button>
      </div>
    </div>
  );
}

function HolidaySuggestions({ open, onOpenChange, suggestions }: { open: boolean; onOpenChange: (open: boolean) => void; suggestions: readonly HolidayYear[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // Os obrigatórios vêm marcados; ponto facultativo, desmarcado.
  const [picked, setPicked] = useState<ReadonlySet<string>>(
    () => new Set(suggestions.flatMap((year) => year.holidays.filter((holiday) => !holiday.optional).map((holiday) => holiday.day))),
  );
  const all = suggestions.flatMap((year) => year.holidays);
  const chosen = all.filter((holiday) => picked.has(holiday.day));

  function toggle(day: string) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  function add() {
    start(async () => {
      const result = await addSpecialDaysAction({ days: chosen.map((holiday) => ({ day: holiday.day, name: holiday.name, periods: [] })) });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const added = result.data?.added ?? 0;
      toast.success(added === 1 ? "1 feriado adicionado." : `${added} feriados adicionados.`);
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Feriados nacionais</DialogTitle>
          <DialogDescription>
            Marque os dias em que o escritório fecha. Os municipais e os de meio período você acrescenta em &quot;Dia especial&quot;.
          </DialogDescription>
        </DialogHeader>
        {all.length === 0 ? (
          <p className="text-sm text-muted-foreground">Os feriados deste ano e do próximo já estão cadastrados.</p>
        ) : (
          suggestions.map((year) =>
            year.holidays.length > 0 ? (
              <fieldset key={year.year} className="grid gap-1">
                <legend className="mb-1 text-sm font-medium">{year.year}</legend>
                {year.holidays.map((holiday) => (
                  <label key={holiday.day} className="flex items-start gap-2 py-1 text-sm">
                    <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-primary" checked={picked.has(holiday.day)} onChange={() => toggle(holiday.day)} />
                    <span className="min-w-0">
                      {holiday.name}
                      {holiday.optional ? <span className="text-muted-foreground"> (ponto facultativo)</span> : null}
                      <span className="block text-xs text-muted-foreground">{dateLabel(holiday.day)}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            ) : null,
          )
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="button" onClick={add} disabled={pending || chosen.length === 0}>
            {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
            Adicionar {chosen.length}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
