import { and, asc, desc, eq, ilike, type SQL } from "drizzle-orm";
import { Building2, Search } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { SegmentedNav, type SegmentedNavItem } from "@/components/segmented-nav";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { formatCnpj } from "@/domain/cnpj";
import { getActiveMember, isAdminRole, requireOrgSession } from "@/lib/session";
import {
  TAX_REGIME_BADGE_CLASSES,
  TAX_REGIME_LABELS,
  TAX_REGIMES,
  type TaxRegime,
} from "@/lib/clients-ui";
import { cn } from "@/lib/utils";

import {
  ClientRowActions,
  ImportClientsButton,
  NewClientButton,
} from "./client-actions";

export const metadata: Metadata = { title: "Clientes" };

function parseRegime(value: string | undefined): TaxRegime | "all" {
  return TAX_REGIMES.includes(value as TaxRegime) ? (value as TaxRegime) : "all";
}

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; regime?: string }>;
}) {
  const session = await requireOrgSession();
  const viewer = await getActiveMember();
  if (!viewer) redirect("/onboarding");
  const isAdmin = isAdminRole(viewer.role);
  const params = await searchParams;
  const regime = parseRegime(params.regime);
  const q = (params.q ?? "").trim();

  const conditions: SQL[] = [eq(schema.clients.orgId, session.orgId)];
  if (regime !== "all") {
    conditions.push(eq(schema.clients.taxRegime, regime));
  }
  if (q) {
    conditions.push(ilike(schema.clients.name, `%${q}%`));
  }

  const clientList = await withOrgTx(session.orgId, (tx) =>
    tx.query.clients.findMany({
      where: and(...conditions),
      orderBy: [desc(schema.clients.active), asc(schema.clients.name)],
    }),
  );
  const activeCount = clientList.filter((c) => c.active).length;

  function regimeHref(key: TaxRegime | "all"): string {
    const qs = new URLSearchParams();
    if (key !== "all") qs.set("regime", key);
    if (q) qs.set("q", q);
    const suffix = qs.toString();
    return suffix ? `/clients?${suffix}` : "/clients";
  }

  // O filtro de regime é navegação por URL (preserva o `?q=` da busca), não
  // estado de cliente — por isso vira <SegmentedNav>, e não Tabs.
  const regimeItems: SegmentedNavItem[] = (["all", ...TAX_REGIMES] as const).map(
    (key) => ({
      key,
      label: key === "all" ? "Todos" : TAX_REGIME_LABELS[key],
      href: regimeHref(key),
    }),
  );

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Clientes"
        description={
          <>
            Empresas acompanhadas pela contabilidade —{" "}
            <span className="font-mono tabular-nums">{activeCount}</span>{" "}
            {activeCount === 1 ? "ativa" : "ativas"} de{" "}
            <span className="font-mono tabular-nums">{clientList.length}</span>.
          </>
        }
        action={
          <>
            {isAdmin ? <ImportClientsButton /> : null}
            <NewClientButton />
          </>
        }
      />

      {/* Filtros no mesmo trilho: as abas de regime e a busca dividem a
          borda inferior, então a linha lê como um só controle. */}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-border">
        <SegmentedNav
          items={regimeItems}
          active={regime}
          label="Filtrar por regime"
          className="border-b-0"
        />
        <form className="relative pb-2" action="/clients">
          {regime !== "all" ? (
            <input type="hidden" name="regime" value={regime} />
          ) : null}
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Buscar por nome…"
            className="w-56 pl-8"
            aria-label="Buscar empresa por nome"
          />
        </form>
      </div>

      {clientList.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-12 text-center">
          <Building2 className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">
            {q || regime !== "all"
              ? "Nenhuma empresa com estes filtros"
              : "Nenhuma empresa-cliente ainda"}
          </p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {q || regime !== "all"
              ? "Ajuste a busca ou o filtro de regime."
              : "Cadastre uma empresa ou importe novas empresas por planilha."}
          </p>
        </div>
      ) : (
        <ul className="grid gap-1.5">
          {clientList.map((client) => (
            <li
              key={client.id}
              className={cn(
                "panel-cut panel-cut-sm flex items-center gap-3 px-4 py-2.5",
                !client.active && "opacity-55",
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium leading-snug">{client.name}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <Badge
                    className={cn(
                      "h-4 px-1.5",
                      TAX_REGIME_BADGE_CLASSES[client.taxRegime],
                    )}
                  >
                    {TAX_REGIME_LABELS[client.taxRegime]}
                  </Badge>
                  {client.cnpj ? (
                    <span className="font-mono">{formatCnpj(client.cnpj)}</span>
                  ) : null}
                  {client.operationalEmail ? <span>{client.operationalEmail}</span> : null}
                  {client.operationalPhone ? <span>{client.operationalPhone}</span> : null}
                  {client.cnaeDescription ? (
                    <span className="max-w-80 truncate" title={client.cnaeDescription}>
                      {client.cnaeDescription}
                    </span>
                  ) : null}
                  {!client.active ? (
                    <Badge className="h-4 border-transparent bg-muted px-1.5 text-muted-foreground/70">
                      Inativa
                    </Badge>
                  ) : null}
                </div>
              </div>
              <ClientRowActions
                client={{
                  id: client.id,
                  name: client.name,
                  taxRegime: client.taxRegime,
                  cnpj: client.cnpj,
                  active: client.active,
                  tradeName: client.tradeName,
                  operationalEmail: client.operationalEmail,
                  operationalPhone: client.operationalPhone,
                  revenueEmail: client.revenueEmail,
                  revenuePhones: client.revenuePhones,
                  address: client.address,
                  cadastralSituation: client.cadastralSituation,
                  cadastralSituationDate: client.cadastralSituationDate,
                  companySize: client.companySize,
                  legalNature: client.legalNature,
                  shareCapital: client.shareCapital,
                  headquartersType: client.headquartersType,
                  cnaeCode: client.cnaeCode,
                  cnaeDescription: client.cnaeDescription,
                  secondaryCnaes: client.secondaryCnaes ?? [],
                  openedAt: client.openedAt,
                  qsa: client.qsa,
                  taxRegimeHistory: client.taxRegimeHistory,
                }}
                isAdmin={isAdmin}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
