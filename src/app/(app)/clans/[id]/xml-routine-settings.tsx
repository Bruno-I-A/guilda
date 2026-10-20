"use client";

import { LoaderCircle, Play, Settings2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { XmlRoutineSchedule } from "@/domain/nfse-xml";
import type { XmlRoutineView } from "@/lib/nfse/xml-requests";

import { requestXmlRoutineRun, saveXmlRoutineSettings } from "./nfse-xml-actions";

export function xmlTimeLabel(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function xmlRoutineIsRunning(routine: XmlRoutineView): boolean {
  return Boolean(routine.lastRunStartedAt && (!routine.lastRunFinishedAt || routine.lastRunFinishedAt < routine.lastRunStartedAt));
}

/** "Ligada · todo dia às 06:00". */
export function xmlRoutineScheduleText(schedule: XmlRoutineSchedule): string {
  if (!schedule.enabled) return "Desligada: só roda com \"Rodar agora\"";
  return schedule.frequency === "monthly"
    ? `Ligada · dia ${schedule.dayOfMonth} de cada mês às ${schedule.time}`
    : `Ligada · todo dia às ${schedule.time}`;
}

/** Em que pé está a rodada: pedida, lendo, última leitura ou nunca rodou. */
export function xmlRoutineStatusText(routine: XmlRoutineView): string {
  if (!routine.vaultReady) return "O serviço fiscal ainda não está pronto para a rotina.";
  if (routine.runRequested) return "Rodada pedida; o serviço fiscal começa em instantes.";
  if (xmlRoutineIsRunning(routine)) return `Lendo as notas desde ${xmlTimeLabel(routine.lastRunStartedAt!)}…`;
  if (routine.lastRunStartedAt) return `Última leitura em ${xmlTimeLabel(routine.lastRunFinishedAt ?? routine.lastRunStartedAt)}`;
  return "A rotina ainda não rodou.";
}

/** Recarrega a tela enquanto a rodada está pedida ou lendo (ou um certificado em conferência). */
export function useXmlAutoRefresh(active: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(timer);
  }, [active, router]);
}

export function RunXmlRoutineButton({
  clanId,
  routine,
  primary = false,
}: {
  clanId: string;
  routine: XmlRoutineView;
  primary?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const busy = routine.runRequested || xmlRoutineIsRunning(routine);

  function runNow() {
    startTransition(async () => {
      const result = await requestXmlRoutineRun({ clanId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Rodada pedida ao serviço fiscal. A tela se atualiza sozinha.");
      router.refresh();
    });
  }

  return (
    <Button type="button" variant={primary ? "default" : "outline"} disabled={pending || busy || !routine.vaultReady} onClick={runNow}>
      {pending || busy ? <LoaderCircle className="animate-spin" aria-hidden /> : <Play aria-hidden />}
      {busy ? "Lendo as notas…" : "Rodar agora"}
    </Button>
  );
}

export function XmlRoutineSettingsDialog({ clanId, routine }: { clanId: string; routine: XmlRoutineView }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(routine.schedule.enabled);
  const [frequency, setFrequency] = useState(routine.schedule.frequency);
  const [day, setDay] = useState(String(routine.schedule.dayOfMonth ?? 1));
  const [time, setTime] = useState(routine.schedule.time);
  const [keepSince, setKeepSince] = useState(routine.keepSince ?? "");

  function reset() {
    setEnabled(routine.schedule.enabled);
    setFrequency(routine.schedule.frequency);
    setDay(String(routine.schedule.dayOfMonth ?? 1));
    setTime(routine.schedule.time);
    setKeepSince(routine.keepSince ?? "");
  }

  function save() {
    startTransition(async () => {
      const result = await saveXmlRoutineSettings({
        clanId,
        enabled,
        frequency,
        dayOfMonth: frequency === "monthly" ? Number(day) : null,
        time,
        keepSince: keepSince || null,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Rotina de XML atualizada.");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) reset();
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          <Settings2 aria-hidden /> Configurar rotina
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md" aria-busy={pending}>
        <DialogHeader>
          <DialogTitle>Rotina de XML</DialogTitle>
          <DialogDescription>Quando a Guilda busca no Sistema Nacional as notas que as empresas emitiram.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-primary" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
            Rotina ligada (desligada, só roda com &quot;Rodar agora&quot;)
          </label>
          <div className="grid gap-1">
            <Label htmlFor="xml-frequency">Quando rodar</Label>
            <Select value={frequency} onValueChange={(value) => setFrequency(value as typeof frequency)}>
              <SelectTrigger id="xml-frequency"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Todo dia</SelectItem>
                <SelectItem value="monthly">Só num dia do mês</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {frequency === "monthly" ? (
            <div className="grid gap-1">
              <Label htmlFor="xml-day">Dia do mês (1 a 28)</Label>
              <Input id="xml-day" type="number" min={1} max={28} value={day} onChange={(event) => setDay(event.target.value)} />
            </div>
          ) : null}
          <div className="grid gap-1">
            <Label htmlFor="xml-time">Horário (Brasília)</Label>
            <Input id="xml-time" type="time" value={time} onChange={(event) => setTime(event.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="xml-since">Guardar notas emitidas a partir de</Label>
            <Input id="xml-since" type="month" value={keepSince} onChange={(event) => setKeepSince(event.target.value)} />
            <p className="text-xs text-muted-foreground">Vazio guarda o histórico inteiro que o Sistema Nacional tiver.</p>
          </div>
          <div className="flex justify-end">
            <Button type="button" disabled={pending} onClick={save}>
              {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : null} Salvar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
