"use client";

import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  ClipboardCheck,
  LoaderCircle,
  MessageSquareText,
  Search,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { Textarea } from "@/components/ui/textarea";
import { formatCnpj } from "@/domain/cnpj";
import type { FiscalControlStatus, FiscalStepStatus } from "@/domain/fiscal-control";
import type { OfficeFeeStage } from "@/domain/office-fee-control";
import { formatBRLCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

import { openOfficeFeeControlPeriod, updateOfficeFeeControl } from "./office-fee-actions";
import { OFFICE_FEE_BILLING_LABELS } from "./office-fee-profile-dialog";

export interface OfficeFeeControlRowView {
  id: string;
  clientId: string;
  clientName: string;
  cnpj: string | null;
  responsibleUserId: string | null;
  responsibleName: string | null;
  profileVersion: number;
  profileSnapshot: {
    billingMethod: "asaas" | "recibo" | "pix" | "other";
    chargesAdditionalInstallment: boolean;
    monthlyFee: string;
    permanentNotes: string | null;
  };
  invoiceStatus: FiscalStepStatus;
  additionalInstallmentStatus: FiscalStepStatus;
  collectionStatus: FiscalStepStatus;
  status: FiscalControlStatus;
  monthlyNotes: string | null;
  updatedAt: string;
  canEdit: boolean;
  history: readonly {
    id: string;
    eventType: "created" | "step_updated" | "status_updated" | "note_updated" | "completed" | "reopened";
    stage: OfficeFeeStage | null;
    actorName: string;
    createdAt: string;
  }[];
}

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"] as const;
const STATUS_LABELS: Record<FiscalControlStatus, string> = { not_started: "Não iniciado", in_progress: "Em andamento", blocked: "Bloqueado", completed: "Concluído" };
const STAGES: Array<{ key: OfficeFeeStage; field: keyof Pick<OfficeFeeControlRowView, "invoiceStatus" | "additionalInstallmentStatus" | "collectionStatus">; label: string; long: string }> = [
  { key: "invoice", field: "invoiceStatus", label: "Nota", long: "Nota principal" },
  { key: "additional_installment", field: "additionalInstallmentStatus", label: "2ª", long: "Parcela adicional" },
  { key: "collection", field: "collectionStatus", label: "Cobrança", long: "Cobrança processada" },
];

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
}

function adjacentPeriod(year: number, month: number, delta: number) {
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

function periodHref(clanId: string, year: number, month: number): string {
  return `/clans/${clanId}?tab=fees&feeView=control&fiscalYear=${year}&fiscalMonth=${month}`;
}

function eventText(event: OfficeFeeControlRowView["history"][number]): string {
  if (event.eventType === "created") return "Competência aberta";
  if (event.eventType === "completed") return "Controle concluído";
  if (event.eventType === "reopened") return "Controle reaberto";
  if (event.eventType === "note_updated") return "Observação atualizada";
  if (event.eventType === "step_updated" && event.stage) return `${STAGES.find((stage) => stage.key === event.stage)?.long ?? "Etapa"} atualizada`;
  return "Situação atualizada";
}

function StepButton({ clanId, controlId, stage, status, disabled }: { clanId: string; controlId: string; stage: OfficeFeeStage; status: FiscalStepStatus; disabled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (status === "not_applicable") return <span className="text-xs text-muted-foreground" title="Não se aplica">—</span>;
  const next: FiscalStepStatus = status === "pending" ? "completed" : status === "completed" ? "blocked" : "pending";
  const Icon = status === "pending" ? Circle : status === "completed" ? Check : AlertTriangle;
  const label = status === "pending" ? "Pendente" : status === "completed" ? "Concluído" : "Bloqueado";
  return <button type="button" disabled={disabled || pending} aria-label={`${label}. Clique para alterar.`} title={`${label}. Clique para alterar.`} className={cn("inline-flex size-7 items-center justify-center rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-60", status === "completed" && "border-success/40 bg-success/10 text-success", status === "blocked" && "border-destructive/50 bg-destructive/10 text-destructive", status === "pending" && "text-muted-foreground hover:bg-muted")} onClick={() => startTransition(async () => { const result = await updateOfficeFeeControl({ clanId, controlId, stage, stepStatus: next }); if (!result.ok) { toast.error(result.error); return; } router.refresh(); })}>{pending ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : <Icon className="size-3.5" aria-hidden />}</button>;
}

function DetailsDialog({ clanId, row, periodLabel }: { clanId: string; row: OfficeFeeControlRowView; periodLabel: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [notes, setNotes] = useState(row.monthlyNotes ?? "");
  function save() {
    startTransition(async () => {
      const result = await updateOfficeFeeControl({ clanId, controlId: row.id, monthlyNotes: notes });
      if (!result.ok) { toast.error(result.error); return; }
      toast.success("Observação do mês atualizada.");
      router.refresh();
    });
  }
  return <Dialog open={open} onOpenChange={(next) => { if (next) setNotes(row.monthlyNotes ?? ""); setOpen(next); }}><DialogTrigger asChild><Button type="button" variant="ghost" size="icon-sm" aria-label={`Detalhes de ${row.clientName}`}><MessageSquareText aria-hidden /></Button></DialogTrigger><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>{row.clientName} · {periodLabel}</DialogTitle><DialogDescription>Snapshot do honorário v{row.profileVersion} · {OFFICE_FEE_BILLING_LABELS[row.profileSnapshot.billingMethod]} · {formatBRLCurrency(row.profileSnapshot.monthlyFee)}</DialogDescription></DialogHeader>{row.profileSnapshot.permanentNotes ? <div className="rounded-lg border bg-muted/30 p-3 text-xs whitespace-pre-wrap"><strong className="block text-foreground">Orientação permanente</strong><span className="text-muted-foreground">{row.profileSnapshot.permanentNotes}</span></div> : null}<div className="grid gap-1.5"><Label htmlFor={`${row.id}-fee-note`}>Observação desta competência</Label><Textarea id={`${row.id}-fee-note`} value={notes} disabled={!row.canEdit} maxLength={3000} rows={3} onChange={(event) => setNotes(event.target.value)} />{row.canEdit ? <Button type="button" variant="outline" size="sm" disabled={pending} onClick={save}>Salvar observação</Button> : null}</div>{row.history.length > 0 ? <section className="grid gap-2 border-t pt-3"><h3 className="text-sm font-medium">Auditoria recente</h3><ul className="grid gap-1">{row.history.map((event) => <li key={event.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/30 px-2.5 py-1.5 text-xs"><span>{eventText(event)}</span><span className="text-muted-foreground">{event.actorName} · {new Date(event.createdAt).toLocaleString("pt-BR")}</span></li>)}</ul></section> : null}<DialogFooter><span className="mr-auto text-xs text-muted-foreground">Última alteração: {new Date(row.updatedAt).toLocaleString("pt-BR")}</span></DialogFooter></DialogContent></Dialog>;
}

export function OfficeFeeControlBoard({ clanId, year, month, canManage, members, rows }: { clanId: string; year: number; month: number; canManage: boolean; members: readonly { userId: string; name: string }[]; rows: readonly OfficeFeeControlRowView[] }) {
  const router = useRouter();
  const [opening, startOpening] = useTransition();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [responsible, setResponsible] = useState("all");
  const previous = adjacentPeriod(year, month, -1);
  const next = adjacentPeriod(year, month, 1);
  const label = `${MONTHS[month - 1]} de ${year}`;
  const visible = useMemo(() => {
    const needle = normalize(query.trim());
    return rows.filter((row) => {
      if (needle && !normalize(`${row.clientName} ${row.cnpj ?? ""}`).includes(needle)) return false;
      if (status === "pending_work" && row.status === "completed") return false;
      if (status !== "all" && status !== "pending_work" && row.status !== status) return false;
      if (responsible === "unassigned" && row.responsibleUserId) return false;
      if (responsible !== "all" && responsible !== "unassigned" && row.responsibleUserId !== responsible) return false;
      return true;
    });
  }, [query, responsible, rows, status]);
  const completed = rows.filter((row) => row.status === "completed").length;
  const blocked = rows.filter((row) => row.status === "blocked").length;
  const total = rows.reduce((sum, row) => sum + Number(row.profileSnapshot.monthlyFee), 0);
  function openPeriod() {
    startOpening(async () => {
      const result = await openOfficeFeeControlPeriod({ clanId, periodYear: year, periodMonth: month });
      if (!result.ok) { toast.error(result.error); return; }
      toast.success(`${result.data?.created ?? 0} empresa(s) adicionada(s) ao controle.`);
      router.refresh();
    });
  }
  return <div className="grid gap-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-heading text-lg font-medium">Controle de notas · {label}</h2><p className="text-sm text-muted-foreground">Marque nota, parcela adicional e cobrança; o mês fecha quando todas as etapas aplicáveis forem concluídas.</p></div><div className="flex items-center gap-1"><Button asChild type="button" variant="outline" size="icon-sm"><Link href={periodHref(clanId, previous.year, previous.month)} aria-label="Competência anterior"><ChevronLeft aria-hidden /></Link></Button><Badge variant="outline" className="h-8 px-3">{String(month).padStart(2, "0")}/{year}</Badge><Button asChild type="button" variant="outline" size="icon-sm"><Link href={periodHref(clanId, next.year, next.month)} aria-label="Próxima competência"><ChevronRight aria-hidden /></Link></Button>{canManage ? <Button type="button" size="sm" disabled={opening} onClick={openPeriod}>{opening ? <LoaderCircle className="animate-spin" aria-hidden /> : <ClipboardCheck aria-hidden />}{rows.length ? "Atualizar empresas" : "Abrir competência"}</Button> : null}</div></div>{rows.length === 0 ? <div className="grid justify-items-center gap-2 rounded-lg border border-dashed p-10 text-center"><ClipboardCheck className="size-8 text-muted-foreground" aria-hidden /><p className="font-medium">Competência ainda não aberta</p><p className="max-w-md text-sm text-muted-foreground">A equipe abre uma linha para cada empresa com honorário cadastrado, sem criar dezenas de missões.</p></div> : <><div className="grid gap-2 sm:grid-cols-4"><div className="rounded-lg bg-muted/40 p-3"><span className="text-xs text-muted-foreground">Progresso geral</span><strong className="block font-mono text-lg">{completed}/{rows.length}</strong></div><div className="rounded-lg bg-muted/40 p-3"><span className="text-xs text-muted-foreground">Bloqueadas</span><strong className={cn("block font-mono text-lg", blocked > 0 && "text-destructive")}>{blocked}</strong></div><div className="rounded-lg bg-muted/40 p-3"><span className="text-xs text-muted-foreground">Sem responsável</span><strong className="block font-mono text-lg">{rows.filter((row) => !row.responsibleUserId).length}</strong></div><div className="rounded-lg bg-success/10 p-3"><span className="text-xs text-muted-foreground">Valor desta competência</span><strong className="block font-mono text-lg text-success">{formatBRLCurrency(total.toFixed(2))}</strong></div></div><div className="grid gap-2 md:grid-cols-[minmax(12rem,1fr)_11rem_12rem]"><div className="relative"><Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar empresa ou CNPJ" className="pl-9" /></div><Select value={status} onValueChange={setStatus}><SelectTrigger><SelectValue placeholder="Situação" /></SelectTrigger><SelectContent><SelectItem value="all">Todas as situações</SelectItem><SelectItem value="pending_work">Com pendência</SelectItem>{Object.entries(STATUS_LABELS).map(([value, text]) => <SelectItem key={value} value={value}>{text}</SelectItem>)}</SelectContent></Select><Select value={responsible} onValueChange={setResponsible}><SelectTrigger><SelectValue placeholder="Responsável" /></SelectTrigger><SelectContent><SelectItem value="all">Todas as pessoas</SelectItem><SelectItem value="unassigned">Sem responsável</SelectItem>{members.map((member) => <SelectItem key={member.userId} value={member.userId}>{member.name}</SelectItem>)}</SelectContent></Select></div><Table><TableHeader><TableRow><TableHead className="min-w-52">Clientes</TableHead><TableHead>CNPJ</TableHead><TableHead>Cobrança</TableHead><TableHead className="text-center">2ª parcela</TableHead><TableHead className="text-right">Honorário</TableHead>{STAGES.map((stage) => <TableHead key={stage.key} className="text-center">{stage.label}</TableHead>)}<TableHead>Situação</TableHead><TableHead><span className="sr-only">Detalhes</span></TableHead></TableRow></TableHeader><TableBody>{visible.map((row) => <TableRow key={row.id} className={cn(row.status === "blocked" && "bg-destructive/5")}><TableCell><span className="block max-w-64 truncate font-medium">{row.clientName}</span><span className="text-[11px] text-muted-foreground">{row.responsibleName ?? "Sem responsável"} · regra v{row.profileVersion}</span></TableCell><TableCell className="font-mono text-xs text-muted-foreground">{row.cnpj ? formatCnpj(row.cnpj) : "—"}</TableCell><TableCell>{OFFICE_FEE_BILLING_LABELS[row.profileSnapshot.billingMethod]}</TableCell><TableCell className="text-center">{row.profileSnapshot.chargesAdditionalInstallment ? "Sim" : "Não"}</TableCell><TableCell className="text-right font-mono text-success">{formatBRLCurrency(row.profileSnapshot.monthlyFee)}</TableCell>{STAGES.map((stage) => <TableCell key={stage.key} className="text-center"><StepButton clanId={clanId} controlId={row.id} stage={stage.key} status={row[stage.field]} disabled={!row.canEdit} /></TableCell>)}<TableCell><Badge variant={row.status === "completed" ? "secondary" : row.status === "blocked" ? "destructive" : "outline"}>{STATUS_LABELS[row.status]}</Badge></TableCell><TableCell><DetailsDialog clanId={clanId} row={row} periodLabel={label} /></TableCell></TableRow>)}</TableBody></Table>{visible.length === 0 ? <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhuma empresa corresponde aos filtros.</p> : null}</>}</div>;
}
