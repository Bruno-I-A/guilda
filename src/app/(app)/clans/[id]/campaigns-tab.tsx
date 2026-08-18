import { and, desc, eq } from "drizzle-orm";
import { CalendarRange, Flag } from "lucide-react";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";

import {
  CampaignBoard,
  NewCampaignButton,
  type CampaignView,
} from "./campaign-board";

/**
 * Campanhas mensais do clã. Esta etapa entrega o guarda-chuva — nome,
 * período, prazo e situação. A materialização das missões de cada empresa a
 * partir dos templates é a etapa seguinte.
 */
export async function CampaignsTab({
  orgId,
  clanId,
  canManage,
}: {
  orgId: string;
  clanId: string;
  canManage: boolean;
}) {
  const rows = await withOrgTx(orgId, (tx) =>
    tx
      .select({
        id: schema.clanCampaigns.id,
        name: schema.clanCampaigns.name,
        periodYear: schema.clanCampaigns.periodYear,
        periodMonth: schema.clanCampaigns.periodMonth,
        dueDate: schema.clanCampaigns.dueDate,
        status: schema.clanCampaigns.status,
      })
      .from(schema.clanCampaigns)
      .where(
        and(
          eq(schema.clanCampaigns.orgId, orgId),
          eq(schema.clanCampaigns.clanId, clanId),
        ),
      )
      .orderBy(
        desc(schema.clanCampaigns.periodYear),
        desc(schema.clanCampaigns.periodMonth),
        desc(schema.clanCampaigns.createdAt),
      ),
  );

  const campaigns: CampaignView[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    periodYear: row.periodYear,
    periodMonth: row.periodMonth,
    dueDate: row.dueDate,
    status: row.status,
  }));

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">
          O trabalho grande e recorrente do mês. Abra a campanha para declarar
          o que está em jogo e acompanhar em que pé está.
        </p>
        {canManage ? <NewCampaignButton clanId={clanId} /> : null}
      </div>

      {campaigns.length === 0 ? (
        <div className="grid justify-items-center gap-2 rounded-lg border border-dashed p-10 text-center">
          <CalendarRange className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">Nenhuma campanha neste clã ainda</p>
          <p className="max-w-md text-sm text-muted-foreground">
            {canManage
              ? "Abra a campanha do mês — por exemplo, a apuração de agosto."
              : "Quando a liderança abrir a campanha do mês, ela aparece aqui."}
          </p>
        </div>
      ) : (
        <CampaignBoard
          clanId={clanId}
          campaigns={campaigns}
          canManage={canManage}
        />
      )}

      <p className="flex items-start gap-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
        <Flag className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Em breve: gerar automaticamente as missões de cada empresa da campanha a
        partir dos templates por regime.
      </p>
    </div>
  );
}
