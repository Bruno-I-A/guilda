"use client";

import { FilePlus2, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCnpj } from "@/domain/cnpj";
import { formatBRLCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

import { OfficeFeeImportDialog } from "./office-fee-import-dialog";
import {
  OfficeFeeProfileDialog,
  type OfficeFeeProfileView,
} from "./office-fee-profile-dialog";
import { OfficeFeeTakerDialog, type OfficeFeeTakerView } from "./office-fee-taker-dialog";

export interface OfficeFeeProfileRowView {
  clientId: string;
  clientName: string;
  cnpj: string | null;
  active: boolean;
  profile: OfficeFeeProfileView;
}

export interface OfficeFeeTakerRowView {
  taker: OfficeFeeTakerView;
  profile: OfficeFeeProfileView;
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
}

export function OfficeFeeProfileBoard({
  clanId,
  canManage,
  rows,
  takers,
  availableClients,
}: {
  clanId: string;
  canManage: boolean;
  rows: readonly OfficeFeeProfileRowView[];
  takers: readonly OfficeFeeTakerRowView[];
  availableClients: readonly { id: string; name: string; cnpj: string | null }[];
}) {
  const [query, setQuery] = useState("");
  const [newClientId, setNewClientId] = useState("");
  const needle = normalize(query.trim());
  const visible = useMemo(() => rows.filter((row) => {
    if (needle && !normalize(`${row.clientName} ${row.cnpj ?? ""}`).includes(needle)) return false;
    return true;
  }), [needle, rows]);
  const total = [...rows, ...takers.filter((row) => row.taker.active)].reduce((sum, row) => sum + Number(row.profile.monthlyFee), 0);
  const visibleTakers = takers.filter((row) => !needle || normalize(`${row.taker.name} ${row.taker.document}`).includes(needle));
  const selectedClient = availableClients.find((client) => client.id === newClientId) ?? null;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-medium">Honorários do escritório</h2>
          <p className="text-sm text-muted-foreground">Base permanente da planilha: parcela adicional, valor e observações.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManage ? <OfficeFeeImportDialog clanId={clanId} /> : null}
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg bg-muted/40 p-3"><span className="text-xs text-muted-foreground">Empresas cadastradas</span><strong className="block font-mono text-lg">{rows.length}{takers.length > 0 ? <span className="text-sm text-muted-foreground"> + {takers.length} avulso(s)</span> : null}</strong></div>
        <div className="rounded-lg bg-success/10 p-3"><span className="text-xs text-muted-foreground">Honorários mensais</span><strong className="block font-mono text-lg text-success">{formatBRLCurrency(total.toFixed(2))}</strong></div>
        <div className="rounded-lg bg-muted/40 p-3"><span className="text-xs text-muted-foreground">Com parcela adicional</span><strong className="block font-mono text-lg">{[...rows, ...takers].filter((row) => row.profile.chargesAdditionalInstallment).length}</strong></div>
      </div>
      {canManage ? <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card/50 p-3"><p className="max-w-xl text-sm text-muted-foreground">Quem paga honorário mas não é empresa-cliente (filial de terceiro, produtor rural com CPF) entra como tomador avulso.</p><OfficeFeeTakerDialog clanId={clanId} taker={null} profile={null} /></div> : null}
      {canManage && availableClients.length > 0 ? (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-card/50 p-3">
          <div className="grid min-w-64 flex-1 gap-1.5"><Label htmlFor="new-office-fee-client">Cadastrar empresa fora da planilha</Label><Select value={newClientId} onValueChange={setNewClientId}><SelectTrigger id="new-office-fee-client"><SelectValue placeholder="Escolha uma empresa sem honorário" /></SelectTrigger><SelectContent>{availableClients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name}{client.cnpj ? ` · ${formatCnpj(client.cnpj)}` : ""}</SelectItem>)}</SelectContent></Select></div>
          {selectedClient ? <OfficeFeeProfileDialog clanId={clanId} clientId={selectedClient.id} clientName={selectedClient.name} profile={null} canManage triggerLabel="Cadastrar" /> : <Button type="button" variant="outline" disabled><FilePlus2 aria-hidden /> Cadastrar</Button>}
        </div>
      ) : null}
      <div className="grid gap-2">
        <div className="relative"><Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar empresa ou CNPJ" className="pl-9" /></div>
      </div>
      {rows.length === 0 ? <div className="grid justify-items-center gap-2 rounded-lg border border-dashed p-10 text-center"><FilePlus2 className="size-8 text-muted-foreground" aria-hidden /><p className="font-medium">Nenhum honorário cadastrado</p><p className="max-w-md text-sm text-muted-foreground">Importe a planilha para conciliar os clientes ou cadastre uma empresa manualmente.</p></div> : (
        <Table>
          <TableHeader><TableRow><TableHead className="min-w-40">Clientes</TableHead><TableHead>CNPJ</TableHead><TableHead className="text-center">Parcela adicional</TableHead><TableHead className="text-right">Honorário mensal</TableHead><TableHead>Observações</TableHead><TableHead><span className="sr-only">Editar</span></TableHead></TableRow></TableHeader>
          <TableBody>{visible.map((row) => <TableRow key={row.profile.id ?? row.clientId} className={cn(!row.active && "opacity-60")}><TableCell><span className="block max-w-64 truncate font-medium">{row.clientName}</span>{!row.active ? <Badge variant="outline" className="mt-1 text-[10px]">inativa</Badge> : null}</TableCell><TableCell className="font-mono text-xs text-muted-foreground">{row.cnpj ? formatCnpj(row.cnpj) : "—"}</TableCell><TableCell className="text-center"><Badge variant={row.profile.chargesAdditionalInstallment ? "secondary" : "outline"}>{row.profile.chargesAdditionalInstallment ? "Sim" : "Não"}</Badge></TableCell><TableCell className="text-right font-mono text-success">{formatBRLCurrency(row.profile.monthlyFee)}</TableCell><TableCell><span className="line-clamp-2 max-w-xl whitespace-pre-wrap text-xs text-muted-foreground">{row.profile.permanentNotes ?? "—"}</span></TableCell><TableCell><OfficeFeeProfileDialog clanId={clanId} clientId={row.clientId} clientName={row.clientName} profile={row.profile} canManage /></TableCell></TableRow>)}</TableBody>
        </Table>
      )}
      {visibleTakers.length > 0 ? (
        <section className="grid gap-2">
          <h2>Tomadores avulsos</h2>
          <Table>
            <TableHeader><TableRow><TableHead className="min-w-40">Nome</TableHead><TableHead>CPF/CNPJ</TableHead><TableHead className="text-center">Parcela adicional</TableHead><TableHead className="text-right">Honorário mensal</TableHead><TableHead>Observações</TableHead><TableHead><span className="sr-only">Editar</span></TableHead></TableRow></TableHeader>
            <TableBody>{visibleTakers.map((row) => <TableRow key={row.taker.id} className={cn(!row.taker.active && "opacity-60")}><TableCell><span className="block max-w-64 truncate font-medium">{row.taker.name}</span>{!row.taker.active ? <Badge variant="outline" className="mt-1 text-[10px]">inativo</Badge> : null}</TableCell><TableCell className="font-mono text-xs text-muted-foreground">{formatCnpj(row.taker.document)}</TableCell><TableCell className="text-center"><Badge variant={row.profile.chargesAdditionalInstallment ? "secondary" : "outline"}>{row.profile.chargesAdditionalInstallment ? "Sim" : "Não"}</Badge></TableCell><TableCell className="text-right font-mono text-success">{formatBRLCurrency(row.profile.monthlyFee)}</TableCell><TableCell><span className="line-clamp-2 max-w-xl whitespace-pre-wrap text-xs text-muted-foreground">{row.profile.permanentNotes ?? "—"}</span></TableCell><TableCell>{canManage ? <OfficeFeeTakerDialog clanId={clanId} taker={row.taker} profile={row.profile} /> : null}</TableCell></TableRow>)}</TableBody>
          </Table>
        </section>
      ) : null}
      {visible.length === 0 && rows.length > 0 ? <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhuma empresa corresponde aos filtros.</p> : null}
    </div>
  );
}
