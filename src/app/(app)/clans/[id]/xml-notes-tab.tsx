import { withOrgTx } from "@/db/org-tx";
import { previousEmissionMonth } from "@/domain/nfse-xml";
import { loadVaultPublicKey, loadXmlCompanies, loadXmlRoutineView } from "@/lib/nfse/xml-requests";

import { XmlNotesBoard } from "./xml-notes-board";

function parsePeriod(year: string | undefined, month: string | undefined, now: Date): { year: number; month: number } {
  const parsedYear = Number(year);
  const parsedMonth = Number(month);
  if (Number.isInteger(parsedYear) && parsedYear >= 2000 && parsedYear <= 2100 && Number.isInteger(parsedMonth) && parsedMonth >= 1 && parsedMonth <= 12) {
    return { year: parsedYear, month: parsedMonth };
  }
  return previousEmissionMonth(now);
}

/**
 * XML das notas, no espaço do Fiscal: certificados A1 das empresas, a rotina
 * que guarda os XML das NFS-e que elas emitem e o download por mês, num lugar
 * só (decisão de 2026-10-20: espalhado pela Carteira e pelo Controle mensal,
 * o Bruno não achou a função). Abre no mês anterior, que é o que se apura.
 */
export async function XmlNotesTab({
  orgId,
  clanId,
  canManage,
  requestedYear,
  requestedMonth,
}: {
  orgId: string;
  clanId: string;
  canManage: boolean;
  requestedYear?: string;
  requestedMonth?: string;
}) {
  const now = new Date();
  const period = parsePeriod(requestedYear, requestedMonth, now);
  const { routine, companies, vaultKey } = await withOrgTx(orgId, async (tx) => ({
    routine: await loadXmlRoutineView(tx, orgId, now),
    companies: await loadXmlCompanies(tx, { orgId, ...period }),
    vaultKey: await loadVaultPublicKey(tx, orgId),
  }));

  return (
    <XmlNotesBoard
      clanId={clanId}
      year={period.year}
      month={period.month}
      canManage={canManage}
      routine={routine}
      companies={companies}
      vaultKey={vaultKey}
    />
  );
}
