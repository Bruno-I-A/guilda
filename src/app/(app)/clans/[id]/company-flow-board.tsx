"use client";

import {
  Building2,
  CheckCircle2,
  CircleUserRound,
  ClipboardPenLine,
  Eye,
  KeyRound,
  LoaderCircle,
  Plus,
  Search,
  Send,
  ShieldCheck,
  UserRoundCheck,
  XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
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
import { Textarea } from "@/components/ui/textarea";
import {
  COMPANY_FLOW_KIND_LABELS,
  COMPANY_FLOW_STATUS_LABELS,
  type CompanyFlowKind,
  type CompanyFlowSource,
  type CompanyFlowStatus,
  type FlowActivity,
  type FlowQsaMember,
} from "@/domain/company-flow";
import { formatCnpj } from "@/domain/cnpj";
import { formatBRLCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

import {
  cancelCompanyFlow,
  claimCompanyFlow,
  createCompanyFlow,
  lookupCompanyFlowCnpj,
  prepareCompanyFlowInformative,
  returnCompanyFlowToOwner,
  revealCompanyFlowGovPassword,
} from "./company-flow-actions";

export interface CompanyFlowView {
  id: string;
  kind: CompanyFlowKind;
  status: CompanyFlowStatus;
  source: CompanyFlowSource;
  existingClientId: string | null;
  existingClientName: string | null;
  requestedLegalName: string | null;
  requestedActivities: FlowActivity[];
  socialCapital: string | null;
  roomSize: string | null;
  address: string | null;
  clientResponsible: string | null;
  qsa: FlowQsaMember[];
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  requestDetails: string | null;
  assignedTo: string | null;
  assignedName: string | null;
  resultCnpj: string | null;
  approvedLegalName: string | null;
  approvedActivities: FlowActivity[];
  processingNotes: string | null;
  informativeId: string | null;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  returnedAt: string | null;
  completedAt: string | null;
  hasGovSecret: boolean;
  canClaim: boolean;
  canReturn: boolean;
  canPrepareInformative: boolean;
  canCancel: boolean;
  history: readonly {
    id: string;
    eventType: string;
    actorName: string;
    note: string | null;
    createdAt: string;
  }[];
}

const FLOW_SOURCE_LABELS: Record<CompanyFlowSource, string> = {
  written: "Escrito",
  whatsapp: "WhatsApp",
  phone: "Telefone",
  other: "Outro",
};

const STATUS_CLASS: Record<CompanyFlowStatus, string> = {
  sent_to_corporate: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  in_progress: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  awaiting_owner: "border-violet-500/40 bg-violet-500/10 text-violet-300",
  informative_drafting: "border-primary/40 bg-primary/10 text-primary",
  completed: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  cancelled: "border-muted-foreground/30 text-muted-foreground",
};

function splitActivities(value: string): FlowActivity[] {
  return value
    .split("\n")
    .map((description) => description.trim())
    .filter(Boolean)
    .map((description) => ({ description }));
}

function eventLabel(eventType: string): string {
  const labels: Record<string, string> = {
    created: "Fluxo enviado ao Societário",
    claimed: "Fluxo assumido",
    assigned: "Responsável alterado",
    returned_to_owner: "Devolvido ao dono",
    informative_prepared: "Informativo preparado",
    informative_cancelled: "Prévia de informativo cancelada",
    informative_confirmed: "Informativo confirmado",
    cancelled: "Fluxo cancelado",
  };
  return labels[eventType] ?? "Fluxo atualizado";
}

function QsaFields({
  value,
  onChange,
}: {
  value: FlowQsaMember[];
  onChange: (value: FlowQsaMember[]) => void;
}) {
  function change(index: number, field: keyof FlowQsaMember, next: string) {
    onChange(value.map((member, current) => current === index ? { ...member, [field]: next } : member));
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label>QSA</Label>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...value, { name: "" }])}>
          <Plus aria-hidden /> Adicionar sócio
        </Button>
      </div>
      {value.length === 0 ? <p className="text-xs text-muted-foreground">Inclua os integrantes do quadro societário.</p> : null}
      {value.map((member, index) => (
        <div key={index} className="grid gap-2 rounded-md border bg-muted/20 p-2 sm:grid-cols-2">
          <Input value={member.name} onChange={(event) => change(index, "name", event.target.value)} placeholder="Nome / razão social" />
          <Input value={member.document ?? ""} onChange={(event) => change(index, "document", event.target.value)} placeholder="CPF ou CNPJ (opcional)" />
          <Input value={member.qualification ?? ""} onChange={(event) => change(index, "qualification", event.target.value)} placeholder="Qualificação" />
          <div className="flex gap-2">
            <Input value={member.participation ?? ""} onChange={(event) => change(index, "participation", event.target.value)} placeholder="Participação" />
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Remover sócio" onClick={() => onChange(value.filter((_, current) => current !== index))}>
              <XCircle aria-hidden />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function FlowRequestSummary({ row }: { row: CompanyFlowView }) {
  return (
    <section className="grid gap-2 rounded-md border bg-muted/20 p-3">
      <p className="hud-label">Solicitação do cliente</p>
      <p><strong>Razão social:</strong> {row.requestedLegalName ?? row.existingClientName ?? "—"}</p>
      {row.requestedActivities.length > 0 ? <p><strong>Atividades:</strong> {row.requestedActivities.map((activity) => activity.description).join("; ")}</p> : null}
      {row.socialCapital ? <p><strong>Capital social:</strong> {formatBRLCurrency(row.socialCapital)}</p> : null}
      {row.roomSize ? <p><strong>Tamanho da sala:</strong> {row.roomSize}</p> : null}
      {row.address ? <p className="whitespace-pre-wrap"><strong>Endereço:</strong> {row.address}</p> : null}
      {row.clientResponsible ? <p><strong>Responsável:</strong> {row.clientResponsible}</p> : null}
      {row.qsa.length > 0 ? (
        <div>
          <strong>QSA:</strong>
          <ul className="mt-1 grid gap-1 pl-4">
            {row.qsa.map((member, index) => (
              <li key={`${member.name}-${index}`} className="list-disc">
                {[member.name, member.document && `CPF/CNPJ: ${member.document}`, member.qualification, member.participation].filter(Boolean).join(" — ")}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {[row.contactName, row.contactPhone, row.contactEmail].filter(Boolean).length > 0 ? <p><strong>Contato:</strong> {[row.contactName, row.contactPhone, row.contactEmail].filter(Boolean).join(" · ")}</p> : null}
      {row.requestDetails ? <p className="whitespace-pre-wrap"><strong>Detalhes:</strong> {row.requestDetails}</p> : null}
    </section>
  );
}

function NewCompanyFlowDialog({
  clanId,
  clients,
}: {
  clanId: string;
  clients: readonly { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<CompanyFlowKind>("opening");
  const [source, setSource] = useState<CompanyFlowSource>("whatsapp");
  const [existingClientId, setExistingClientId] = useState("");
  const [legalName, setLegalName] = useState("");
  const [activities, setActivities] = useState("");
  const [socialCapital, setSocialCapital] = useState("");
  const [roomSize, setRoomSize] = useState("");
  const [address, setAddress] = useState("");
  const [clientResponsible, setClientResponsible] = useState("");
  const [qsa, setQsa] = useState<FlowQsaMember[]>([]);
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [details, setDetails] = useState("");
  const [govPassword, setGovPassword] = useState("");

  function submit() {
    startTransition(async () => {
      const result = await createCompanyFlow({
        clanId,
        kind,
        source,
        existingClientId: kind === "opening" ? null : existingClientId || null,
        requestedLegalName: legalName,
        requestedActivities: splitActivities(activities),
        socialCapital,
        roomSize,
        address,
        clientResponsible,
        qsa,
        contactName,
        contactPhone,
        contactEmail,
        requestDetails: details,
        govPassword: govPassword || undefined,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Fluxo enviado ao Societário.");
      setOpen(false);
      router.refresh();
    });
  }

  const opening = kind === "opening";
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button"><Plus aria-hidden /> Novo fluxo</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Novo Fluxo</DialogTitle>
          <DialogDescription>Registre o pedido do cliente. Ele será enviado ao Societário sem virar missão ou informativo ainda.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5"><Label>Tipo</Label><Select value={kind} onValueChange={(value) => setKind(value as CompanyFlowKind)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="opening">Abertura</SelectItem><SelectItem value="amendment">Alteração</SelectItem><SelectItem value="closure">Baixa</SelectItem></SelectContent></Select></div>
            <div className="grid gap-1.5"><Label>Como o pedido chegou</Label><Select value={source} onValueChange={(value) => setSource(value as CompanyFlowSource)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(FLOW_SOURCE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
          </div>

          {opening ? (
            <>
              <div className="grid gap-1.5"><Label>Razão social pretendida</Label><Input value={legalName} onChange={(event) => setLegalName(event.target.value)} placeholder="Nome pretendido da empresa" /></div>
              <div className="grid gap-1.5"><Label>Atividades</Label><Textarea value={activities} onChange={(event) => setActivities(event.target.value)} rows={3} placeholder="Uma atividade por linha" /></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5"><Label>Capital social</Label><CurrencyInput value={socialCapital} onValueChange={setSocialCapital} placeholder="R$ 0,00" /></div>
                <div className="grid gap-1.5"><Label>Tamanho da sala</Label><Input value={roomSize} onChange={(event) => setRoomSize(event.target.value)} placeholder="Ex.: 45 m²" /></div>
              </div>
              <div className="grid gap-1.5"><Label>Endereço</Label><Textarea value={address} onChange={(event) => setAddress(event.target.value)} rows={2} placeholder="Rua, número, complemento, bairro, cidade/UF e CEP" /></div>
              <QsaFields value={qsa} onChange={setQsa} />
            </>
          ) : (
            <div className="grid gap-1.5"><Label>Empresa</Label><Select value={existingClientId} onValueChange={setExistingClientId}><SelectTrigger><SelectValue placeholder="Escolha a empresa" /></SelectTrigger><SelectContent>{clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}</SelectContent></Select></div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5"><Label>Responsável do cliente</Label><Input value={clientResponsible} onChange={(event) => setClientResponsible(event.target.value)} placeholder="Nome do responsável" /></div>
            <div className="grid gap-1.5"><Label>Contato</Label><Input value={contactName} onChange={(event) => setContactName(event.target.value)} placeholder="Nome do contato" /></div>
            <div className="grid gap-1.5"><Label>Telefone</Label><Input value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} placeholder="(00) 00000-0000" /></div>
            <div className="grid gap-1.5"><Label>E-mail</Label><Input type="email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} placeholder="contato@empresa.com" /></div>
          </div>
          <div className="grid gap-1.5"><Label>{opening ? "Detalhes da solicitação" : "O que será alterado / dados da baixa"}</Label><Textarea value={details} onChange={(event) => setDetails(event.target.value)} rows={4} placeholder="Descreva o pedido recebido do cliente" /></div>
          <div className="grid gap-1.5 rounded-md border border-primary/30 bg-primary/5 p-3"><Label htmlFor="gov-password" className="flex items-center gap-1.5"><ShieldCheck className="size-4" aria-hidden /> Senha Gov.br (opcional)</Label><Input id="gov-password" type="password" autoComplete="new-password" value={govPassword} onChange={(event) => setGovPassword(event.target.value)} placeholder="Fica cifrada e não entra no histórico" /><p className="text-xs text-muted-foreground">Somente o dono, o responsável societário e a liderança do Societário podem revelar esta senha.</p></div>
        </div>
        <DialogFooter><Button type="button" disabled={pending} onClick={submit}>{pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Send aria-hidden />} Enviar ao Societário</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FlowDetailDialog({ clanId, row }: { clanId: string; row: CompanyFlowView }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [cnpj, setCnpj] = useState(row.resultCnpj ?? "");
  const [approvedName, setApprovedName] = useState(row.approvedLegalName ?? "");
  const [approvedActivities, setApprovedActivities] = useState(row.approvedActivities.map((activity) => activity.description).join("\n"));
  const [notes, setNotes] = useState(row.processingNotes ?? "");
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);

  function claim() {
    startTransition(async () => {
      const result = await claimCompanyFlow({ clanId, flowId: row.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Fluxo assumido.");
      router.refresh();
    });
  }
  function lookupCnpj() {
    startTransition(async () => {
      const result = await lookupCompanyFlowCnpj({ clanId, flowId: row.id, cnpj });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (!result.data) {
        toast.error("A consulta não retornou dados.");
        return;
      }
      setCnpj(result.data.cnpj);
      setApprovedName(result.data.legalName);
      setApprovedActivities(result.data.activities.map((activity) => activity.description).join("\n"));
      toast.success("Dados consultados na Receita. Revise antes de devolver.");
    });
  }
  function returnToOwner() {
    startTransition(async () => {
      const result = await returnCompanyFlowToOwner({ clanId, flowId: row.id, resultCnpj: cnpj, approvedLegalName: approvedName, approvedActivities: splitActivities(approvedActivities), processingNotes: notes });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Fluxo devolvido ao dono.");
      router.refresh();
    });
  }
  function revealSecret() {
    startTransition(async () => {
      const result = await revealCompanyFlowGovPassword({ clanId, flowId: row.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (!result.data) {
        toast.error("O cofre não retornou uma senha.");
        return;
      }
      setRevealedSecret(result.data.password);
    });
  }
  function prepareInformative() {
    startTransition(async () => {
      const result = await prepareCompanyFlowInformative({ clanId, flowId: row.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.push(`/informativos?flowId=${row.id}`);
    });
  }
  function cancel() {
    if (!window.confirm("Cancelar este Fluxo? O histórico será preservado.")) return;
    startTransition(async () => {
      const result = await cancelCompanyFlow({ clanId, flowId: row.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Fluxo cancelado.");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button type="button" variant="outline" size="sm">Abrir</Button></DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader><DialogTitle>{COMPANY_FLOW_KIND_LABELS[row.kind]} · {row.approvedLegalName ?? row.requestedLegalName ?? row.existingClientName ?? "Empresa"}</DialogTitle><DialogDescription>Criado por {row.createdByName} em {new Date(row.createdAt).toLocaleString("pt-BR")}</DialogDescription></DialogHeader>
        <div className="grid gap-4 text-sm">
          <div className="flex flex-wrap gap-2"><Badge variant="outline" className={STATUS_CLASS[row.status]}>{COMPANY_FLOW_STATUS_LABELS[row.status]}</Badge><Badge variant="outline">Origem: {FLOW_SOURCE_LABELS[row.source]}</Badge>{row.assignedName ? <Badge variant="outline">Societário: {row.assignedName}</Badge> : null}</div>
          <FlowRequestSummary row={row} />
          {row.hasGovSecret ? <section className="rounded-md border border-primary/30 bg-primary/5 p-3"><p className="flex items-center gap-1.5 font-medium"><KeyRound className="size-4" aria-hidden /> Acesso Gov.br protegido</p>{revealedSecret ? <p className="mt-2 rounded bg-background px-2 py-1 font-mono text-sm break-all">{revealedSecret}</p> : <Button type="button" className="mt-2" variant="outline" size="sm" disabled={pending || !row.canReturn} onClick={revealSecret}><Eye aria-hidden /> Revelar senha</Button>}</section> : null}
          {row.status === "in_progress" && row.canReturn ? <section className="grid gap-3 border-t pt-4"><div><h3 className="font-medium">Retorno do Societário</h3><p className="text-xs text-muted-foreground">Registre os dados aprovados antes de devolver ao dono.</p></div><div className="grid gap-2 sm:grid-cols-[1fr_auto]"><div className="grid gap-1.5"><Label>CNPJ aprovado</Label><Input value={cnpj} onChange={(event) => setCnpj(event.target.value)} placeholder="00.000.000/0000-00" inputMode="numeric" /></div><Button type="button" className="self-end" variant="outline" disabled={pending || !cnpj.trim()} onClick={lookupCnpj}><Search aria-hidden /> Consultar CNPJ</Button></div><div className="grid gap-1.5"><Label>Razão social aprovada</Label><Input value={approvedName} onChange={(event) => setApprovedName(event.target.value)} /></div><div className="grid gap-1.5"><Label>Atividades aprovadas</Label><Textarea value={approvedActivities} onChange={(event) => setApprovedActivities(event.target.value)} rows={3} placeholder="Uma atividade por linha" /></div><div className="grid gap-1.5"><Label>Retorno e observações</Label><Textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} placeholder="O que foi deferido, pendências ou cuidados" /></div><Button type="button" disabled={pending || !notes.trim()} onClick={returnToOwner}><Send aria-hidden /> Devolver ao dono</Button></section> : null}
          {row.status === "awaiting_owner" && row.canPrepareInformative ? <section className="grid gap-2 border-t pt-4"><h3 className="font-medium">Próximo passo</h3><p className="text-xs text-muted-foreground">O texto será pré-preenchido com o retorno aprovado; o dono completa as ações de Fiscal, Contabilidade e RH antes de confirmar.</p><Button type="button" disabled={pending} onClick={prepareInformative}><ClipboardPenLine aria-hidden /> Preparar Informativo</Button></section> : null}
          {row.status === "informative_drafting" ? <p className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">A prévia está em Informativos. Quando for confirmada, este Fluxo será concluído automaticamente.</p> : null}
          {row.status === "sent_to_corporate" && row.canClaim ? <Button type="button" disabled={pending} onClick={claim}><UserRoundCheck aria-hidden /> Assumir processamento</Button> : null}
          {row.status === "completed" ? <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-300"><CheckCircle2 className="mr-1 inline size-4" aria-hidden /> Informativo confirmado e Fluxo concluído.</div> : null}
          {row.history.length > 0 ? <section className="grid gap-2 border-t pt-4"><h3 className="font-medium">Histórico</h3>{row.history.map((event) => <div key={event.id} className="rounded-md bg-muted/35 px-3 py-2 text-xs"><span className="font-medium">{eventLabel(event.eventType)}</span><span className="text-muted-foreground"> · {event.actorName} · {new Date(event.createdAt).toLocaleString("pt-BR")}</span>{event.note ? <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{event.note}</p> : null}</div>)}</section> : null}
        </div>
        <DialogFooter>{row.canCancel ? <Button type="button" variant="destructive" disabled={pending || row.status === "completed" || row.status === "cancelled"} onClick={cancel}>Cancelar fluxo</Button> : null}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CompanyFlowBoard({
  clanId,
  canCreate,
  clients,
  rows,
}: {
  clanId: string;
  canCreate: boolean;
  clients: readonly { id: string; name: string }[];
  rows: readonly CompanyFlowView[];
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<CompanyFlowStatus | "all">("all");
  const visible = useMemo(() => rows.filter((row) => {
    const haystack = `${row.requestedLegalName ?? ""} ${row.approvedLegalName ?? ""} ${row.existingClientName ?? ""} ${row.resultCnpj ?? ""}`.toLocaleLowerCase("pt-BR");
    return (!query.trim() || haystack.includes(query.trim().toLocaleLowerCase("pt-BR"))) && (status === "all" || row.status === status);
  }), [query, rows, status]);
  const active = rows.filter((row) => !["completed", "cancelled"].includes(row.status)).length;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-heading text-lg font-medium">Fluxo Societário</h2><p className="text-sm text-muted-foreground">O pedido entra pelo dono, o Societário processa e devolve os dados oficiais para o Informativos.</p></div>{canCreate ? <NewCompanyFlowDialog clanId={clanId} clients={clients} /> : null}</div>
      <div className="grid gap-2 sm:grid-cols-3"><div className="rounded-lg bg-muted/40 p-3"><span className="text-xs text-muted-foreground">Em aberto</span><strong className="block font-mono text-lg">{active}</strong></div><div className="rounded-lg bg-muted/40 p-3"><span className="text-xs text-muted-foreground">No Societário</span><strong className="block font-mono text-lg">{rows.filter((row) => row.status === "in_progress").length}</strong></div><div className="rounded-lg bg-muted/40 p-3"><span className="text-xs text-muted-foreground">Aguardando dono</span><strong className="block font-mono text-lg">{rows.filter((row) => row.status === "awaiting_owner").length}</strong></div></div>
      <div className="grid gap-2 md:grid-cols-[minmax(12rem,1fr)_15rem]"><div className="relative"><Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden /><Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar empresa, razão social ou CNPJ" /></div><Select value={status} onValueChange={(value) => setStatus(value as CompanyFlowStatus | "all")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todas as situações</SelectItem>{Object.entries(COMPANY_FLOW_STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
      <div className="grid gap-3">{visible.map((row) => <article key={row.id} className={cn("panel-cut grid gap-3 rounded-lg border bg-card/50 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center", row.status === "cancelled" && "opacity-70")}><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{COMPANY_FLOW_KIND_LABELS[row.kind]}</Badge><Badge variant="outline" className={STATUS_CLASS[row.status]}>{COMPANY_FLOW_STATUS_LABELS[row.status]}</Badge></div><h3 className="mt-2 truncate font-medium">{row.approvedLegalName ?? row.requestedLegalName ?? row.existingClientName ?? "Empresa"}</h3><p className="mt-1 text-xs text-muted-foreground">{row.resultCnpj ? formatCnpj(row.resultCnpj) : FLOW_SOURCE_LABELS[row.source]} · {row.assignedName ? `Societário: ${row.assignedName}` : "Sem responsável societário"}</p>{row.processingNotes ? <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{row.processingNotes}</p> : null}</div><FlowDetailDialog clanId={clanId} row={row} /></article>)}{visible.length === 0 ? <div className="grid justify-items-center gap-2 rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground"><Building2 className="size-7" aria-hidden />Nenhum Fluxo encontrado.</div> : null}</div>
    </div>
  );
}
