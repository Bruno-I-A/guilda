"use client";

import {
  Building2,
  CalendarDays,
  Landmark,
  Mail,
  MapPin,
  Phone,
  UsersRound,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCnpj } from "@/domain/cnpj";
import { formatBRLCurrency } from "@/lib/currency";
import {
  TAX_REGIME_LABELS,
  type TaxRegime,
} from "@/lib/clients-ui";

interface ClientAddress {
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
}

interface ClientPartner {
  name: string;
  document: string | null;
  qualification: string | null;
  joinedAt: string | null;
  participation: string | null;
}

export interface ClientDetailsView {
  id: string;
  name: string;
  taxRegime: TaxRegime;
  cnpj: string | null;
  active: boolean;
  tradeName: string | null;
  operationalEmail: string | null;
  operationalPhone: string | null;
  revenueEmail: string | null;
  revenuePhones: string[];
  address: ClientAddress | null;
  cadastralSituation: string | null;
  cadastralSituationDate: string | null;
  companySize: string | null;
  legalNature: string | null;
  shareCapital: string | null;
  headquartersType: string | null;
  cnaeCode: string | null;
  cnaeDescription: string | null;
  secondaryCnaes: { code: string; description: string }[];
  openedAt: string | null;
  qsa: ClientPartner[];
  taxRegimeHistory: { year: number | null; form: string }[];
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

function formatDate(value: string | null): string {
  if (!value) return "Não informado";
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("pt-BR", {
    timeZone: "UTC",
  });
}

function DataItem({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="grid gap-1 border-l-2 border-primary/30 bg-muted/20 p-3">
      <span className="hud-label">{label}</span>
      <span className="font-medium">{value || "Não informado"}</span>
    </div>
  );
}

export function ClientDetailsDialog({
  client,
  open,
  onOpenChange,
}: {
  client: ClientDetailsView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const addressLines = client.address
    ? [
        [client.address.street, client.address.number].filter(Boolean).join(", "),
        client.address.complement,
        [client.address.district, client.address.city, client.address.state]
          .filter(Boolean)
          .join(" · "),
        client.address.zipCode ? `CEP ${client.address.zipCode}` : null,
      ].filter((line): line is string => Boolean(line))
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{client.name}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            {client.cnpj ? <span className="font-mono">{formatCnpj(client.cnpj)}</span> : "CNPJ não informado"}
            <Badge variant="outline">{TAX_REGIME_LABELS[client.taxRegime]}</Badge>
            <Badge variant="outline">{client.cadastralSituation ?? (client.active ? "Ativa" : "Inativa")}</Badge>
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <section className="grid gap-3 rounded-lg border bg-card/35 p-4">
            <h3 className="flex items-center gap-2">
              <Building2 className="size-4 text-primary" aria-hidden /> Cadastro
            </h3>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <DataItem label="Nome fantasia" value={client.tradeName} />
              <DataItem label="Abertura" value={formatDate(client.openedAt)} />
              <DataItem label="Matriz / filial" value={client.headquartersType} />
              <DataItem label="Porte" value={client.companySize} />
              <DataItem label="Natureza jurídica" value={client.legalNature} />
              <DataItem label="Capital social" value={formatBRLCurrency(client.shareCapital) || null} />
              <DataItem label="Situação desde" value={formatDate(client.cadastralSituationDate)} />
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="grid content-start gap-3 rounded-lg border bg-card/35 p-4">
              <h3 className="flex items-center gap-2">
                <Phone className="size-4 text-primary" aria-hidden /> Contatos
              </h3>
              <div className="grid gap-3">
                <div>
                  <p className="hud-label">Contato operacional da planilha</p>
                  <div className="mt-1 grid gap-1.5">
                    {client.operationalEmail ? <p className="flex items-center gap-2"><Mail className="size-4 text-muted-foreground" aria-hidden /> {client.operationalEmail}</p> : null}
                    {client.operationalPhone ? <p className="flex items-center gap-2"><Phone className="size-4 text-muted-foreground" aria-hidden /> {formatPhone(client.operationalPhone)}</p> : null}
                    {!client.operationalEmail && !client.operationalPhone ? <p className="text-muted-foreground">Não informado.</p> : null}
                  </div>
                </div>
                <div className="border-t pt-3">
                  <p className="hud-label">Contato disponível na Receita</p>
                  <div className="mt-1 grid gap-1.5">
                    {client.revenueEmail ? <p className="flex items-center gap-2"><Mail className="size-4 text-muted-foreground" aria-hidden /> {client.revenueEmail}</p> : null}
                    {client.revenuePhones.map((phone) => <p key={phone} className="flex items-center gap-2"><Phone className="size-4 text-muted-foreground" aria-hidden /> {formatPhone(phone)}</p>)}
                    {!client.revenueEmail && client.revenuePhones.length === 0 ? <p className="text-muted-foreground">Não informado.</p> : null}
                  </div>
                </div>
              </div>
            </section>

            <section className="grid content-start gap-3 rounded-lg border bg-card/35 p-4">
              <h3 className="flex items-center gap-2">
                <MapPin className="size-4 text-primary" aria-hidden /> Endereço
              </h3>
              {addressLines.length > 0 ? (
                <div className="leading-6">{addressLines.map((line) => <p key={line}>{line}</p>)}</div>
              ) : <p className="text-muted-foreground">Endereço não informado.</p>}
            </section>
          </div>

          <section className="grid gap-3 rounded-lg border bg-card/35 p-4">
            <h3 className="flex items-center gap-2">
              <Landmark className="size-4 text-primary" aria-hidden /> Atividades econômicas
            </h3>
            {client.cnaeDescription ? (
              <div className="border-l-2 border-primary bg-primary/5 p-3">
                <p className="hud-label">Atividade principal</p>
                <p className="mt-1"><span className="font-mono text-xs text-muted-foreground">{client.cnaeCode}</span> · {client.cnaeDescription}</p>
              </div>
            ) : null}
            {client.secondaryCnaes.length > 0 ? (
              <div>
                <p className="hud-label mb-2">Atividades secundárias · {client.secondaryCnaes.length}</p>
                <div className="grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2">
                  {client.secondaryCnaes.map((activity) => (
                    <div key={`${activity.code}-${activity.description}`} className="border bg-muted/15 p-2.5">
                      <span className="font-mono text-xs text-muted-foreground">{activity.code}</span>
                      <p className="mt-1">{activity.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {!client.cnaeDescription && client.secondaryCnaes.length === 0 ? <p className="text-muted-foreground">Atividades não informadas.</p> : null}
          </section>

          <section className="grid gap-3 rounded-lg border bg-card/35 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2">
                <UsersRound className="size-4 text-primary" aria-hidden /> Quadro societário
              </h3>
              <Badge variant="outline">{client.qsa.length} integrante{client.qsa.length === 1 ? "" : "s"}</Badge>
            </div>
            {client.qsa.length > 0 ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {client.qsa.map((partner, index) => (
                  <div key={`${partner.name}-${index}`} className="border bg-muted/15 p-3">
                    <p className="font-medium">{partner.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{partner.qualification ?? "Qualificação não informada"}</p>
                    {partner.joinedAt ? <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground"><CalendarDays className="size-3" aria-hidden /> Entrada em {formatDate(partner.joinedAt)}</p> : null}
                  </div>
                ))}
              </div>
            ) : <p className="text-muted-foreground">Quadro societário não informado.</p>}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
