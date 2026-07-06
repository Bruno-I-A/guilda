import { and, asc, eq } from "drizzle-orm";
import { ArrowLeft, Star } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

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
      <div>
        <Link
          href="/campaigns/templates"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden /> Templates
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="max-w-xl text-2xl font-semibold leading-tight">
              {template.name}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <Badge
                className={cn(
                  "h-4 px-1.5",
                  TAX_REGIME_BADGE_CLASSES[template.taxRegime],
                )}
              >
                {TAX_REGIME_LABELS[template.taxRegime]}
              </Badge>
              <span>
                {items.length} {items.length === 1 ? "etapa" : "etapas"}
              </span>
              <span className="inline-flex items-center gap-1 font-mono text-gold">
                <Star className="size-3" aria-hidden /> {totalXp} XP por empresa
              </span>
            </div>
          </div>
          <TemplateHeaderActions
            template={{
              id: template.id,
              name: template.name,
              taxRegime: template.taxRegime,
            }}
          />
        </div>
      </div>

      <div className="divider-rune" />

      <TemplateItemsEditor templateId={template.id} items={items} />
    </div>
  );
}
