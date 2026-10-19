"use client";

import { Download, LoaderCircle, Play, Settings2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { emissionRangeLabel } from "@/domain/nfse-xml";
import type { XmlRoutineView } from "@/lib/nfse/xml-requests";

import { requestXmlRoutineRun, saveXmlRoutineSettings } from "./nfse-xml-actions";

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function XmlRoutinePanel({
  clanId,
  year,
  month,
  routine,
  totalNotes,
  canManage,
}: {
  clanId: string;
  year: number;
  month: number;
  routine: XmlRoutineView;
  totalNotes: number;
  canManage: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(routine.schedule.enabled);
  const [frequency, setFrequency] = useState(routine.schedule.frequency);
  const [day, setDay] = useState(String(routine.schedule.dayOfMonth ?? 1));
  const [time, setTime] = useState(routine.schedule.time);
  const [keepSince, setKeepSince] = useState(routine.keepSince ?? "");
  const running = Boolean(routine.lastRunStartedAt && (!routine.lastRunFinishedAt || routine.lastRunFinishedAt < routine.lastRunStartedAt));
  useEffect(() => {
    if (!routine.runRequested && !running) return;
    const timer = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(timer);
  }, [routine.runRequested, running, router]);

  const status = routine.runRequested
    ? "Rodada pedida; começa em instantes."
    : running ? `Leitura iniciada em ${timeLabel(routine.lastRunStartedAt!)}`
    : routine.lastRunStartedAt
      ? `Lidos em ${timeLabel(routine.lastRunFinishedAt ?? routine.lastRunStartedAt)}`
      : "A rotina ainda não rodou.";

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

  function runNow() {
    startTransition(async () => {
      const result = await requestXmlRoutineRun({ clanId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Rodada pedida ao serviço fiscal.");
      router.refresh();
    });
  }

  return (
    <section className="grid min-w-0 gap-2 border-y py-3" aria-busy={pending}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3>XML das NFS-e prestadas</h3>
          <p className="text-sm text-muted-foreground">
            {routine.vaultReady ? status : "O serviço fiscal ainda não está pronto para a rotina."}
            {routine.problems.length > 0
              ? ` · ${routine.problems.length} empresa(s) com problema: ${routine.problems.map((p) => `${p.message} (${p.clientName})`).join(", ")}`
              : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button asChild size="sm" variant="outline" className="h-auto min-h-9 max-w-full whitespace-normal text-left">
            <a href={`/api/nfse/xml?clanId=${clanId}&year=${year}&month=${month}`}>
              <Download aria-hidden /> Baixar XML — {emissionRangeLabel(year, month)} ({totalNotes})
            </a>
          </Button>
          {canManage ? (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button type="button" size="icon-sm" variant="ghost" className="touch-target" title="Configurar a rotina de XML" aria-label="Configurar a rotina de XML">
                  <Settings2 aria-hidden />
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Rotina de XML</DialogTitle>
                  <DialogDescription>Quando a Guilda busca no Sistema Nacional as notas que as empresas emitiram.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="size-4 accent-primary" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
                    Rotina ligada
                  </label>
                  <div className="grid gap-1">
                    <Label htmlFor="xml-frequency">Quando rodar</Label>
                    <Select
                      value={frequency}
                      onValueChange={(value) => setFrequency(value as typeof frequency)}
                    >
                      <SelectTrigger id="xml-frequency"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="daily">Todo dia</SelectItem><SelectItem value="monthly">Só num dia do mês</SelectItem></SelectContent>
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
                    <Label htmlFor="xml-since">Guardar notas a partir de</Label>
                    <Input id="xml-since" type="month" value={keepSince} onChange={(event) => setKeepSince(event.target.value)} />
                    <p className="text-xs text-muted-foreground">Vazio guarda o histórico inteiro.</p>
                  </div>
                  <div className="flex flex-wrap justify-between gap-2">
                    <Button type="button" variant="outline" size="sm" disabled={pending || !routine.vaultReady || running || routine.runRequested} onClick={runNow}>
                      <Play aria-hidden /> Rodar agora
                    </Button>
                    <Button type="button" size="sm" disabled={pending} onClick={save}>
                      {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : null} Salvar
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          ) : null}
        </div>
      </div>
    </section>
  );
}
