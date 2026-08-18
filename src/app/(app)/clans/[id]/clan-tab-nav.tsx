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
    <nav
      aria-label="Seções do clã"
      className="flex w-full overflow-x-auto rounded-lg border bg-muted/40 p-0.5 sm:w-fit"
    >
      {clanTabsFor(clanSlug).map(({ key, label }) => (
        <Link
          key={key}
          href={`/clans/${clanId}?tab=${key}`}
          aria-current={active === key ? "page" : undefined}
          className={cn(
            "shrink-0 rounded-md px-4 py-1.5 text-center text-sm font-medium transition-colors",
            active === key
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
