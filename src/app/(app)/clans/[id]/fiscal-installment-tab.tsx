import { and, asc, eq } from "drizzle-orm";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";

import {
  FiscalInstallmentBoard,
  type FiscalInstallmentRowView,
} from "./fiscal-installment-board";

export async function FiscalInstallmentTab({
  orgId,
  clanId,
  canManage,
}: {
  orgId: string;
  clanId: string;
  canManage: boolean;
}) {
  const { rows, clients } = await withOrgTx(orgId, async (tx) => {
    const rows = await tx
      .select({
        id: schema.fiscalInstallments.id,
        clientId: schema.fiscalInstallments.clientId,
        clientName: schema.clients.name,
        clientActive: schema.clients.active,
        installmentType: schema.fiscalInstallments.installmentType,
        notes: schema.fiscalInstallments.notes,
        deliveryMethod: schema.fiscalInstallments.deliveryMethod,
        installmentNumber: schema.fiscalInstallments.installmentNumber,
        updatedAt: schema.fiscalInstallments.updatedAt,
      })
      .from(schema.fiscalInstallments)
      .innerJoin(
        schema.clients,
        and(
          eq(schema.clients.orgId, schema.fiscalInstallments.orgId),
          eq(schema.clients.id, schema.fiscalInstallments.clientId),
        ),
      )
      .where(eq(schema.fiscalInstallments.orgId, orgId))
      .orderBy(asc(schema.clients.name), asc(schema.fiscalInstallments.createdAt));
    const clients = await tx
      .select({ id: schema.clients.id, name: schema.clients.name })
      .from(schema.clients)
      .where(and(eq(schema.clients.orgId, orgId), eq(schema.clients.active, true)))
      .orderBy(asc(schema.clients.name));
    return { rows, clients };
  });

  const views: FiscalInstallmentRowView[] = rows.map((row) => ({
    ...row,
    updatedAt: row.updatedAt.toISOString(),
  }));

  return (
    <FiscalInstallmentBoard
      clanId={clanId}
      canManage={canManage}
      rows={views}
      clients={clients}
    />
  );
}
