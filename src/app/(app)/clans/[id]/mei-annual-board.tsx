"use client";

import {
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Save,
  Search,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCnpj } from "@/domain/cnpj";
import {
  MEI_DECLARATION_STATUSES,
  MEI_DECLARATION_STATUS_LABELS,
  type MeiDeclarationStatus,
} from "@/domain/mei-declaration";
import { cn } from "@/lib/utils";

import { ClanEmptyState, ClanSectionHeading, ClanStatusStrip } from "./clan-ui";
import { saveMeiDeclaration } from "./mei-actions";

export interface MeiAnnualRowView {
  clientId: string;
  clientName: string;
  cnpj: string | null;
  status: MeiDeclarationStatus;
  submittedAt: string | null;
  notes: string | null;
  updatedAt: string | null;
  updatedByName: string | null;
}

function yearHref(clanId: string, year: number): string {
  return `/clans/${clanId}?tab=mei&meiYear=${year}`;
}

function formatUpdatedAt(value: string | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  });
}

function DeclarationRow({
  clanId,
  year,
  row,
  canManage,
}: {
  clanId: string;
  year: number;
  row: MeiAnnualRowView;
  canManage: boolean;
}) {
  const [status, setStatus] = useState(row.status);
  const [submittedAt, setSubmittedAt] = useState(row.submittedAt ?? "");
  const [notes, setNotes] = useState(row.notes ?? "");
  const [saving, startSaving] = useTransition();

  const save = () => {
    startSaving(async () => {
      const result = await saveMeiDeclaration({
        clanId,
        clientId: row.clientId,
        year,
        status,
        submittedAt,
        notes,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Declaração de ${row.clientName} salva.`);
    });
  };

  return (
    <TableRow className={cn(status === "submitted" && "bg-success/5")}>
      <TableCell className="min-w-64">
        <span className="block max-w-72 truncate font-medium">{row.clientName}</span>
        {row.updatedAt ? (
          <span className="block text-[11px] text-muted-foreground">
            Atualizado por {row.updatedByName ?? "integrante"} em {formatUpdatedAt(row.updatedAt)}
          </span>
        ) : null}
      </TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">
        {row.cnpj ? formatCnpj(row.cnpj) : "—"}
      </TableCell>
      <TableCell>
        <Select
          value={status}
          disabled={!canManage || saving}
          onValueChange={(value) => {
            const next = value as MeiDeclarationStatus;
            setStatus(next);
            if (next !== "submitted") setSubmittedAt("");
          }}
        >
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            {MEI_DECLARATION_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {MEI_DECLARATION_STATUS_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Input
          type="date"
          className="w-40"
          value={submittedAt}
          disabled={!canManage || saving || status !== "submitted"}
          onChange={(event) => setSubmittedAt(event.target.value)}
        />
      </TableCell>
      <TableCell>
        <Input
          className="min-w-72"
          value={notes}
          maxLength={3000}
          disabled={!canManage || saving}
          placeholder="Pendências ou observações"
          onChange={(event) => setNotes(event.target.value)}
        />
      </TableCell>
      <TableCell className="text-right">
        <Button type="button" size="sm" disabled={!canManage || saving} onClick={save}>
          {saving ? <LoaderCircle className="animate-spin" aria-hidden /> : <Save aria-hidden />}
          Salvar
        </Button>
      </TableCell>
    </TableRow>
  );
}

export function MeiAnnualBoard({
  clanId,
  year,
  canManage,
  rows,
}: {
  clanId: string;
  year: number;
  canManage: boolean;
  rows: MeiAnnualRowView[];
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
  const cnpjQuery = normalizedQuery.replace(/\D/g, "");
  const visible = useMemo(
    () => rows.filter((row) =>
      !normalizedQuery ||
      row.clientName.toLocaleLowerCase("pt-BR").includes(normalizedQuery) ||
      (cnpjQuery.length > 0 && row.cnpj?.includes(cnpjQuery)),
    ),
    [cnpjQuery, normalizedQuery, rows],
  );
  const submitted = rows.filter((row) => row.status === "submitted").length;
  const inProgress = rows.filter((row) => row.status === "in_progress").length;
  const pending = rows.length - submitted - inProgress;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-xl font-medium">Declarações anuais do MEI</h2>
          <p className="text-sm text-muted-foreground">
            Controle da DASN-SIMEI por ano-calendário. Estas empresas não entram na Carteira nem nas Fichas Fiscais.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button asChild type="button" variant="outline" size="icon-sm">
            <Link href={yearHref(clanId, year - 1)} aria-label="Ano anterior"><ChevronLeft aria-hidden /></Link>
          </Button>
          <Badge variant="outline" className="h-8 px-3">Ano-calendário {year}</Badge>
          <Button asChild type="button" variant="outline" size="icon-sm">
            <Link href={yearHref(clanId, year + 1)} aria-label="Próximo ano"><ChevronRight aria-hidden /></Link>
          </Button>
        </div>
      </div>

      <ClanStatusStrip items={[
        { label: "Empresas MEI", value: rows.length },
        { label: "Pendentes", value: pending, tone: pending ? "warning" : "neutral" },
        { label: "Em andamento", value: inProgress },
        { label: "Entregues", value: submitted, tone: "positive" },
      ]} />

      {rows.length === 0 ? (
        <ClanEmptyState
          icon={<CalendarCheck className="size-7" aria-hidden />}
          title="Nenhuma empresa MEI ativa"
          description="Quando uma empresa for cadastrada com regime MEI, ela aparecerá automaticamente nesta planilha."
        />
      ) : (
        <>
          <ClanSectionHeading>Planilha anual</ClanSectionHeading>
          <div className="relative max-w-xl">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar empresa ou CNPJ" className="pl-9" />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Empresa</TableHead>
                <TableHead>CNPJ</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Data da entrega</TableHead>
                <TableHead>Observações</TableHead>
                <TableHead><span className="sr-only">Salvar</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((row) => (
                <DeclarationRow key={row.clientId} clanId={clanId} year={year} row={row} canManage={canManage} />
              ))}
            </TableBody>
          </Table>
          {visible.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhuma empresa corresponde à busca.</p>
          ) : null}
        </>
      )}
    </div>
  );
}
