import { ClipboardCheck, UsersRound, WalletCards } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

export type FiscalWorkspaceView = "portfolio" | "control" | "fees";

export function FiscalWorkspaceNav({
  clanId,
  active,
}: {
  clanId: string;
  active: FiscalWorkspaceView;
}) {
  const items = [
    {
      key: "portfolio" as const,
      label: "Carteira e fichas",
      icon: UsersRound,
      href: `/clans/${clanId}?tab=portfolio`,
    },
    {
      key: "control" as const,
      label: "Controle mensal",
      icon: ClipboardCheck,
      href: `/clans/${clanId}?tab=portfolio&fiscalView=control`,
    },
    {
      key: "fees" as const,
      label: "Honorários",
      icon: WalletCards,
      href: `/clans/${clanId}?tab=portfolio&fiscalView=fees`,
    },
  ];

  return (
    <nav
      aria-label="Espaço de trabalho fiscal"
      className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-lg border bg-card/45 p-1"
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active === item.key ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors",
              active === item.key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
