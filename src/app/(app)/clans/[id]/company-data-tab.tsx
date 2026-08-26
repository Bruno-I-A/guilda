"use client";

import {
  Building2,
  CalendarDays,
  Database,
  Landmark,
  LoaderCircle,
  Mail,
  MapPin,
  Phone,
  Search,
  UsersRound,
} from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCnpj } from "@/domain/cnpj";
import { formatBRLCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

import {
  lookupCompanyDataCnpj,
  type CompanyDataLookupView,
} from "./company-flow-actions";

function formatDate(value: string | null): string {
  if (!value) return "Não informado";
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("pt-BR", {
    timeZone: "UTC",
  });
}

function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return value;
}

function DataItem({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="grid gap-1 rounded-md bg-muted/25 p-3">
      <span className="hud-label">{label}</span>
      <span className="text-sm font-medium">{value || "Não informado"}</span>
    </div>
  );
}

export function CompanyDataTab({ clanId }: { clanId: string }) {
  const [cnpj, setCnpj] = useState("");
  const [company, setCompany] = useState<CompanyDataLookupView | null>(null);
  const [pending, startTransition] = useTransition();
  const digits = cnpj.replace(/\D/g, "");

  function lookup() {
    startTransition(async () => {
      const result = await lookupCompanyDataCnpj({ clanId, cnpj });
      if (!result.ok || !result.data) {
        toast.error(result.ok ? "A consulta não retornou dados." : result.error);
        return;
      }
      setCompany(result.data);
      setCnpj(formatCnpj(result.data.normalizedCnpj));
    });
  }

  const address = company?.address
    ? [
        [company.address.street, company.address.number].filter(Boolean).join(", "),
        company.address.complement,
        [company.address.district, company.address.city, company.address.state]
          .filter(Boolean)
          .join(" · "),
        company.address.zipCode ? `CEP ${company.address.zipCode}` : null,
      ].filter(Boolean)
    : [];
  const active = company?.cadastralSituation === "ATIVA";

  return (
    <div className="grid gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-xl font-semibold">Dados da empresa</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Consulte agora o retrato cadastral do CNPJ na Receita. Esta área será a
            base do cadastro completo das empresas em uma próxima etapa.
          </p>
        </div>
        <Badge variant="outline" className="gap-1.5">
          <Database className="size-3.5" aria-hidden /> Consulta externa
        </Badge>
      </header>

      <form
        className="panel-cut grid gap-3 rounded-lg border bg-card/45 p-4 sm:grid-cols-[minmax(16rem,34rem)_auto] sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          lookup();
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="company-data-cnpj">CNPJ da empresa</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              id="company-data-cnpj"
              className="pl-9 font-mono"
              value={cnpj}
              onChange={(event) => setCnpj(event.target.value)}
              placeholder="00.000.000/0000-00"
              inputMode="numeric"
              autoComplete="off"
            />
          </div>
        </div>
        <Button type="submit" disabled={pending || digits.length !== 14}>
          {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Search aria-hidden />}
          Consultar CNPJ
        </Button>
      </form>

      {!company ? (
        <div className="grid min-h-72 place-items-center rounded-lg border border-dashed bg-card/20 p-8 text-center">
          <div className="grid max-w-md justify-items-center gap-3">
            <span className="grid size-14 place-items-center rounded-full border bg-muted/30">
              <Building2 className="size-6 text-primary" aria-hidden />
            </span>
            <div>
              <p className="font-medium">Consulte uma empresa pelo CNPJ</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Os dados são apenas exibidos nesta etapa e ainda não alteram o cadastro da Guilda.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-4">
          <section className="panel-cut grid gap-4 rounded-lg border bg-card/55 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
              <div className="min-w-0">
                <p className="hud-label">Razão social</p>
                <h3 className="mt-1 font-heading text-xl font-semibold">{company.legalName}</h3>
                <p className="mt-1 font-mono text-sm text-muted-foreground">
                  {formatCnpj(company.normalizedCnpj)}
                </p>
                {company.tradeName ? (
                  <p className="mt-2 text-sm">Nome fantasia: {company.tradeName}</p>
                ) : null}
              </div>
              <Badge
                variant="outline"
                className={cn(
                  "text-sm",
                  active
                    ? "border-emerald-500/45 bg-emerald-500/10 text-emerald-300"
                    : "border-amber-500/45 bg-amber-500/10 text-amber-300",
                )}
              >
                {company.cadastralSituation ?? "Situação não informada"}
              </Badge>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <DataItem label="Abertura" value={formatDate(company.openedAt)} />
              <DataItem label="Matriz / filial" value={company.headquartersType} />
              <DataItem label="Porte" value={company.companySize} />
              <DataItem
                label="Capital social"
                value={company.shareCapital ? formatBRLCurrency(company.shareCapital) : null}
              />
              <DataItem label="Natureza jurídica" value={company.legalNature} />
              <DataItem
                label="Simples Nacional"
                value={company.isSimplesOptant === null ? null : company.isSimplesOptant ? "Optante" : "Não optante"}
              />
              <DataItem
                label="MEI"
                value={company.isMeiOptant === null ? null : company.isMeiOptant ? "Optante" : "Não optante"}
              />
              <DataItem
                label="Situação desde"
                value={formatDate(company.cadastralSituationDate)}
              />
            </div>
          </section>

          <div className="grid gap-4 xl:grid-cols-2">
            <section className="grid content-start gap-3 rounded-lg border bg-card/35 p-4">
              <h3 className="flex items-center gap-2 font-medium">
                <MapPin className="size-4 text-primary" aria-hidden /> Endereço
              </h3>
              {address.length > 0 ? (
                <div className="text-sm leading-6">{address.map((line) => <p key={line}>{line}</p>)}</div>
              ) : <p className="text-sm text-muted-foreground">Endereço não informado.</p>}
            </section>

            <section className="grid content-start gap-3 rounded-lg border bg-card/35 p-4">
              <h3 className="flex items-center gap-2 font-medium">
                <Phone className="size-4 text-primary" aria-hidden /> Contatos
              </h3>
              <div className="grid gap-2 text-sm">
                {company.email ? <p className="flex items-center gap-2"><Mail className="size-3.5 text-muted-foreground" aria-hidden /> {company.email}</p> : null}
                {company.phones.map((phone) => <p key={phone} className="flex items-center gap-2"><Phone className="size-3.5 text-muted-foreground" aria-hidden /> {formatPhone(phone)}</p>)}
                {!company.email && company.phones.length === 0 ? <p className="text-muted-foreground">Contatos não informados.</p> : null}
              </div>
            </section>
          </div>

          <section className="grid gap-3 rounded-lg border bg-card/35 p-4">
            <h3 className="flex items-center gap-2 font-medium">
              <Landmark className="size-4 text-primary" aria-hidden /> Atividades econômicas
            </h3>
            {company.cnaeDescription ? (
              <div className="rounded-md border border-primary/25 bg-primary/5 p-3">
                <p className="hud-label mb-1">Atividade principal</p>
                <p className="text-sm"><span className="font-mono text-xs text-muted-foreground">{company.cnaeCode}</span> · {company.cnaeDescription}</p>
              </div>
            ) : null}
            {company.secondaryCnaes.length > 0 ? (
              <div>
                <p className="hud-label mb-2">Atividades secundárias · {company.secondaryCnaes.length}</p>
                <div className="grid max-h-72 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
                  {company.secondaryCnaes.map((activity) => (
                    <div key={`${activity.code}-${activity.description}`} className="rounded-md bg-muted/25 p-2.5 text-sm">
                      <span className="font-mono text-xs text-muted-foreground">{activity.code}</span>
                      <p className="mt-0.5">{activity.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {!company.cnaeDescription && company.secondaryCnaes.length === 0 ? <p className="text-sm text-muted-foreground">Atividades não informadas.</p> : null}
          </section>

          <section className="grid gap-3 rounded-lg border bg-card/35 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 font-medium">
                <UsersRound className="size-4 text-primary" aria-hidden /> Quadro societário
              </h3>
              <Badge variant="outline">{company.qsa.length} integrante{company.qsa.length === 1 ? "" : "s"}</Badge>
            </div>
            {company.qsa.length > 0 ? (
              <div className="grid gap-2 md:grid-cols-2">
                {company.qsa.map((member, index) => (
                  <div key={`${member.name}-${index}`} className="rounded-md border bg-muted/15 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="font-medium">{member.name}</p>
                      <Badge variant={member.participation ? "default" : "outline"}>
                        {member.participation ?? "Percentual não informado"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{member.qualification ?? "Qualificação não informada"}</p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {member.document ? <span className="font-mono">{member.document}</span> : null}
                      {member.joinedAt ? <span className="flex items-center gap-1"><CalendarDays className="size-3" aria-hidden /> Entrada em {formatDate(member.joinedAt)}</span> : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-muted-foreground">Quadro societário não informado.</p>}
            {company.qsa.some((member) => !member.participation) ? (
              <p className="text-xs text-amber-200/85">A consulta pública da Receita não informa a porcentagem societária. Confira a participação de cada sócio no contrato social.</p>
            ) : null}
          </section>

          {company.taxRegimes.length > 0 ? (
            <section className="grid gap-3 rounded-lg border bg-card/35 p-4">
              <h3 className="font-medium">Histórico tributário disponível</h3>
              <div className="flex flex-wrap gap-2">
                {company.taxRegimes.map((regime, index) => (
                  <Badge key={`${regime.year}-${regime.form}-${index}`} variant="outline" className="font-normal">
                    {regime.year ? `${regime.year} · ` : ""}{regime.form}
                  </Badge>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
