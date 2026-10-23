import { withOrgTx } from "@/db/org-tx";
import { loadClientNfseWorkspace } from "@/lib/client-nfse/loaders";
import { loadVaultPublicKey } from "@/lib/nfse/xml-requests";

import { ClientNfseWorkspace } from "./client-nfse-workspace";

/** O mês de hoje em Brasília: é nele que o Fiscal emite. */
function currentPeriod(now: Date): { year: number; month: number } {
  const shifted = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1 };
}

function parsePeriod(year: string | undefined, month: string | undefined, now: Date): { year: number; month: number } {
  const parsedYear = Number(year);
  const parsedMonth = Number(month);
  if (Number.isInteger(parsedYear) && parsedYear >= 2000 && parsedYear <= 2100 && Number.isInteger(parsedMonth) && parsedMonth >= 1 && parsedMonth <= 12) {
    return { year: parsedYear, month: parsedMonth };
  }
  return currentPeriod(now);
}

/**
 * Notas dos clientes (decisão de 2026-10-22, tela única desde 2026-10-23):
 * NFS-e de serviço que as empresas emitem todo mês, pelo CNPJ e com o
 * certificado de cada uma.
 */
export async function ClientNfseTab({
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
  const { workspace, vault } = await withOrgTx(orgId, async (tx) => ({
    workspace: await loadClientNfseWorkspace(tx, { orgId, ...period, now }),
    vault: await loadVaultPublicKey(tx, orgId),
  }));
  return (
    <ClientNfseWorkspace
      clanId={clanId}
      period={period}
      canManage={canManage}
      issuers={workspace.issuers}
      candidates={workspace.candidates}
      serviceReady={Boolean(vault)}
    />
  );
}
