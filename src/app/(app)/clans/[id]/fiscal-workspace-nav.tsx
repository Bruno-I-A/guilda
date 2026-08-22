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
      className="flex w-full max-w-full overflow-x-auto border-y border-border/80 bg-card/20 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {items.map((item, index) => {
        const Icon = item.icon;
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active === item.key ? "page" : undefined}
            className={cn(
              "relative flex min-h-11 shrink-0 items-center gap-2 px-4 text-sm transition-colors",
              index > 0 && "border-l border-border/45",
              active === item.key
                ? "bg-primary/8 text-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-primary"
                : "text-muted-foreground hover:bg-muted/30 hover:text-foreground",
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
