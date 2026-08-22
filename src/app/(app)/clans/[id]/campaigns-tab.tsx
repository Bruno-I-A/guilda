import { and, desc, eq } from "drizzle-orm";
import { CalendarRange, Flag } from "lucide-react";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";

import {
  CampaignBoard,
  NewCampaignButton,
  type CampaignView,
} from "./campaign-board";
import { ClanEmptyState, ClanSectionHeading } from "./clan-ui";

/**
 * Campanhas mensais do clã. No Fiscal, a abertura pode materializar o
 * controle da competência; nos demais clãs continua sendo o guarda-chuva de
 * nome, período, prazo e situação.
 */
export async function CampaignsTab({
  orgId,
  clanId,
  canManage,
  isFiscal,
}: {
  orgId: string;
  clanId: string;
  canManage: boolean;
  isFiscal: boolean;
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
      <div className="grid gap-2">
        <ClanSectionHeading
          aside={canManage ? <NewCampaignButton clanId={clanId} isFiscal={isFiscal} /> : null}
        >
          Campanhas do clã
        </ClanSectionHeading>
        <p className="max-w-xl text-sm text-muted-foreground">
          O trabalho grande e recorrente do mês. Abra a campanha para declarar
          o que está em jogo e acompanhar em que pé está.
        </p>
      </div>

      {campaigns.length === 0 ? (
        <ClanEmptyState
          icon={<CalendarRange className="size-7" aria-hidden />}
          title="Nenhuma campanha neste clã ainda"
          description={canManage
            ? "Abra a campanha do mês — por exemplo, a apuração de agosto."
            : "Quando a liderança abrir a campanha do mês, ela aparece aqui."}
        />
      ) : (
        <CampaignBoard
          clanId={clanId}
          campaigns={campaigns}
          canManage={canManage}
          isFiscal={isFiscal}
        />
      )}

      <p className="panel-cut panel-cut-sm flex items-start gap-2 bg-card/30 p-3 text-xs text-muted-foreground">
        <Flag className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {isFiscal
          ? "A campanha abre o controle da competência sem transformar cada célula em missão. Missões ficam reservadas às exceções."
          : "Em breve: gerar automaticamente as missões de cada empresa da campanha a partir dos templates por regime."}
      </p>
    </div>
  );
}
