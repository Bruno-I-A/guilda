import { SegmentedNav, type SegmentedNavItem } from "@/components/segmented-nav";

/**
 * Abas da área de Campanhas (campanhas em si chegam na Fase 5c).
 *
 * Era uma das quatro cópias byte-idênticas da pílula `bg-background shadow-sm`;
 * agora só nomeia os destinos e deixa a aparência com o `SegmentedNav`.
 */
const CAMPAIGN_TABS: readonly SegmentedNavItem[] = [
  { key: "campaigns", label: "Campanhas", href: "/campaigns" },
  { key: "templates", label: "Templates", href: "/campaigns/templates" },
];

export function CampaignTabs({ active }: { active: "campaigns" | "templates" }) {
  return (
    <SegmentedNav
      items={CAMPAIGN_TABS}
      active={active}
      label="Seções de campanhas"
    />
  );
}
