import Link from "next/link";

import { type ClanTab, clanTabsFor } from "@/lib/clan-tabs";
import { cn } from "@/lib/utils";

/** Seções do clã. Server Component: navegar é trocar a URL, não estado. */
export function ClanTabNav({
  clanId,
  clanSlug,
  active,
}: {
  clanId: string;
  clanSlug: string;
  active: ClanTab;
}) {
  return (
    <div className="relative border-y border-border/80 bg-card/20">
      <nav
        aria-label="Seções do clã"
        className="flex w-full snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {clanTabsFor(clanSlug).map(({ key, label }, index) => (
          <Link
            key={key}
            href={`/clans/${clanId}?tab=${key}`}
            aria-current={active === key ? "page" : undefined}
            className={cn(
              "relative flex min-h-11 shrink-0 snap-start items-center px-4 text-center text-sm font-medium transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              index > 0 && "border-l border-border/45",
              active === key
                ? "bg-primary/8 text-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-primary"
                : "text-muted-foreground hover:bg-muted/30 hover:text-foreground",
            )}
          >
            {active === key ? (
              <span className="mr-2 size-1.5 rotate-45 border border-primary" aria-hidden />
            ) : null}
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
