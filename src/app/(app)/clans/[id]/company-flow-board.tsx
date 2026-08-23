"use client";

import {
  Building2,
  CheckCircle2,
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
  COMPANY_FLOW_CLOSURE_MODE_LABELS,
  COMPANY_FLOW_KIND_LABELS,
  COMPANY_FLOW_STATUS_LABELS,
  type CompanyFlowClosureMode,
  type CompanyFlowKind,
  type CompanyFlowSource,
  type CompanyFlowStatus,
  type FlowActivity,
  type FlowQsaMember,
} from "@/domain/company-flow";
import { formatCnpj } from "@/domain/cnpj";
import { TAX_REGIME_LABELS, TAX_REGIMES, type TaxRegime } from "@/lib/clients-ui";
import { formatBRLCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

import {
  cancelCompanyFlow,
  claimCompanyFlow,
  createCompanyFlow,
  deleteCompanyFlow,
  lookupCompanyFlowCnpj,
  prepareCompanyFlowInformative,
  returnCompanyFlowToOwner,
  revealCompanyFlowGovPassword,
} from "./company-flow-actions";

export interface CompanyFlowView {
  id: string;
  kind: CompanyFlowKind;
  closureMode: CompanyFlowClosureMode;
  closureResponsibilityUntil: string | null;
  status: CompanyFlowStatus;
  source: CompanyFlowSource;
  existingClientId: string | null;
  existingClientName: string | null;
  requestedLegalName: string | null;
  requestedActivities: FlowActivity[];
  removedActivities: FlowActivity[];
  taxRegime: TaxRegime | null;
  iptu: string | null;
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
  approvedTaxRegime: TaxRegime | null;
  approvedAddress: string | null;
  approvedQsa: FlowQsaMember[];
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
  canDelete: boolean;
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
  showChangeType = false,
}: {
  value: FlowQsaMember[];
  onChange: (value: FlowQsaMember[]) => void;
  showChangeType?: boolean;
}) {
  function change(index: number, field: keyof FlowQsaMember, next: string) {
    onChange(value.map((member, current) => current === index ? { ...member, [field]: next } : member));
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label>{showChangeType ? "Alterações no QSA" : "QSA"}</Label>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...value, { name: "", changeType: showChangeType ? "entered" : null }])}>
          <Plus aria-hidden /> Adicionar sócio
        </Button>
      </div>
      {value.length === 0 ? <p className="text-xs text-muted-foreground">{showChangeType ? "Registre entradas, saídas ou mudanças de participação." : "Inclua os integrantes do quadro societário."}</p> : null}
      {value.map((member, index) => (
        <div key={index} className="grid gap-2 rounded-md border bg-muted/20 p-2 sm:grid-cols-2">
          {showChangeType ? <Select value={member.changeType ?? "entered"} onValueChange={(value) => change(index, "changeType", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="entered">Entrou no QSA</SelectItem><SelectItem value="left">Saiu do QSA</SelectItem><SelectItem value="updated">Participação / dados alterados</SelectItem></SelectContent></Select> : null}
          <Input value={member.name} onChange={(event) => change(index, "name", event.target.value)} placeholder="Nome / razão social" />
          <Input value={member.document ?? ""} onChange={(event) => change(index, "document", event.target.value)} placeholder="CPF ou CNPJ (opcional)" />
          <Input value={member.qualification ?? ""} onChange={(event) => change(index, "qualification", event.target.value)} placeholder="Qualificação" />
          <div className="flex gap-2 sm:col-span-2">
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
  const officialLegalName = row.approvedLegalName ?? row.existingClientName;
  const taxRegime = row.approvedTaxRegime ?? row.taxRegime;
  const address = row.approvedAddress ?? row.address;
  const qsa = row.approvedQsa.length > 0 ? row.approvedQsa : row.qsa;
  const requestedNameDiffers = Boolean(
    row.approvedLegalName &&
    row.requestedLegalName &&
    row.approvedLegalName.localeCompare(row.requestedLegalName, "pt-BR", {
      sensitivity: "base",
    }) !== 0,
  );

  return (
    <section className="grid gap-2 rounded-md border bg-muted/20 p-3">
      <p className="hud-label">Solicitação do cliente</p>
      <p><strong>{row.approvedLegalName ? "Razão social oficial:" : "Razão social:"}</strong> {officialLegalName ?? row.requestedLegalName ?? "—"}</p>
      {row.kind === "closure" ? <p><strong>Modalidade:</strong> {COMPANY_FLOW_CLOSURE_MODE_LABELS[row.closureMode]}</p> : null}
      {row.kind === "closure" && row.closureResponsibilityUntil ? <p><strong>Responsabilidade até:</strong> {new Date(`${row.closureResponsibilityUntil}T12:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC" })}</p> : null}
      {row.kind === "amendment" && row.requestedLegalName ? <p><strong>Nova razão social:</strong> {row.requestedLegalName}</p> : null}
      {requestedNameDiffers ? (
        <p className="text-xs text-muted-foreground">
          <strong>Nome solicitado inicialmente:</strong> {row.requestedLegalName}
        </p>
      ) : null}
      {row.requestedActivities.length > 0 ? <p><strong>{row.kind === "amendment" ? "Atividades a incluir:" : "Atividades:"}</strong> {row.requestedActivities.map((activity) => activity.description).join("; ")}</p> : null}
      {row.removedActivities.length > 0 ? <p><strong>Atividades a retirar:</strong> {row.removedActivities.map((activity) => activity.description).join("; ")}</p> : null}
      {taxRegime ? <p><strong>{row.kind === "amendment" ? "Novo regime tributário:" : "Regime tributário:"}</strong> {TAX_REGIME_LABELS[taxRegime]}</p> : null}
      {row.iptu ? <p><strong>IPTU:</strong> {row.iptu}</p> : null}
      {row.socialCapital ? <p><strong>{row.kind === "amendment" ? "Novo capital social:" : "Capital social:"}</strong> {formatBRLCurrency(row.socialCapital)}</p> : null}
      {row.roomSize ? <p><strong>Tamanho da sala:</strong> {row.roomSize}</p> : null}
      {address ? <p className="whitespace-pre-wrap"><strong>{row.kind === "amendment" ? "Novo endereço:" : "Endereço:"}</strong> {address}</p> : null}
      {row.clientResponsible ? <p><strong>Responsável:</strong> {row.clientResponsible}</p> : null}
      {qsa.length > 0 ? (
        <div>
          <strong>{row.approvedQsa.length > 0 ? "QSA atualizado:" : "QSA:"}</strong>
          <ul className="mt-1 grid gap-1 pl-4">
            {qsa.map((member, index) => (
              <li key={`${member.name}-${index}`} className="list-disc">
                {[member.changeType === "entered" ? "Entrada" : member.changeType === "left" ? "Saída" : member.changeType === "updated" ? "Atualização" : null, member.name, member.document && `CPF/CNPJ: ${member.document}`, member.qualification, member.participation].filter(Boolean).join(" — ")}
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
  const [closureMode, setClosureMode] = useState<CompanyFlowClosureMode>("company_closure");
  const [closureResponsibilityUntil, setClosureResponsibilityUntil] = useState("");
  const [existingClientId, setExistingClientId] = useState("");
  const [companySearch, setCompanySearch] = useState("");
  const [companyPickerOpen, setCompanyPickerOpen] = useState(false);
  const [legalName, setLegalName] = useState("");
  const [activities, setActivities] = useState("");
  const [removedActivities, setRemovedActivities] = useState("");
  const [taxRegime, setTaxRegime] = useState<TaxRegime | "">("");
  const [iptu, setIptu] = useState("");
  const [socialCapital, setSocialCapital] = useState("");
  const [roomSize, setRoomSize] = useState("");
  const [address, setAddress] = useState("");
  const [qsa, setQsa] = useState<FlowQsaMember[]>([]);
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [details, setDetails] = useState("");
  const [govPassword, setGovPassword] = useState("");

  const matchingClients = useMemo(() => {
    const query = companySearch.trim().toLocaleLowerCase("pt-BR");
    if (!query) return clients.slice(0, 12);
    return clients
      .filter((client) => client.name.toLocaleLowerCase("pt-BR").includes(query))
      .slice(0, 12);
  }, [clients, companySearch]);

  const detailLabel = kind === "opening"
    ? "Detalhes da solicitação"
    : kind === "amendment"
      ? "Qual alteração deve ser feita?"
      : "Dados da baixa";
  const detailPlaceholder = kind === "amendment"
    ? "Descreva a alteração solicitada pelo cliente"
    : kind === "closure"
      ? "Descreva os dados e o motivo da baixa"
      : "Descreva o pedido recebido do cliente";

  function submit() {
    startTransition(async () => {
      const result = await createCompanyFlow({
        clanId,
        kind,
        closureMode,
        closureResponsibilityUntil: closureResponsibilityUntil || null,
        source: "written",
        existingClientId: kind === "opening" ? null : existingClientId || null,
        requestedLegalName: legalName,
        requestedActivities: splitActivities(activities),
        removedActivities: splitActivities(removedActivities),
        taxRegime: taxRegime || null,
        iptu,
        socialCapital,
        roomSize,
        address,
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
  const closing = kind === "closure";
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
            {opening ? null : (
              <div className="grid gap-1.5">
                <Label htmlFor="company-search">Empresa {kind === "amendment" ? "que será alterada" : "que será baixada"}</Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                  <Input
                    id="company-search"
                    className="pl-9"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-controls="company-search-results"
                    aria-expanded={companyPickerOpen}
                    value={companySearch}
                    onChange={(event) => {
                      setCompanySearch(event.target.value);
                      setExistingClientId("");
                      setCompanyPickerOpen(true);
                    }}
                    onFocus={() => setCompanyPickerOpen(true)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setCompanyPickerOpen(false);
                    }}
                    placeholder="Pesquise pelo nome da empresa"
                  />
                  {companyPickerOpen ? (
                    <div id="company-search-results" role="listbox" className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
                      {matchingClients.length > 0 ? matchingClients.map((client) => (
                        <button
                          key={client.id}
                          type="button"
                          role="option"
                          aria-selected={client.id === existingClientId}
                          className="flex w-full rounded-sm px-2 py-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground"
                          onClick={() => {
                            setExistingClientId(client.id);
                            setCompanySearch(client.name);
                            setCompanyPickerOpen(false);
                          }}
                        >
                          {client.name}
                        </button>
                      )) : <p className="px-2 py-2 text-sm text-muted-foreground">Nenhuma empresa encontrada.</p>}
                    </div>
                  ) : null}
                </div>
              </div>
            )}
            {opening ? <div className="grid gap-1.5"><Label>Regime tributário *</Label><Select value={taxRegime || undefined} onValueChange={(value) => setTaxRegime(value as TaxRegime)}><SelectTrigger><SelectValue placeholder="Selecione o regime" /></SelectTrigger><SelectContent>{TAX_REGIMES.map((value) => <SelectItem key={value} value={value}>{TAX_REGIME_LABELS[value]}</SelectItem>)}</SelectContent></Select></div> : null}
            {opening ? <div className="grid gap-1.5"><Label>IPTU</Label><Input value={iptu} onChange={(event) => setIptu(event.target.value)} placeholder="Inscrição ou referência do IPTU" /></div> : null}
          </div>

          {closing ? <section className="grid gap-3 rounded-md border bg-muted/20 p-3"><div className="grid gap-1.5"><Label>Modalidade da baixa</Label><Select value={closureMode} onValueChange={(value) => setClosureMode(value as CompanyFlowClosureMode)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="company_closure">Baixa definitiva da empresa</SelectItem><SelectItem value="accountant_change">Desligamento / alteração de contador</SelectItem></SelectContent></Select></div>{closureMode === "accountant_change" ? <div className="grid gap-1.5"><Label>Responsabilidade do escritório até *</Label><Input type="date" value={closureResponsibilityUntil} onChange={(event) => setClosureResponsibilityUntil(event.target.value)} /></div> : null}</section> : null}

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
          ) : null}

          {kind === "amendment" ? (
            <section className="grid gap-4 rounded-md border bg-muted/20 p-3">
              <div><h3 className="font-medium">Dados a alterar</h3><p className="text-xs text-muted-foreground">Preencha apenas os itens que mudarão na empresa.</p></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5"><Label>Nova razão social</Label><Input value={legalName} onChange={(event) => setLegalName(event.target.value)} placeholder="Preencha se a razão social mudar" /></div>
                <div className="grid gap-1.5"><Label>Novo regime tributário</Label><Select value={taxRegime || "unchanged"} onValueChange={(value) => setTaxRegime(value === "unchanged" ? "" : value as TaxRegime)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unchanged">Sem alteração</SelectItem>{TAX_REGIMES.map((value) => <SelectItem key={value} value={value}>{TAX_REGIME_LABELS[value]}</SelectItem>)}</SelectContent></Select></div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5"><Label>Atividades a adicionar</Label><Textarea value={activities} onChange={(event) => setActivities(event.target.value)} rows={3} placeholder="Uma atividade por linha" /></div>
                <div className="grid gap-1.5"><Label>Atividades a retirar</Label><Textarea value={removedActivities} onChange={(event) => setRemovedActivities(event.target.value)} rows={3} placeholder="Uma atividade por linha" /></div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5"><Label>Novo endereço</Label><Textarea value={address} onChange={(event) => setAddress(event.target.value)} rows={3} placeholder="Rua, número, complemento, bairro, cidade/UF e CEP" /></div>
                <div className="grid gap-1.5"><Label>IPTU do novo endereço</Label><Input value={iptu} onChange={(event) => setIptu(event.target.value)} placeholder="Inscrição ou referência do IPTU" /></div>
              </div>
              <div className="grid gap-1.5"><Label>Novo capital social</Label><CurrencyInput value={socialCapital} onValueChange={setSocialCapital} placeholder="R$ 0,00" /></div>
              <QsaFields value={qsa} onChange={setQsa} showChangeType />
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5"><Label>Contato</Label><Input value={contactName} onChange={(event) => setContactName(event.target.value)} placeholder="Nome do contato" /></div>
                <div className="grid gap-1.5"><Label>Telefone</Label><Input value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} placeholder="(00) 00000-0000" /></div>
                <div className="grid gap-1.5 sm:col-span-2"><Label>E-mail</Label><Input type="email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} placeholder="contato@empresa.com" /></div>
              </div>
              <div className="grid gap-1.5"><Label>Observações</Label><Textarea value={details} onChange={(event) => setDetails(event.target.value)} rows={5} placeholder="Descreva informações, cuidados ou outras alterações solicitadas" /></div>
            </section>
          ) : null}

          {opening ? <><div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5"><Label>Contato</Label><Input value={contactName} onChange={(event) => setContactName(event.target.value)} placeholder="Nome do contato" /></div>
            <div className="grid gap-1.5"><Label>Telefone</Label><Input value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} placeholder="(00) 00000-0000" /></div>
            <div className="grid gap-1.5"><Label>E-mail</Label><Input type="email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} placeholder="contato@empresa.com" /></div>
          </div>
          <div className="grid gap-1.5"><Label>{detailLabel}</Label><Textarea value={details} onChange={(event) => setDetails(event.target.value)} rows={4} placeholder={detailPlaceholder} /></div></> : null}
          {closing ? <div className="grid gap-1.5"><Label>Observações da baixa</Label><Textarea value={details} onChange={(event) => setDetails(event.target.value)} rows={6} placeholder="Descreva a data da baixa, cobrança, recibo e demais observações" /></div> : null}
          {closing ? null : <div className="grid gap-1.5 rounded-md border border-primary/30 bg-primary/5 p-3"><Label htmlFor="gov-password" className="flex items-center gap-1.5"><ShieldCheck className="size-4" aria-hidden /> Senha Gov.br (opcional)</Label><Input id="gov-password" type="password" autoComplete="new-password" value={govPassword} onChange={(event) => setGovPassword(event.target.value)} placeholder="Fica cifrada e não entra no histórico" /><p className="text-xs text-muted-foreground">Somente o dono, o responsável societário e a liderança do Societário podem revelar esta senha.</p></div>}
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
  const amendment = row.kind === "amendment";
  const closure = row.kind === "closure";
  const simpleConfirmation = amendment || closure;
  const companyName = amendment
    ? row.existingClientName ?? row.approvedLegalName ?? row.requestedLegalName ?? "Empresa"
    : row.approvedLegalName ?? row.requestedLegalName ?? row.existingClientName ?? "Empresa";

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
      const result = await returnCompanyFlowToOwner({
        clanId,
        flowId: row.id,
        resultCnpj: simpleConfirmation ? undefined : cnpj,
        approvedLegalName: simpleConfirmation ? undefined : approvedName,
        approvedActivities: simpleConfirmation ? [] : splitActivities(approvedActivities),
        approvedTaxRegime: null,
        approvedAddress: "",
        approvedQsa: [],
        processingNotes: amendment ? "Alteração concluída pelo Societário." : closure ? "Baixa concluída pelo Societário." : notes,
      });
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
  function remove() {
    if (!window.confirm("Excluir definitivamente este Fluxo? A solicitação, o histórico e a senha Gov.br serão apagados. Esta ação não pode ser desfeita.")) return;
    startTransition(async () => {
      const result = await deleteCompanyFlow({ clanId, flowId: row.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Fluxo excluído definitivamente.");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button type="button" variant="outline" size="sm">Abrir</Button></DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader><DialogTitle>{COMPANY_FLOW_KIND_LABELS[row.kind]} · {companyName}</DialogTitle><DialogDescription>Criado por {row.createdByName} em {new Date(row.createdAt).toLocaleString("pt-BR")}</DialogDescription></DialogHeader>
        <div className="grid gap-4 text-sm">
          <div className="flex flex-wrap gap-2"><Badge variant="outline" className={STATUS_CLASS[row.status]}>{COMPANY_FLOW_STATUS_LABELS[row.status]}</Badge><Badge variant="outline">Origem: {FLOW_SOURCE_LABELS[row.source]}</Badge>{row.assignedName ? <Badge variant="outline">Societário: {row.assignedName}</Badge> : null}</div>
          <FlowRequestSummary row={row} />
          {row.hasGovSecret ? <section className="rounded-md border border-primary/30 bg-primary/5 p-3"><p className="flex items-center gap-1.5 font-medium"><KeyRound className="size-4" aria-hidden /> Acesso Gov.br protegido</p>{revealedSecret ? <p className="mt-2 rounded bg-background px-2 py-1 font-mono text-sm break-all">{revealedSecret}</p> : <Button type="button" className="mt-2" variant="outline" size="sm" disabled={pending || !row.canReturn} onClick={revealSecret}><Eye aria-hidden /> Revelar senha</Button>}</section> : null}
          {row.status === "in_progress" && row.canReturn ? (
            <section className="grid gap-3 border-t pt-4">
              <div>
                <h3 className="font-medium">{amendment ? "Confirmação da alteração" : closure ? "Confirmação da baixa" : "Retorno do Societário"}</h3>
                <p className="text-xs text-muted-foreground">{simpleConfirmation ? "Confirme quando o processo estiver concluído. O dono seguirá para o Informativo." : "Registre os dados aprovados antes de devolver ao dono."}</p>
              </div>
              {simpleConfirmation ? (
                <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">{amendment ? "Todos os dados da solicitação já foram revisados nesta ficha. Esta confirmação registra que a alteração foi concluída pelo Societário." : "Esta confirmação registra que a baixa foi concluída pelo Societário."}</div>
              ) : (
                <>
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto]"><div className="grid gap-1.5"><Label>CNPJ aprovado</Label><Input value={cnpj} onChange={(event) => setCnpj(event.target.value)} placeholder="00.000.000/0000-00" inputMode="numeric" /></div><Button type="button" className="self-end" variant="outline" disabled={pending || !cnpj.trim()} onClick={lookupCnpj}><Search aria-hidden /> Consultar CNPJ</Button></div>
                  <div className="grid gap-1.5"><Label>Razão social oficial (Receita)</Label><Input value={approvedName} readOnly placeholder="Consulte o CNPJ para preencher" /><p className="text-xs text-muted-foreground">Este nome é conferido novamente pelo CNPJ ao devolver o Fluxo.</p></div>
                  <div className="grid gap-1.5"><Label>Atividades aprovadas</Label><Textarea value={approvedActivities} onChange={(event) => setApprovedActivities(event.target.value)} rows={3} placeholder="Uma atividade por linha" /></div>
                </>
              )}
              {simpleConfirmation ? null : <div className="grid gap-1.5"><Label>Retorno e observações</Label><Textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} placeholder="O que foi deferido, pendências ou cuidados" /></div>}
              <Button type="button" disabled={pending || (!simpleConfirmation && !notes.trim())} onClick={returnToOwner}><Send aria-hidden /> {amendment ? "Confirmar alteração e devolver ao dono" : closure ? "Confirmar baixa e devolver ao dono" : "Devolver ao dono"}</Button>
            </section>
          ) : null}
          {["awaiting_owner", "informative_drafting"].includes(row.status) && row.canPrepareInformative ? <section className="grid gap-2 border-t pt-4"><h3 className="font-medium">Próximo passo</h3><p className="text-xs text-muted-foreground">O texto será pré-preenchido com o retorno aprovado; o dono completa as ações de Fiscal, Contabilidade e RH antes de confirmar.</p><Button type="button" disabled={pending} onClick={prepareInformative}><ClipboardPenLine aria-hidden /> {row.status === "informative_drafting" ? "Gerar Informativo novamente" : "Preparar Informativo"}</Button></section> : null}
          {row.status === "informative_drafting" ? <p className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">A preparação do Informativo está aberta. Você pode gerar o texto novamente até criar a prévia em Informativos.</p> : null}
          {row.status === "sent_to_corporate" && row.canClaim ? <Button type="button" disabled={pending} onClick={claim}><UserRoundCheck aria-hidden /> Assumir processamento</Button> : null}
          {row.status === "completed" ? <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-300"><CheckCircle2 className="mr-1 inline size-4" aria-hidden /> Informativo gerado e Fluxo concluído. A confirmação das missões segue em Informativos.</div> : null}
          {row.history.length > 0 ? <section className="grid gap-2 border-t pt-4"><h3 className="font-medium">Histórico</h3>{row.history.map((event) => <div key={event.id} className="rounded-md bg-muted/35 px-3 py-2 text-xs"><span className="font-medium">{eventLabel(event.eventType)}</span><span className="text-muted-foreground"> · {event.actorName} · {new Date(event.createdAt).toLocaleString("pt-BR")}</span>{event.note ? <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{event.note}</p> : null}</div>)}</section> : null}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <p className="mr-auto text-xs text-muted-foreground">Cancelar preserva o histórico; excluir remove o Fluxo definitivamente.</p>
          {row.canCancel ? <Button type="button" variant="outline" disabled={pending || row.status === "completed" || row.status === "cancelled"} onClick={cancel}>Cancelar fluxo</Button> : null}
          {row.canDelete ? <Button type="button" variant="destructive" disabled={pending} onClick={remove}>Excluir definitivamente</Button> : null}
        </DialogFooter>
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
