"use client";

import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  ClipboardCheck,
  FileWarning,
  LoaderCircle,
  MessageSquareText,
  Search,
  Send,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type {
  FiscalControlStatus,
  FiscalStage,
  FiscalStepStatus,
} from "@/domain/fiscal-control";
import {
  TAX_REGIME_LABELS,
  type TaxRegime,
} from "@/lib/clients-ui";
import { cn } from "@/lib/utils";

import {
  createFiscalExceptionMission,
  openFiscalControlPeriod,
  updateFiscalControl,
} from "./fiscal-actions";

export interface FiscalControlRowView {
  id: string;
  clientId: string;
  clientName: string;
  responsibleUserId: string | null;
  responsibleName: string | null;
  taxRegime: TaxRegime;
  profileVersion: number;
  profileSnapshot: {
    deliveryChannel: string | null;
    permanentNotes: string | null;
  };
  campaignId: string | null;
  movementsStatus: FiscalStepStatus;
  incomingStatus: FiscalStepStatus;
  outgoingStatus: FiscalStepStatus;
  guideStatus: FiscalStepStatus;
  deliveryStatus: FiscalStepStatus;
  nfsStatus: FiscalStepStatus;
  status: FiscalControlStatus;
  monthlyNotes: string | null;
  updatedAt: string;
  canEdit: boolean;
  history: readonly {
    id: string;
    eventType: "created" | "profile_synced" | "campaign_linked" | "step_updated" | "status_updated" | "note_updated" | "completed" | "reopened";
    stage: FiscalStage | null;
    actorName: string;
    createdAt: string;
  }[];
}

const MONTHS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
] as const;

const STATUS_LABELS: Record<FiscalControlStatus, string> = {
  not_started: "Não iniciado",
  in_progress: "Em andamento",
  blocked: "Bloqueado",
  completed: "Concluído",
};

const STAGES: Array<{
  key: FiscalStage;
  field: keyof Pick<FiscalControlRowView, "movementsStatus" | "incomingStatus" | "outgoingStatus" | "guideStatus" | "deliveryStatus" | "nfsStatus">;
  label: string;
}> = [
  { key: "movements", field: "movementsStatus", label: "Mov." },
  { key: "incoming", field: "incomingStatus", label: "Entrada" },
  { key: "outgoing", field: "outgoingStatus", label: "Saída" },
  { key: "guide", field: "guideStatus", label: "Guia" },
  { key: "delivery", field: "deliveryStatus", label: "Envio" },
  { key: "nfs", field: "nfsStatus", label: "NFS" },
];

const STAGE_LABELS: Record<FiscalStage, string> = {
  movements: "Movimentos",
  incoming: "Entrada",
  outgoing: "Saída",
  guide: "Guia",
  delivery: "Entrega",
  nfs: "NFS",
};

function eventText(event: FiscalControlRowView["history"][number]): string {
  if (event.eventType === "created") return "Competência criada";
  if (event.eventType === "profile_synced") return "Ficha atualizada antes do início";
  if (event.eventType === "campaign_linked") return "Campanha vinculada";
  if (event.eventType === "completed") return "Controle concluído";
  if (event.eventType === "reopened") return "Controle reaberto";
  if (event.eventType === "note_updated") return "Observação atualizada";
  if (event.eventType === "step_updated" && event.stage) {
    return `${STAGE_LABELS[event.stage]} atualizado`;
  }
  return "Situação atualizada";
}

function periodHref(clanId: string, year: number, month: number): string {
  return `/clans/${clanId}?tab=portfolio&fiscalView=control&fiscalYear=${year}&fiscalMonth=${month}`;
}

function adjacentPeriod(year: number, month: number, delta: number) {
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function StepButton({
  clanId,
  controlId,
  stage,
  status,
  disabled,
}: {
  clanId: string;
  controlId: string;
  stage: FiscalStage;
  status: FiscalStepStatus;
  disabled: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (status === "not_applicable") {
    return <span className="text-xs text-muted-foreground" title="Não se aplica">—</span>;
  }
  const next: FiscalStepStatus =
    status === "pending" ? "completed" : status === "completed" ? "blocked" : "pending";
  const label = status === "pending" ? "Pendente" : status === "completed" ? "Concluído" : "Bloqueado";
  const Icon = status === "pending" ? Circle : status === "completed" ? Check : AlertTriangle;

  return (
    <button
      type="button"
      disabled={disabled || pending}
      aria-label={`${label}. Clique para alterar.`}
      title={`${label}. Clique para alterar.`}
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        status === "completed" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
        status === "blocked" && "border-destructive/50 bg-destructive/10 text-destructive",
        status === "pending" && "text-muted-foreground hover:bg-muted",
      )}
      onClick={() =>
        startTransition(async () => {
          const result = await updateFiscalControl({
            clanId,
            controlId,
            stage,
            stepStatus: next,
          });
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          router.refresh();
        })
      }
    >
      {pending ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : <Icon className="size-3.5" aria-hidden />}
    </button>
  );
}

function activityLabel(
  stage: (typeof STAGES)[number],
  row: FiscalControlRowView,
): string {
  if (stage.key === "delivery") {
    return row.profileSnapshot.deliveryChannel
      ? `Envio da guia · ${row.profileSnapshot.deliveryChannel}`
      : "Envio da guia";
  }
  return stage.label;
}

function ControlDetailsDialog({
  clanId,
  row,
  periodLabel,
}: {
  clanId: string;
  row: FiscalControlRowView;
  periodLabel: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [notes, setNotes] = useState(row.monthlyNotes ?? "");
  const [missionNote, setMissionNote] = useState("");
  const [dueDate, setDueDate] = useState("");

  function saveNotes() {
    startTransition(async () => {
      const result = await updateFiscalControl({ clanId, controlId: row.id, monthlyNotes: notes });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Observação do mês atualizada.");
      router.refresh();
    });
  }

  function createMission() {
    startTransition(async () => {
      const result = await createFiscalExceptionMission({
        clanId,
        controlId: row.id,
        note: missionNote,
        dueDate: dueDate || undefined,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Missão de exceção criada.");
      setMissionNote("");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Detalhes de ${row.clientName}`}>
          <MessageSquareText aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{row.clientName} · {periodLabel}</DialogTitle>
          <DialogDescription>
            Snapshot da Ficha Fiscal v{row.profileVersion}. Forma de entrega: {row.profileSnapshot.deliveryChannel ?? "não definida"}.
          </DialogDescription>
        </DialogHeader>
        {row.profileSnapshot.permanentNotes ? (
          <div className="rounded-lg border bg-muted/30 p-3 text-xs whitespace-pre-wrap">
            <strong className="block text-foreground">Orientação permanente</strong>
            <span className="text-muted-foreground">{row.profileSnapshot.permanentNotes}</span>
          </div>
        ) : null}
        <div className="grid gap-1.5">
          <Label htmlFor={`${row.id}-monthly-note`}>Observação desta competência</Label>
          <Textarea
            id={`${row.id}-monthly-note`}
            value={notes}
            disabled={!row.canEdit}
            maxLength={3000}
            rows={3}
            onChange={(event) => setNotes(event.target.value)}
          />
          {row.canEdit ? (
            <Button type="button" variant="outline" size="sm" disabled={pending} onClick={saveNotes}>
              Salvar observação
            </Button>
          ) : null}
        </div>
        {row.canEdit ? (
          <section className="grid gap-3 border-t pt-3">
            <div>
              <h3 className="flex items-center gap-1.5 font-medium"><FileWarning className="size-4" aria-hidden /> Criar missão de exceção</h3>
              <p className="text-xs text-muted-foreground">Use apenas para bloqueio, atraso ou ação especial; as células do controle não viram missões.</p>
            </div>
            <Textarea value={missionNote} maxLength={2000} placeholder="O que precisa ser resolvido?" onChange={(event) => setMissionNote(event.target.value)} />
            <div className="grid gap-1.5">
              <Label htmlFor={`${row.id}-due`}>Prazo (opcional)</Label>
              <Input id={`${row.id}-due`} type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
            </div>
            <Button type="button" disabled={pending || !missionNote.trim()} onClick={createMission}>
              <Send aria-hidden /> Gerar missão
            </Button>
          </section>
        ) : null}
        {row.history.length > 0 ? (
          <section className="grid gap-2 border-t pt-3">
            <h3 className="text-sm font-medium">Auditoria recente</h3>
            <ul className="grid gap-1">
              {row.history.map((event) => (
                <li key={event.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/30 px-2.5 py-1.5 text-xs">
                  <span>{eventText(event)}</span>
                  <span className="text-muted-foreground">
                    {event.actorName} · {new Date(event.createdAt).toLocaleString("pt-BR")}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <DialogFooter>
          <span className="mr-auto text-xs text-muted-foreground">
            Última alteração: {new Date(row.updatedAt).toLocaleString("pt-BR")}
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FiscalControlBoard({
  clanId,
  year,
  month,
  canManage,
  members,
  rows,
}: {
  clanId: string;
  year: number;
  month: number;
  canManage: boolean;
  members: readonly { userId: string; name: string }[];
  rows: readonly FiscalControlRowView[];
}) {
  const router = useRouter();
  const [opening, startOpening] = useTransition();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [responsible, setResponsible] = useState("all");
  const [regime, setRegime] = useState("all");
  const previous = adjacentPeriod(year, month, -1);
  const next = adjacentPeriod(year, month, 1);
  const label = `${MONTHS[month - 1]} de ${year}`;

  const visible = useMemo(() => {
    const needle = normalize(query.trim());
    return rows.filter((row) => {
      if (needle && !normalize(row.clientName).includes(needle)) return false;
      if (status === "pending_work" && row.status === "completed") return false;
      if (status !== "all" && status !== "pending_work" && row.status !== status) return false;
      if (responsible === "unassigned" && row.responsibleUserId) return false;
      if (responsible !== "all" && responsible !== "unassigned" && row.responsibleUserId !== responsible) return false;
      if (regime !== "all" && row.taxRegime !== regime) return false;
      return true;
    });
  }, [query, regime, responsible, rows, status]);

  const completed = rows.filter((row) => row.status === "completed").length;
  const blocked = rows.filter((row) => row.status === "blocked").length;
  const byResponsible = members
    .map((member) => {
      const mine = rows.filter((row) => row.responsibleUserId === member.userId);
      return { ...member, total: mine.length, completed: mine.filter((row) => row.status === "completed").length };
    })
    .filter((item) => item.total > 0);

  function openPeriod() {
    startOpening(async () => {
      const result = await openFiscalControlPeriod({ clanId, periodYear: year, periodMonth: month });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const created = result.data?.created ?? 0;
      const synchronized = result.data?.synchronized ?? 0;
      toast.success(
        synchronized > 0
          ? `${created} empresa(s) adicionada(s) e ${synchronized} ficha(s) não iniciada(s) atualizada(s).`
          : `${created} empresa(s) adicionada(s) ao controle.`,
      );
      router.refresh();
    });
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-medium">Controle Fiscal · {label}</h2>
          <p className="text-sm text-muted-foreground">As atividades vêm da Ficha Fiscal. “Atualizar empresas” sincroniza somente linhas ainda não iniciadas; o andamento já iniciado permanece no histórico.</p>
        </div>
        <div className="flex items-center gap-1">
          <Button asChild type="button" variant="outline" size="icon-sm"><Link href={periodHref(clanId, previous.year, previous.month)} aria-label="Competência anterior"><ChevronLeft aria-hidden /></Link></Button>
          <Badge variant="outline" className="h-8 px-3">{String(month).padStart(2, "0")}/{year}</Badge>
          <Button asChild type="button" variant="outline" size="icon-sm"><Link href={periodHref(clanId, next.year, next.month)} aria-label="Próxima competência"><ChevronRight aria-hidden /></Link></Button>
          {canManage ? (
            <Button type="button" size="sm" disabled={opening} onClick={openPeriod}>
              {opening ? <LoaderCircle className="animate-spin" aria-hidden /> : <ClipboardCheck aria-hidden />}
              {rows.length > 0 ? "Atualizar empresas" : "Abrir competência"}
            </Button>
          ) : null}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="grid justify-items-center gap-2 rounded-lg border border-dashed p-10 text-center">
          <ClipboardCheck className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">Competência ainda não aberta</p>
          <p className="max-w-md text-sm text-muted-foreground">A liderança pode gerar uma linha para cada empresa ativa, sem criar dezenas de missões.</p>
        </div>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-lg bg-muted/40 p-3"><span className="text-xs text-muted-foreground">Progresso geral</span><strong className="block font-mono text-lg">{completed}/{rows.length}</strong></div>
            <div className="rounded-lg bg-muted/40 p-3"><span className="text-xs text-muted-foreground">Bloqueadas</span><strong className={cn("block font-mono text-lg", blocked > 0 && "text-destructive")}>{blocked}</strong></div>
            <div className="rounded-lg bg-muted/40 p-3"><span className="text-xs text-muted-foreground">Sem responsável</span><strong className="block font-mono text-lg">{rows.filter((row) => !row.responsibleUserId).length}</strong></div>
          </div>

          {byResponsible.length > 0 ? (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {byResponsible.map((item) => (
                <button key={item.userId} type="button" onClick={() => setResponsible(item.userId)} className="shrink-0 rounded-lg border bg-card/50 px-3 py-2 text-left text-xs hover:bg-muted/50">
                  <span className="block font-medium">{item.name}</span>
                  <span className="font-mono text-muted-foreground">{item.completed}/{item.total}</span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="grid gap-2 md:grid-cols-[minmax(12rem,1fr)_11rem_12rem_11rem]">
            <div className="relative"><Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar empresa" className="pl-9" /></div>
            <Select value={status} onValueChange={setStatus}><SelectTrigger className="w-full"><SelectValue placeholder="Situação" /></SelectTrigger><SelectContent><SelectItem value="all">Todas as situações</SelectItem><SelectItem value="pending_work">Com pendência</SelectItem>{Object.entries(STATUS_LABELS).map(([value, text]) => <SelectItem key={value} value={value}>{text}</SelectItem>)}</SelectContent></Select>
            <Select value={responsible} onValueChange={setResponsible}><SelectTrigger className="w-full"><SelectValue placeholder="Responsável" /></SelectTrigger><SelectContent><SelectItem value="all">Todas as pessoas</SelectItem><SelectItem value="unassigned">Sem responsável</SelectItem>{members.map((member) => <SelectItem key={member.userId} value={member.userId}>{member.name}</SelectItem>)}</SelectContent></Select>
            <Select value={regime} onValueChange={setRegime}><SelectTrigger className="w-full"><SelectValue placeholder="Regime" /></SelectTrigger><SelectContent><SelectItem value="all">Todos os regimes</SelectItem>{Object.entries(TAX_REGIME_LABELS).map(([value, text]) => <SelectItem key={value} value={value}>{text}</SelectItem>)}</SelectContent></Select>
          </div>

          <Table>
            <TableHeader><TableRow><TableHead className="min-w-56">Empresa</TableHead><TableHead>Responsável</TableHead><TableHead className="min-w-72">Atividades do período</TableHead><TableHead>Situação</TableHead><TableHead><span className="sr-only">Detalhes</span></TableHead></TableRow></TableHeader>
            <TableBody>
              {visible.map((row) => (
                <TableRow key={row.id} className={cn(row.status === "blocked" && "bg-destructive/5")}>
                  <TableCell><span className="block max-w-64 truncate font-medium">{row.clientName}</span><span className="text-[11px] text-muted-foreground">{TAX_REGIME_LABELS[row.taxRegime]} · ficha v{row.profileVersion}</span></TableCell>
                  <TableCell>{row.responsibleName ?? <span className="text-destructive">Sem responsável</span>}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      {STAGES.filter((stage) => row[stage.field] !== "not_applicable").map((stage) => (
                        <div key={stage.key} className="inline-flex items-center gap-1.5 rounded-md border bg-card/50 px-1.5 py-1">
                          <span className="text-xs text-muted-foreground">{activityLabel(stage, row)}</span>
                          <StepButton clanId={clanId} controlId={row.id} stage={stage.key} status={row[stage.field]} disabled={!row.canEdit} />
                        </div>
                      ))}
                      {STAGES.every((stage) => row[stage.field] === "not_applicable") ? <span className="text-xs text-muted-foreground">Sem atividade fiscal nesta competência.</span> : null}
                    </div>
                  </TableCell>
                  <TableCell><Badge variant={row.status === "completed" ? "secondary" : row.status === "blocked" ? "destructive" : "outline"}>{STATUS_LABELS[row.status]}</Badge></TableCell>
                  <TableCell><ControlDetailsDialog clanId={clanId} row={row} periodLabel={label} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {visible.length === 0 ? <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhuma empresa corresponde aos filtros.</p> : null}
        </>
      )}
    </div>
  );
}
