"use client";

import { BellRing, LoaderCircle } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { saveNotificationPreferences } from "./whatsapp-actions";

export type NotificationPreferencesView = {
  taskNotifications: boolean;
  approvalNotifications: boolean;
  deadlineReminders: boolean;
  xpNotifications: boolean;
  closingNotifications: boolean;
  campaignNotifications: boolean;
  muralNotifications: boolean;
  dailySummary: boolean;
  dailySummaryTime: string;
  timezone: string;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
};

type ToggleName = Exclude<keyof NotificationPreferencesView, "dailySummaryTime" | "timezone" | "quietHoursStart" | "quietHoursEnd" | "dailySummary">;

const OPTIONS: readonly { name: ToggleName; label: string; description: string }[] = [
  { name: "taskNotifications", label: "Missões", description: "Missão nova, início, transferência e cancelamento." },
  { name: "approvalNotifications", label: "Aprovações", description: "Entregas para você aprovar e devoluções." },
  { name: "deadlineReminders", label: "Prazos", description: "Missão que vence hoje ou está atrasada." },
  { name: "xpNotifications", label: "XP", description: "Missão aprovada ou concluída por outra pessoa." },
  { name: "closingNotifications", label: "Fechamentos", description: "Mudanças e pendências dos fechamentos, de toda a Guilda." },
  { name: "campaignNotifications", label: "Campanhas", description: "Andamento das campanhas." },
  { name: "muralNotifications", label: "Mural da Guilda", description: "Avisos que pedem confirmação de leitura." },
];

const TIMEZONES = [
  ["America/Sao_Paulo", "Brasília (São Paulo)"],
  ["America/Manaus", "Amazonas (Manaus)"],
  ["America/Cuiaba", "Mato Grosso (Cuiabá)"],
  ["America/Rio_Branco", "Acre (Rio Branco)"],
  ["America/Noronha", "Fernando de Noronha"],
  ["UTC", "UTC"],
] as const;

function Toggle({ name, label, description, defaultChecked }: { name: string; label: string; description: string; defaultChecked: boolean }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 p-3 transition-colors hover:bg-muted/40">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 size-4 shrink-0 accent-primary" />
      <span className="grid gap-0.5">
        <span className="font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}

/** As escolhas que eram do Telegram, agora para os avisos do WhatsApp. */
export function NotificationPreferences({ preferences }: { preferences: NotificationPreferencesView }) {
  const [pending, start] = useTransition();
  const knownZone = TIMEZONES.some(([value]) => value === preferences.timezone);

  function submit(form: FormData) {
    const on = (name: string) => form.get(name) === "on";
    start(async () => {
      const result = await saveNotificationPreferences({
        taskNotifications: on("taskNotifications"),
        approvalNotifications: on("approvalNotifications"),
        deadlineReminders: on("deadlineReminders"),
        xpNotifications: on("xpNotifications"),
        closingNotifications: on("closingNotifications"),
        campaignNotifications: on("campaignNotifications"),
        muralNotifications: on("muralNotifications"),
        dailySummary: on("dailySummary"),
        dailySummaryTime: String(form.get("dailySummaryTime") ?? ""),
        timezone: String(form.get("timezone") ?? ""),
        quietHoursStart: String(form.get("quietHoursStart") ?? ""),
        quietHoursEnd: String(form.get("quietHoursEnd") ?? ""),
      });
      if (result.ok) toast.success("Preferências salvas.");
      else toast.error(result.error);
    });
  }

  return (
    <Card className="panel-cut rounded-none border-0 ring-0">
      <CardHeader className="border-b">
        <CardTitle asChild>
          <h2 className="flex items-center gap-2">
            <BellRing className="size-4 text-gold" aria-hidden />
            Avisos
          </h2>
        </CardTitle>
        <CardDescription>O que pode chegar ao seu WhatsApp.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={submit} className="grid gap-4">
          <div className="grid gap-2 sm:grid-cols-2">
            {OPTIONS.map((option) => (
              <Toggle key={option.name} {...option} defaultChecked={preferences[option.name]} />
            ))}
          </div>

          <div className="grid gap-4 rounded-lg border p-4">
            <Toggle name="dailySummary" label="Resumo diário" description="Quantas missões estão com você e nos seus clãs, no horário escolhido. Os lembretes de prazo saem no mesmo horário." defaultChecked={preferences.dailySummary} />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="dailySummaryTime">Horário do resumo e dos prazos</Label>
                <Input id="dailySummaryTime" name="dailySummaryTime" type="time" defaultValue={preferences.dailySummaryTime.slice(0, 5)} required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="noticeTimezone">Fuso horário</Label>
                <select
                  id="noticeTimezone"
                  name="timezone"
                  defaultValue={preferences.timezone}
                  className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  required
                >
                  {!knownZone ? <option value={preferences.timezone}>{preferences.timezone}</option> : null}
                  {TIMEZONES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
            </div>
            <div className="grid gap-4 border-t pt-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="quietHoursStart">Silenciar a partir de</Label>
                <Input id="quietHoursStart" name="quietHoursStart" type="time" defaultValue={preferences.quietHoursStart?.slice(0, 5) ?? ""} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="quietHoursEnd">Voltar a avisar às</Label>
                <Input id="quietHoursEnd" name="quietHoursEnd" type="time" defaultValue={preferences.quietHoursEnd?.slice(0, 5) ?? ""} />
              </div>
              <p className="max-w-prose text-xs text-muted-foreground sm:col-span-2">
                No silêncio o aviso espera e sai depois. Intervalos que atravessam a meia-noite valem.
              </p>
            </div>
          </div>

          <div>
            <Button type="submit" disabled={pending}>
              {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
              {pending ? "Salvando…" : "Salvar preferências"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
