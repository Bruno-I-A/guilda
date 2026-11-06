import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { isAdminRole } from "@/domain/guild-permissions";
import type { OrgRole } from "@/domain/task-state";
import { getActiveMember, requireOrgSession } from "@/lib/session";
import { listWhatsAppChannels } from "@/lib/whatsapp/channel-repository";
import { getReadyEmbeddedSignupConfig } from "@/lib/whatsapp/onboarding";

import { AtendimentoSectionHeader } from "../section-header";
import { WhatsAppOnboardingPanel } from "./whatsapp-onboarding-panel";

export const metadata: Metadata = { title: "Configurações do atendimento" };

export default async function AtendimentoSettingsPage() {
  const session = await requireOrgSession();
  const member = await getActiveMember();
  if (!member) redirect("/onboarding");
  if (!isAdminRole(member.role as OrgRole)) redirect("/atendimento");

  const channels = await listWhatsAppChannels(session.orgId);
  const embeddedSignupConfig = getReadyEmbeddedSignupConfig();

  return (
    <div className="grid gap-6">
      <AtendimentoSectionHeader active="settings" canManage />
      <WhatsAppOnboardingPanel
        config={embeddedSignupConfig}
        initialChannels={channels}
      />
    </div>
  );
}
