import { MessagesSquare } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { SegmentedNav, type SegmentedNavItem } from "@/components/segmented-nav";
import { cn } from "@/lib/utils";

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
  compact = false,
}: {
  active: "inbox" | "settings";
  canManage: boolean;
  compact?: boolean;
}) {
  const items = canManage ? [INBOX_ITEM, SETTINGS_ITEM] : [INBOX_ITEM];
  return (
    <div
      className={cn(
        compact
          ? "flex min-h-14 min-w-0 flex-wrap items-center justify-between gap-x-6 border-b bg-background/95 px-4"
          : "grid gap-3",
      )}
    >
      <PageHeader
        title="Atendimento"
        icon={MessagesSquare}
        description={compact ? undefined : "Conversas, equipe e automações do atendimento do escritório."}
        className={compact ? "shrink-0 py-2" : undefined}
        titleClassName={compact ? "text-lg" : undefined}
      />
      <SegmentedNav
        items={items}
        active={active}
        label="Áreas do atendimento"
        className={compact ? "min-w-0 self-stretch border-b-0" : undefined}
      />
    </div>
  );
}
