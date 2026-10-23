import type { ReactNode } from "react";

import { SegmentedNav } from "@/components/segmented-nav";
import { withOrgTx } from "@/db/org-tx";
import { loadClientNfseMonth, loadClientNfseRegistry } from "@/lib/client-nfse/loaders";
import { loadVaultPublicKey } from "@/lib/nfse/xml-requests";

import { ClientNfseMonth } from "./client-nfse-month";
import { ClientNfseRegistry } from "./client-nfse-registry";

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

function Views({ clanId, active, children }: { clanId: string; active: "month" | "base"; children: ReactNode }) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <SegmentedNav
        label="Visões das notas dos clientes"
        active={active}
        items={[
          { key: "month", label: "Mês a mês", href: `/clans/${clanId}?tab=client-notes` },
          { key: "base", label: "Cadastro", href: `/clans/${clanId}?tab=client-notes&nfseView=base` },
        ]}
      />
      {children}
    </div>
  );
}

/**
 * Notas dos clientes (decisão de 2026-10-22): NFS-e de serviço que as
 * empresas emitem todo mês, pelo CNPJ e com o certificado de cada uma. Duas
 * visões, como nos Honorários: Mês a mês (padrão) e Cadastro.
 */
export async function ClientNfseTab({
  orgId,
  clanId,
  canManage,
  requestedView,
  requestedYear,
  requestedMonth,
}: {
  orgId: string;
  clanId: string;
  canManage: boolean;
  requestedView?: string;
  requestedYear?: string;
  requestedMonth?: string;
}) {
  const now = new Date();
  if (requestedView === "base") {
    const registry = await withOrgTx(orgId, (tx) => loadClientNfseRegistry(tx, { orgId, now }));
    return (
      <Views clanId={clanId} active="base">
        <ClientNfseRegistry clanId={clanId} canManage={canManage} issuers={registry.issuers} candidates={registry.candidates} period={currentPeriod(now)} />
      </Views>
    );
  }
  const period = parsePeriod(requestedYear, requestedMonth, now);
  const { data, vault } = await withOrgTx(orgId, async (tx) => ({
    data: await loadClientNfseMonth(tx, { orgId, ...period, now }),
    vault: await loadVaultPublicKey(tx, orgId),
  }));
  return (
    <Views clanId={clanId} active="month">
      <ClientNfseMonth
        clanId={clanId}
        year={period.year}
        month={period.month}
        canManage={canManage}
        activeModels={data.activeModels}
        issuers={data.issuers}
        serviceReady={Boolean(vault)}
      />
    </Views>
  );
}
