import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { withOrgTx } from "@/db/org-tx";
import { isAdminRole } from "@/domain/guild-permissions";
import type { OrgRole } from "@/domain/task-state";
import { isAiConfigured } from "@/lib/ai/config";
import { getActiveMember, requireOrgSession } from "@/lib/session";
import { loadRoutingSettings } from "@/lib/support/agent/routing";
import { loadAgentSettings } from "@/lib/support/agent/settings";
import { supportAiMode } from "@/lib/support/triage/shadow";
import { listWhatsAppChannels } from "@/lib/whatsapp/channel-repository";
import { getReadyEmbeddedSignupConfig } from "@/lib/whatsapp/onboarding";

import { AtendimentoSectionHeader } from "../section-header";
import { AgentTestPanel } from "./agent-test-panel";
import { RoutingPanel } from "./routing-panel";
import { WhatsAppOnboardingPanel } from "./whatsapp-onboarding-panel";

export const metadata: Metadata = { title: "Configurações do atendimento" };

export default async function AtendimentoSettingsPage() {
  const session = await requireOrgSession();
  const member = await getActiveMember();
  if (!member) redirect("/onboarding");
  if (!isAdminRole(member.role as OrgRole)) redirect("/atendimento");

  const channels = await listWhatsAppChannels(session.orgId);
  const embeddedSignupConfig = getReadyEmbeddedSignupConfig();
  const { agent, routing } = await withOrgTx(session.orgId, async (tx) => ({
    agent: await loadAgentSettings(tx, session.orgId),
    routing: await loadRoutingSettings(tx, session.orgId),
  }));
  // O teste usa a mesma leitura da IA da sombra: sem ela ligada no servidor, não responde.
  const aiReady = supportAiMode() === "shadow" && isAiConfigured();

  return (
    <div className="grid gap-6">
      <AtendimentoSectionHeader active="settings" canManage />
      <WhatsAppOnboardingPanel
        config={embeddedSignupConfig}
        initialChannels={channels}
      />
      <AgentTestPanel initial={{ enabled: agent.mode !== "off", keyword: agent.testKeyword ?? "" }} aiReady={aiReady} />
      <RoutingPanel clans={routing} />
    </div>
  );
}
