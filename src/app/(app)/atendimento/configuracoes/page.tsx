import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { withOrgTx } from "@/db/org-tx";
import { hourLabel, hoursAt, localClock, nationalHolidays, openingPhrase, type BusinessSchedule } from "@/domain/business-hours";
import { isAdminRole } from "@/domain/guild-permissions";
import type { OrgRole } from "@/domain/task-state";
import { isAiConfigured } from "@/lib/ai/config";
import { getActiveMember, requireOrgSession } from "@/lib/session";
import { loadRoutingSettings } from "@/lib/support/agent/routing";
import { loadAgentSettings } from "@/lib/support/agent/settings";
import { loadBusinessSchedule } from "@/lib/support/business-hours";
import { supportAiMode } from "@/lib/support/triage/shadow";
import { listWhatsAppChannels } from "@/lib/whatsapp/channel-repository";
import { getReadyEmbeddedSignupConfig } from "@/lib/whatsapp/onboarding";

import { AtendimentoSectionHeader } from "../section-header";
import { AgentPanel } from "./agent-panel";
import { BusinessHoursPanel } from "./business-hours-panel";
import { RoutingPanel } from "./routing-panel";
import { SpecialDaysPanel } from "./special-days-panel";
import { WhatsAppOnboardingPanel } from "./whatsapp-onboarding-panel";

export const metadata: Metadata = { title: "Configurações do atendimento" };

/** A frase do topo do Expediente: o que vale agora, no horário de Brasília. */
function hoursStatus(schedule: BusinessSchedule, now: Date): string {
  if (!schedule.week) return "Sem expediente salvo: o agente não avisa fora do horário.";
  const hours = hoursAt(schedule, now);
  if (hours.open) return hours.closesAt ? `Agora: aberto até ${hourLabel(localClock(hours.closesAt).minutes)}` : "Agora: aberto";
  return hours.nextOpening ? `Agora: fechado · abre ${openingPhrase(hours.nextOpening, now)}` : "Agora: fechado, sem próxima abertura cadastrada";
}

export default async function AtendimentoSettingsPage() {
  const session = await requireOrgSession();
  const member = await getActiveMember();
  if (!member) redirect("/onboarding");
  if (!isAdminRole(member.role as OrgRole)) redirect("/atendimento");

  const now = new Date();
  const today = localClock(now).day;
  const channels = await listWhatsAppChannels(session.orgId);
  const embeddedSignupConfig = getReadyEmbeddedSignupConfig();
  const { agent, routing, schedule } = await withOrgTx(session.orgId, async (tx) => ({
    agent: await loadAgentSettings(tx, session.orgId),
    routing: await loadRoutingSettings(tx, session.orgId),
    schedule: await loadBusinessSchedule(tx, session.orgId, today),
  }));
  // O agente usa a mesma leitura da IA da sombra: sem ela ligada no servidor, não responde.
  const aiReady = supportAiMode() === "shadow" && isAiConfigured();
  // Feriados do ano e do próximo, sem as datas já cadastradas nem as que já passaram.
  const taken = new Set(schedule.specialDays.map((day) => day.day));
  const year = Number(today.slice(0, 4));
  const suggestions = [year, year + 1].map((value) => ({
    year: value,
    holidays: nationalHolidays(value).filter((holiday) => holiday.day >= today && !taken.has(holiday.day)),
  }));

  return (
    <div className="grid gap-6">
      <AtendimentoSectionHeader active="settings" canManage />
      <WhatsAppOnboardingPanel
        config={embeddedSignupConfig}
        initialChannels={channels}
      />
      <AgentPanel initial={{ mode: agent.mode, keyword: agent.testKeyword ?? "" }} aiReady={aiReady} />
      <BusinessHoursPanel initial={schedule.week} status={hoursStatus(schedule, now)} />
      <SpecialDaysPanel days={schedule.specialDays} suggestions={suggestions} />
      <RoutingPanel clans={routing} />
    </div>
  );
}
