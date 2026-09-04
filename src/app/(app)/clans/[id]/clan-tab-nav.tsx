import {
  BriefcaseBusiness,
  CalendarCheck,
  CalendarRange,
  HandCoins,
  ReceiptText,
  ShieldCheck,
  Users,
  WalletCards,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import {
  type ClanTab,
  clanTabsFor,
  isSharedClanTab,
} from "@/lib/clan-tabs";
import { cn } from "@/lib/utils";

/** Mesmos ícones dos atalhos do dashboard: a aba e o atalho são o mesmo lugar. */
const TAB_ICONS: Record<ClanTab, LucideIcon> = {
  missions: ShieldCheck,
  members: Users,
  commitments: HandCoins,
  portfolio: BriefcaseBusiness,
  mei: CalendarCheck,
  installments: ReceiptText,
  fees: WalletCards,
  closings: CalendarRange,
  flow: Workflow,
};

function TabGroup({
  label,
  items,
  clanId,
  active,
  accent = false,
}: {
  label: string;
  items: readonly { key: ClanTab; label: string }[];
  clanId: string;
  active: ClanTab;
  accent?: boolean;
}) {
  return (
    <div className="grid shrink-0 snap-start gap-1.5">
      <span className={cn("hud-label px-1", accent && "!text-primary/90")}>{label}</span>
      <div
        className={cn(
          "flex gap-1 border p-1 [clip-path:polygon(0.5rem_0,100%_0,100%_calc(100%-0.5rem),calc(100%-0.5rem)_100%,0_100%,0_0.5rem)]",
          accent ? "border-primary/35 bg-primary/5" : "border-border/70 bg-card/30",
        )}
      >
        {items.map(({ key, label: itemLabel }) => {
          const Icon = TAB_ICONS[key];
          const isActive = active === key;
          return (
            <Link
              key={key}
              href={`/clans/${clanId}?tab=${key}`}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "relative flex min-h-11 shrink-0 items-center gap-2 px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                isActive
                  ? "bg-primary/15 text-foreground shadow-[inset_0_-2px_0_var(--primary)]"
                  : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
              )}
            >
              <Icon
                className={cn("size-4 shrink-0", isActive ? "text-primary" : "opacity-80")}
                aria-hidden
              />
              {itemLabel}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Seções do clã, em dois grupos: a MESA (missões e integrantes — igual em todo
 * clã) e o ESPAÇO da área (Fluxo no Societário, Carteira no Fiscal…). Antes
 * eram sete rótulos numa fileira só, e quem chegava não sabia onde vivia o
 * trabalho do seu clã. Server Component: navegar é trocar a URL.
 */
export function ClanTabNav({
  clanId,
  clanSlug,
  clanName,
  active,
}: {
  clanId: string;
  clanSlug: string;
  clanName: string;
  active: ClanTab;
}) {
  const tabs = clanTabsFor(clanSlug);
  const shared = tabs.filter((tab) => isSharedClanTab(tab.key));
  const own = tabs.filter((tab) => !isSharedClanTab(tab.key));

  return (
    <nav
      aria-label="Seções do clã"
      className="flex w-full snap-x gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {own.length > 0 ? (
        <TabGroup
          label={`Espaço ${clanName}`}
          items={own}
          clanId={clanId}
          active={active}
          accent
        />
      ) : null}
      <TabGroup label="Mesa do clã" items={shared} clanId={clanId} active={active} />
    </nav>
  );
}
