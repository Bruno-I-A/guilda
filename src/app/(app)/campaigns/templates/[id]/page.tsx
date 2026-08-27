import { and, asc, eq } from "drizzle-orm";
import { Star } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { MATERIALIZED_PRIORITY } from "@/domain/campaign-rules";
import { calculateTaskXp } from "@/domain/xp";
import { requireOrgSession } from "@/lib/session";
import { TAX_REGIME_BADGE_CLASSES, TAX_REGIME_LABELS } from "@/lib/clients-ui";
import { cn } from "@/lib/utils";

import { TemplateHeaderActions, TemplateItemsEditor } from "./template-editor";

export const metadata: Metadata = { title: "Template" };

export default async function TemplateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireOrgSession();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const template = await withOrgTx(session.orgId, (tx) =>
    tx.query.missionTemplates.findFirst({
      where: and(
        eq(schema.missionTemplates.id, id),
        eq(schema.missionTemplates.orgId, session.orgId),
      ),
      with: {
        items: { orderBy: [asc(schema.missionTemplateItems.orderIndex)] },
      },
    }),
  );
  if (!template) notFound();

  const items = template.items.map((item) => ({
    id: item.id,
    title: item.title,
    difficulty: item.difficulty,
    xpValue: calculateTaskXp(item.difficulty, MATERIALIZED_PRIORITY),
  }));
  const totalXp = items.reduce((sum, item) => sum + item.xpValue, 0);

  return (
    <div className="grid gap-5">
      {/* O XP total vira `chip-loot` — a mesma peça de inventário da lista de
          templates, em vez de um texto dourado solto. */}
      <PageHeader
        backHref="/campaigns/templates"
        backLabel="Templates"
        title={template.name}
        badges={
          <>
            <Badge
              className={cn(
                "h-4 px-1.5",
                TAX_REGIME_BADGE_CLASSES[template.taxRegime],
              )}
            >
              {TAX_REGIME_LABELS[template.taxRegime]}
            </Badge>
            <span className="text-xs text-muted-foreground">
              <span className="font-mono tabular-nums">{items.length}</span>{" "}
              {items.length === 1 ? "etapa" : "etapas"}
            </span>
            <span className="chip-loot">
              <Star className="size-3" aria-hidden /> {totalXp} XP por empresa
            </span>
          </>
        }
        action={
          <TemplateHeaderActions
            template={{
              id: template.id,
              name: template.name,
              taxRegime: template.taxRegime,
            }}
          />
        }
      />

      <div className="divider-rune" />

      <TemplateItemsEditor templateId={template.id} items={items} />
    </div>
  );
}
