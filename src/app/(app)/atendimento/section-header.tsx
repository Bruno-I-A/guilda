import { MessagesSquare } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { SegmentedNav, type SegmentedNavItem } from "@/components/segmented-nav";

const INBOX_ITEM: SegmentedNavItem = {
  key: "inbox",
  label: "Caixa de entrada",
  shortLabel: "Conversas",
  href: "/atendimento",
};

const SETTINGS_ITEM: SegmentedNavItem = {
  key: "settings",
  label: "Configurações",
  href: "/atendimento/configuracoes",
};

export function AtendimentoSectionHeader({
  active,
  canManage,
}: {
  active: "inbox" | "settings";
  canManage: boolean;
}) {
  const items = canManage ? [INBOX_ITEM, SETTINGS_ITEM] : [INBOX_ITEM];
  return (
    <div className="grid gap-3">
      <PageHeader
        title="Atendimento"
        icon={MessagesSquare}
        description="Conversas, equipe e automações do atendimento do escritório."
      />
      <SegmentedNav items={items} active={active} label="Áreas do atendimento" />
    </div>
  );
}
