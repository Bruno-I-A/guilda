"use client";

import {
  AlertTriangle,
  Check,
  Circle,
  ClipboardCheck,
  LoaderCircle,
  MessageSquareText,
  Search,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import styles from "./office-fee.module.css";
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
import { formatAppDateTime } from "@/lib/date-time";
import { cn } from "@/lib/utils";

import { NfseInvoiceCell, type NfseInvoiceView } from "./nfse-parts";
import { deleteOfficeFeeProfile, updateOfficeFeeControl } from "./office-fee-actions";

/** Notas ativas (não canceladas) de cada linha do controle, por tipo. */
export type NfseInvoicesByControl = Record<string, { monthly?: NfseInvoiceView; additional?: NfseInvoiceView }>;

export interface OfficeFeeControlRowView {
  id: string;
  /** null: tomador avulso, sem carteira. */
  clientId: string | null;
  /** null: empresa-cliente, não tomador avulso. */
  takerId: string | null;
  clientName: string;
  cnpj: string | null;
  responsibleUserId: string | null;
  responsibleName: string | null;
  profileVersion: number;
  profileSnapshot: {
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
  return <button type="button" disabled={disabled || pending} aria-label={`${label}. Clique para alterar.`} title={`${label}. Clique para alterar.`} className={cn("touch-target inline-flex size-7 items-center justify-center rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-60", status === "completed" && "border-success/40 bg-success/10 text-success", status === "blocked" && "border-destructive/50 bg-destructive/10 text-destructive", status === "pending" && "text-muted-foreground hover:bg-muted")} onClick={() => startTransition(async () => { const result = await updateOfficeFeeControl({ clanId, controlId, stage, stepStatus: next }); if (!result.ok) { toast.error(result.error); return; } router.refresh(); })}>{pending ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : <Icon className="size-3.5" aria-hidden />}</button>;
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
  return <Dialog open={open} onOpenChange={(next) => { if (next) setNotes(row.monthlyNotes ?? ""); setOpen(next); }}><DialogTrigger asChild><Button type="button" variant="ghost" size="icon-sm" className="touch-target" aria-label={`Detalhes de ${row.clientName}`}><MessageSquareText aria-hidden /></Button></DialogTrigger><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>{row.clientName} · {periodLabel}</DialogTitle><DialogDescription>Snapshot do honorário v{row.profileVersion} · {formatBRLCurrency(row.profileSnapshot.monthlyFee)}</DialogDescription></DialogHeader>{row.profileSnapshot.permanentNotes ? <div className="rounded-lg border bg-muted/30 p-3 text-xs whitespace-pre-wrap"><strong className="block text-foreground">Orientação permanente</strong><span className="text-muted-foreground">{row.profileSnapshot.permanentNotes}</span></div> : null}<div className="grid gap-1.5"><Label htmlFor={`${row.id}-fee-note`}>Observação desta competência</Label><Textarea id={`${row.id}-fee-note`} value={notes} disabled={!row.canEdit} maxLength={3000} rows={3} onChange={(event) => setNotes(event.target.value)} />{row.canEdit ? <Button type="button" variant="outline" size="sm" disabled={pending} onClick={save}>Salvar observação</Button> : null}</div>{row.history.length > 0 ? <section className="grid gap-2 border-t pt-3"><h3>Auditoria recente</h3><ul className="grid gap-1">{row.history.map((event) => <li key={event.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/30 px-2.5 py-1.5 text-xs"><span>{eventText(event)}</span><span className="text-muted-foreground">{event.actorName} · {formatAppDateTime(event.createdAt)}</span></li>)}</ul></section> : null}<DialogFooter><span className="mr-auto text-xs text-muted-foreground">Última alteração: {formatAppDateTime(row.updatedAt)}</span></DialogFooter></DialogContent></Dialog>;
}

function RemovePayerDialog({ clanId, row }: { clanId: string; row: OfficeFeeControlRowView }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function remove() {
    startTransition(async () => {
      const result = await deleteOfficeFeeProfile({
        clanId,
        clientId: row.clientId,
        takerId: row.takerId,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${row.clientName} saiu dos Honorários.`);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!pending) setOpen(next); }}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="touch-target text-destructive"
          aria-label={`Remover ${row.clientName} dos Honorários`}
        >
          <Trash2 aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Remover {row.clientName} dos Honorários?</DialogTitle>
          <DialogDescription>
            Esta ação retira o cadastro permanente e todas as linhas dele no Mês a mês.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p>
            Serão removidos o valor do honorário, as observações e o histórico operacional das competências.
          </p>
          <p className="text-muted-foreground">
            {row.clientId
              ? "A empresa continua cadastrada normalmente nas outras áreas da Guilda."
              : "O cadastro deste tomador avulso também será apagado."}
          </p>
          <p className="text-muted-foreground">
            Se já existir uma nota emitida ou na fila, a Guilda bloqueia a remoção para preservar o documento fiscal.
          </p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button type="button" variant="destructive" disabled={pending} onClick={remove}>
            {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
            Remover dos Honorários
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function OfficeFeeControlBoard({ clanId, year, month, canManage, members, rows, invoicesByControl }: { clanId: string; year: number; month: number; canManage: boolean; members: readonly { userId: string; name: string }[]; rows: readonly OfficeFeeControlRowView[]; invoicesByControl: NfseInvoicesByControl }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [responsible, setResponsible] = useState("all");
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
  return <div className={cn(styles.board, "grid gap-4")}>{rows.length === 0 ? <div className="grid justify-items-center gap-2 rounded-lg border border-dashed p-10 text-center"><ClipboardCheck className="size-8 text-muted-foreground" aria-hidden /><p className="font-medium">Competência ainda não aberta</p><p className="max-w-md text-sm text-muted-foreground">Use “Abrir {MONTHS[month - 1]}” acima: a Guilda cria uma linha para cada empresa com honorário cadastrado.</p></div> : <><div className={styles.tableHeading}><h3>Clientes da competência <span>{rows.length}</span></h3><p><span><strong>{completed}</strong> concluídos</span><span className={cn(blocked > 0 && "text-destructive")}><strong>{blocked}</strong> bloqueados</span><span><strong>{rows.filter((row) => row.clientId && !row.responsibleUserId).length}</strong> sem responsável</span></p></div><div className="grid gap-2 md:grid-cols-[minmax(12rem,1fr)_11rem_12rem]"><div className="relative"><Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden /><Input aria-label="Buscar empresa ou CNPJ" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar empresa ou CNPJ" className="pl-9" /></div><Select value={status} onValueChange={setStatus}><SelectTrigger className="w-full" aria-label="Filtrar por situação"><SelectValue placeholder="Situação" /></SelectTrigger><SelectContent><SelectItem value="all">Todas as situações</SelectItem><SelectItem value="pending_work">Com pendência</SelectItem>{Object.entries(STATUS_LABELS).map(([value, text]) => <SelectItem key={value} value={value}>{text}</SelectItem>)}</SelectContent></Select><Select value={responsible} onValueChange={setResponsible}><SelectTrigger className="w-full" aria-label="Filtrar por responsável"><SelectValue placeholder="Responsável" /></SelectTrigger><SelectContent><SelectItem value="all">Todas as pessoas</SelectItem><SelectItem value="unassigned">Sem responsável</SelectItem>{members.map((member) => <SelectItem key={member.userId} value={member.userId}>{member.name}</SelectItem>)}</SelectContent></Select></div><div className={styles.tableFrame}><Table><TableHeader><TableRow><TableHead className="min-w-52">Clientes</TableHead><TableHead className="text-center">2ª parcela</TableHead><TableHead className="text-right">Honorário</TableHead>{STAGES.map((stage) => <TableHead key={stage.key} className="text-center">{stage.label}</TableHead>)}<TableHead>Situação</TableHead><TableHead><span className="sr-only">Ações</span></TableHead></TableRow></TableHeader><TableBody>{visible.map((row) => <TableRow key={row.id} className={cn(row.status === "blocked" && "bg-destructive/5", invoicesByControl[row.id]?.monthly?.status === "issued" && styles.issued)}><TableCell><span className={styles.client}>{row.clientName}</span><span className={styles.clientMeta}><span className="font-mono tabular-nums">{row.cnpj ? formatCnpj(row.cnpj) : "Sem documento"}</span><span>{row.clientId ? row.responsibleName ?? "Sem responsável" : "Tomador avulso"}</span></span></TableCell><TableCell className="text-center">{row.profileSnapshot.chargesAdditionalInstallment ? "Sim" : "Não"}</TableCell><TableCell className="text-right font-mono font-medium tabular-nums">{formatBRLCurrency(row.profileSnapshot.monthlyFee)}</TableCell>{STAGES.map((stage) => { const invoice = stage.key === "invoice" ? invoicesByControl[row.id]?.monthly : stage.key === "additional_installment" ? invoicesByControl[row.id]?.additional : undefined; return <TableCell key={stage.key} className="text-center">{invoice ? <NfseInvoiceCell clanId={clanId} year={year} month={month} invoice={invoice} canManage={canManage} /> : <StepButton clanId={clanId} controlId={row.id} stage={stage.key} status={row[stage.field]} disabled={!row.canEdit} />}</TableCell>; })}<TableCell><span className={cn(styles.status, row.status === "completed" ? "text-success" : row.status === "blocked" ? "text-destructive" : row.status === "in_progress" ? "text-primary" : "text-muted-foreground")}>{STATUS_LABELS[row.status]}</span></TableCell><TableCell><div className="flex items-center"><DetailsDialog clanId={clanId} row={row} periodLabel={label} />{canManage ? <RemovePayerDialog clanId={clanId} row={row} /> : null}</div></TableCell></TableRow>)}</TableBody></Table></div>{visible.length === 0 ? <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhuma empresa corresponde aos filtros.</p> : null}</>}</div>;
}
