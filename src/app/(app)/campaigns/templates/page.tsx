import { asc } from "drizzle-orm";
import { ScrollText, Star } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { MATERIALIZED_PRIORITY } from "@/domain/campaign-rules";
import { calculateTaskXp } from "@/domain/xp";
import { requireOrgSession } from "@/lib/session";
import {
  TAX_REGIME_BADGE_CLASSES,
  TAX_REGIME_LABELS,
} from "@/lib/clients-ui";
import { cn } from "@/lib/utils";

import { CampaignTabs } from "../campaign-tabs";
import { NewTemplateButton } from "./template-actions";

export const metadata: Metadata = { title: "Templates" };

export default async function TemplatesPage() {
  const session = await requireOrgSession();

  const templates = await withOrgTx(session.orgId, (tx) =>
    tx.query.missionTemplates.findMany({
      with: { items: { columns: { difficulty: true } } },
      orderBy: [asc(schema.missionTemplates.name)],
    }),
  );

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-wide">Templates</h1>
          <p className="text-muted-foreground">
            Checklists por regime — cada campanha materializa as missões a
            partir deles.
          </p>
        </div>
        <NewTemplateButton />
      </div>

      <CampaignTabs active="templates" />

      {templates.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-12 text-center">
          <ScrollText className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">Nenhum template ainda</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Crie um checklist por regime tributário (ex.: &ldquo;Fechamento —
            Simples Nacional&rdquo;) com as etapas na ordem de execução.
          </p>
        </div>
      ) : (
        <ul className="grid gap-1.5">
          {templates.map((template) => {
            const totalXp = template.items.reduce(
              (sum, item) =>
                sum + calculateTaskXp(item.difficulty, MATERIALIZED_PRIORITY),
              0,
            );
            return (
              <li key={template.id}>
                <Link
                  href={`/campaigns/templates/${template.id}`}
                  className="panel-cut panel-cut-sm flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium leading-snug">
                      {template.name}
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <Badge
                        className={cn(
                          "h-4 px-1.5",
                          TAX_REGIME_BADGE_CLASSES[template.taxRegime],
                        )}
                      >
                        {TAX_REGIME_LABELS[template.taxRegime]}
                      </Badge>
                      <span>
                        {template.items.length}{" "}
                        {template.items.length === 1 ? "etapa" : "etapas"}
                      </span>
                    </div>
                  </div>
                  <span className="chip-loot shrink-0">
                    <Star className="size-3" aria-hidden /> {totalXp} XP
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
