import Link from "next/link";

import { cn } from "@/lib/utils";

/** Abas da área de Campanhas (campanhas em si chegam na Fase 5c). */
export function CampaignTabs({ active }: { active: "campaigns" | "templates" }) {
  const tabs = [
    { key: "campaigns", label: "Campanhas", href: "/campaigns" },
    { key: "templates", label: "Templates", href: "/campaigns/templates" },
  ] as const;

  return (
    <nav aria-label="Seções de campanhas" className="flex w-fit rounded-lg border bg-muted/40 p-0.5">
      {tabs.map(({ key, label, href }) => (
        <Link
          key={key}
          href={href}
          aria-current={active === key ? "page" : undefined}
          className={cn(
            "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
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
