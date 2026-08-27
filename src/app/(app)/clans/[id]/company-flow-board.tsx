"use client";

import {
  Archive,
  Check,
  CheckCircle2,
  Clock3,
  ClipboardPenLine,
  Eye,
  KeyRound,
  LoaderCircle,
  Plus,
  Search,
  Send,
  ShieldCheck,
  UserRoundCheck,
  Workflow,
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
  companyFlowRhVerificationState,
  formatQsaParticipation,
  parseQsaParticipation,
  qsaDistributionIsComplete,
  qsaFinalParticipationTotal,
  qsaMemberCapitalValue,
  type CompanyFlowKind,
  type CompanyFlowRhVerificationState,
  type CompanyFlowSource,
  type CompanyFlowStatus,
  type FlowActivity,
  type FlowQsaMember,
} from "@/domain/company-flow";
import { formatCnpj } from "@/domain/cnpj";
import type { TaskStatus } from "@/domain/task-state";
import { TAX_REGIME_LABELS, TAX_REGIMES, type TaxRegime } from "@/lib/clients-ui";
import { formatBRLCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

import {
  cancelCompanyFlow,
  claimCompanyFlow,
  createCompanyFlow,
  deleteCompanyFlow,
  lookupCompanyFlowClientCnpj,
  lookupCompanyFlowCnpj,
  prepareCompanyFlowInformative,
  returnCompanyFlowToOwner,
  revealCompanyFlowGovPassword,
  type CompanyFlowClientLookupView,
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
  billingAmount: string | null;
  billingDescription: string | null;
  rhVerificationTaskId: string | null;
  rhVerificationTaskStatus: TaskStatus | null;
  rhVerificationCompletedAt: string | null;
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
  in_progress: "border-warning/40 bg-warning/10 text-warning",
  awaiting_owner: "border-violet-500/40 bg-violet-500/10 text-violet-300",
  informative_drafting: "border-primary/40 bg-primary/10 text-primary",
  completed: "border-success/40 bg-success/10 text-success",
  cancelled: "border-muted-foreground/30 text-muted-foreground",
};

const OPEN_FLOW_STATUSES: readonly CompanyFlowStatus[] = [
  "sent_to_corporate",
  "in_progress",
  "awaiting_owner",
  "informative_drafting",
];

const HISTORY_FLOW_STATUSES: readonly CompanyFlowStatus[] = [
  "completed",
  "cancelled",
];

function RhVerificationBadge({
  state,
}: {
  state: CompanyFlowRhVerificationState;
}) {
  if (state === "not_required") return null;
  return state === "confirmed" ? (
    <Badge variant="outline" className="border-success/45 bg-success/10 text-success">
      <ShieldCheck aria-hidden /> Confirmado pelo RH
    </Badge>
  ) : (
    <Badge variant="outline" className="border-warning/50 bg-warning/10 text-warning">
      <Clock3 aria-hidden /> RH ainda não verificou
    </Badge>
  );
}

function getRhVerificationState(
  row: Pick<
    CompanyFlowView,
    "kind" | "status" | "rhVerificationTaskId" | "rhVerificationTaskStatus"
  >,
): CompanyFlowRhVerificationState {
  if (row.status === "cancelled") return "not_required";
  return companyFlowRhVerificationState({
    kind: row.kind,
    taskId: row.rhVerificationTaskId,
    taskStatus: row.rhVerificationTaskStatus,
  });
}

function flowStageDescription(row: CompanyFlowView): string {
  switch (row.status) {
    case "sent_to_corporate":
      return "Aguardando o Societário assumir";
    case "in_progress":
      return row.assignedName
        ? `Em processamento por ${row.assignedName}`
        : "Em processamento no Societário";
    case "awaiting_owner":
      return row.kind === "amendment"
        ? "Alteração confirmada; Informativo pendente"
        : "Processo confirmado; Informativo pendente";
    case "informative_drafting":
      return "Informativo em preparação";
    case "completed":
      return row.completedAt
        ? `Concluído em ${new Date(row.completedAt).toLocaleDateString("pt-BR")}`
        : "Fluxo concluído";
    case "cancelled":
      return "Fluxo cancelado";
  }
}

function splitActivities(value: string): FlowActivity[] {
  return value
    .split("\n")
    .map((description) => description.trim())
    .filter(Boolean)
    .map((description) => ({ description }));
}

function formatLookupDate(value: string | null): string | null {
  if (!value) return null;
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("pt-BR", {
    timeZone: "UTC",
  });
}

type AmendmentField =
  | "legalName"
  | "taxRegime"
  | "activities"
  | "address"
  | "ownership"
  | "contact";

const AMENDMENT_FIELDS: readonly {
  key: AmendmentField;
  label: string;
  description: string;
}[] = [
  { key: "legalName", label: "Razão social", description: "Novo nome empresarial" },
  { key: "taxRegime", label: "Regime tributário", description: "Troca de enquadramento" },
  { key: "activities", label: "Atividades", description: "Adicionar ou retirar CNAEs" },
  { key: "address", label: "Endereço", description: "Novo endereço e IPTU" },
  { key: "ownership", label: "Capital social e QSA", description: "Sócios, quotas e participação final" },
  { key: "contact", label: "Contato", description: "Nome, telefone ou e-mail" },
];

function eventLabel(eventType: string, kind: CompanyFlowKind): string {
  const labels: Record<string, string> = {
    created: "Fluxo enviado ao Societário",
    claimed: "Fluxo assumido",
    assigned: "Responsável alterado",
    returned_to_owner: kind === "amendment"
      ? "Informativo confirmado"
      : kind === "closure"
        ? "Baixa confirmada"
        : "Dados aprovados confirmados",
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
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...value, { name: "", changeType: null }])}>
          <Plus aria-hidden /> Adicionar sócio
        </Button>
      </div>
      {value.length === 0 ? <p className="text-xs text-muted-foreground">Inclua os integrantes do quadro societário.</p> : null}
      {value.map((member, index) => (
        <div key={index} className="grid gap-2 rounded-md border bg-muted/20 p-2 sm:grid-cols-2">
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

function AmendmentOwnershipFields({
  socialCapital,
  onSocialCapitalChange,
  value,
  onChange,
}: {
  socialCapital: string;
  onSocialCapitalChange: (value: string) => void;
  value: FlowQsaMember[];
  onChange: (value: FlowQsaMember[]) => void;
}) {
  const participationTotal = qsaFinalParticipationTotal(value);
  const distributionComplete = qsaDistributionIsComplete(value);

  function change(index: number, field: keyof FlowQsaMember, next: string) {
    onChange(value.map((member, current) => {
      if (current !== index) return member;
      if (field === "changeType" && next === "left") {
        return { ...member, changeType: "left" as const, participation: "0" };
      }
      if (field === "changeType" && next === "entered") {
        return { ...member, changeType: "entered" as const, previousParticipation: "0" };
      }
      return { ...member, [field]: next };
    }));
  }

  function addMember() {
    onChange([
      ...value,
      {
        name: "",
        changeType: "entered",
        previousParticipation: "0",
        participation: "",
        quotaTransferDetails: "",
      },
    ]);
  }

  return (
    <section className="grid gap-4 rounded-md border border-primary/35 bg-background/45 p-3">
      <div>
        <Label>Capital social e composição societária final</Label>
        <p className="mt-1 text-xs text-muted-foreground">
          Registre a movimentação das quotas e como ficará o capital de cada sócio depois da alteração.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(15rem,0.8fr)]">
        <div className="grid gap-1.5">
          <Label>Capital social após a alteração</Label>
          <CurrencyInput value={socialCapital} onValueChange={onSocialCapitalChange} placeholder="R$ 0,00" />
          <p className="text-xs text-muted-foreground">Mesmo que o total não mude, confirme aqui o valor que ficará no contrato.</p>
        </div>
        <div className={cn(
          "grid content-center gap-1 rounded-md border p-3",
          distributionComplete
            ? "border-success/35 bg-success/5"
            : "border-warning/35 bg-warning/5",
        )}>
          <span className="hud-label">Conferência da participação final</span>
          <strong className={distributionComplete ? "text-success" : "text-warning"}>
            {new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 }).format(participationTotal)}% de 100%
          </strong>
          <span className="text-xs text-muted-foreground">
            {distributionComplete ? "Composição fechada em 100%." : "Ajuste os percentuais até fechar em 100%."}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <div>
          <Label>Movimentação dos sócios e das quotas</Label>
          <p className="mt-1 text-xs text-muted-foreground">Inclua também quem permanece para registrar a composição final completa.</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addMember}>
          <Plus aria-hidden /> Adicionar sócio
        </Button>
      </div>

      {value.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          Adicione todos os sócios que entrarão, sairão ou permanecerão após a alteração.
        </p>
      ) : null}

      {value.map((member, index) => {
        const capitalValue = qsaMemberCapitalValue(socialCapital, member.participation);
        const movementLabel = member.changeType === "entered"
          ? "De quem recebeu as quotas ou houve aumento de capital?"
          : member.changeType === "left"
            ? "Para quem transferiu as quotas?"
            : "Como as quotas foram movimentadas?";
        return (
          <div key={index} className="grid gap-3 rounded-md border bg-muted/15 p-3">
            <div className="flex items-start justify-between gap-2">
              <Badge variant="outline">Sócio {index + 1}</Badge>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remover sócio ${index + 1}`} onClick={() => onChange(value.filter((_, current) => current !== index))}>
                <XCircle aria-hidden />
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>Situação após a alteração</Label>
                <Select value={member.changeType ?? "remaining"} onValueChange={(next) => change(index, "changeType", next)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="remaining">Permanece no QSA</SelectItem>
                    <SelectItem value="entered">Entrou no QSA</SelectItem>
                    <SelectItem value="left">Saiu do QSA</SelectItem>
                    <SelectItem value="updated">Alterou a participação</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Nome / razão social</Label>
                <Input value={member.name} onChange={(event) => change(index, "name", event.target.value)} placeholder="Nome completo do sócio" />
              </div>
              <div className="grid gap-1.5">
                <Label>CPF ou CNPJ</Label>
                <Input value={member.document ?? ""} onChange={(event) => change(index, "document", event.target.value)} placeholder="Opcional" />
              </div>
              <div className="grid gap-1.5">
                <Label>Qualificação</Label>
                <Input value={member.qualification ?? ""} onChange={(event) => change(index, "qualification", event.target.value)} placeholder="Ex.: sócio administrador" />
              </div>
              <div className="grid gap-1.5">
                <Label>Participação anterior{member.changeType === "left" || member.changeType === "updated" ? " *" : ""}</Label>
                <Input value={member.previousParticipation ?? ""} onChange={(event) => change(index, "previousParticipation", event.target.value)} placeholder="0,00%" inputMode="decimal" disabled={member.changeType === "entered"} />
              </div>
              <div className="grid gap-1.5">
                <Label>Participação final *</Label>
                <Input value={member.participation ?? ""} onChange={(event) => change(index, "participation", event.target.value)} placeholder="0,00%" inputMode="decimal" disabled={member.changeType === "left"} />
                <p className="text-xs text-muted-foreground">
                  Capital final: {capitalValue ? formatBRLCurrency(capitalValue) : "preencha o capital e o percentual"}
                </p>
              </div>
            </div>
            {member.changeType && member.changeType !== "remaining" ? (
              <div className="grid gap-1.5">
                <Label>{movementLabel} *</Label>
                <Input
                  value={member.quotaTransferDetails ?? ""}
                  onChange={(event) => change(index, "quotaTransferDetails", event.target.value)}
                  placeholder={member.changeType === "left" ? "Ex.: transferiu 40% para Maria" : "Ex.: recebeu 30% de João ou aumento de capital"}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}

function FlowRequestSummary({ row }: { row: CompanyFlowView }) {
  const officialLegalName = row.approvedLegalName ?? row.existingClientName;
  const taxRegime = row.approvedTaxRegime ?? row.taxRegime;
  const address = row.approvedAddress ?? row.address;
  const qsa = row.approvedQsa.length > 0 ? row.approvedQsa : row.qsa;
  const contactValues = [row.contactName, row.contactPhone, row.contactEmail].filter(Boolean);
  const amendmentChangeCount = [
    Boolean(row.requestedLegalName),
    row.requestedActivities.length > 0 || row.removedActivities.length > 0,
    Boolean(taxRegime),
    Boolean(address || row.iptu),
    Boolean(row.socialCapital) || qsa.length > 0,
    contactValues.length > 0,
  ].filter(Boolean).length;
  const requestedNameDiffers = Boolean(
    row.approvedLegalName &&
    row.requestedLegalName &&
    row.approvedLegalName.localeCompare(row.requestedLegalName, "pt-BR", {
      sensitivity: "base",
    }) !== 0,
  );

  if (row.kind === "amendment") {
    return (
      <section className="grid gap-3 rounded-md border border-primary/45 bg-primary/5 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-primary/20 pb-3">
          <div>
            <p className="hud-label text-primary">Solicitação do cliente</p>
            <h3 className="mt-1 text-base font-semibold">Alterações solicitadas</h3>
          </div>
          <Badge className="border-primary/40 bg-primary/15 text-primary" variant="outline">
            {amendmentChangeCount} tipo{amendmentChangeCount === 1 ? "" : "s"} de alteração
          </Badge>
        </div>

        <div className="rounded-md border bg-background/45 px-3 py-2">
          <span className="hud-label">Empresa atual</span>
          <p className="mt-1 font-semibold">{officialLegalName ?? "—"}</p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {row.requestedLegalName ? (
            <div className="rounded-md border border-primary/30 bg-background/65 p-3 sm:col-span-2">
              <Badge className="mb-2">Razão social</Badge>
              <div className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                <div>
                  <span className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">Atual</span>
                  <p className="mt-0.5">{row.existingClientName ?? "Não informada"}</p>
                </div>
                <span className="hidden text-lg text-primary sm:block" aria-hidden>→</span>
                <div>
                  <span className="text-[10px] font-medium tracking-wider text-primary uppercase">Nova razão social</span>
                  <p className="mt-0.5 font-semibold text-primary">{row.requestedLegalName}</p>
                </div>
              </div>
            </div>
          ) : null}

          {taxRegime ? (
            <div className="rounded-md border border-primary/30 bg-background/65 p-3">
              <Badge className="mb-2">Regime tributário</Badge>
              <p className="text-[10px] font-medium tracking-wider text-primary uppercase">Novo regime</p>
              <p className="mt-1 font-semibold">{TAX_REGIME_LABELS[taxRegime]}</p>
            </div>
          ) : null}

          {row.requestedActivities.length > 0 || row.removedActivities.length > 0 ? (
            <div className="grid gap-2 rounded-md border border-primary/30 bg-background/65 p-3 sm:col-span-2">
              <Badge className="w-fit">Atividades econômicas</Badge>
              {row.requestedActivities.length > 0 ? (
                <div>
                  <p className="text-[10px] font-medium tracking-wider text-success uppercase">Adicionar</p>
                  <ul className="mt-1 grid gap-1">
                    {row.requestedActivities.map((activity, index) => (
                      <li key={`${activity.description}-${index}`} className="rounded bg-success/5 px-2 py-1.5">+ {activity.description}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {row.removedActivities.length > 0 ? (
                <div>
                  <p className="text-[10px] font-medium tracking-wider text-destructive uppercase">Retirar</p>
                  <ul className="mt-1 grid gap-1">
                    {row.removedActivities.map((activity, index) => (
                      <li key={`${activity.description}-${index}`} className="rounded bg-destructive/5 px-2 py-1.5">− {activity.description}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          {address || row.iptu ? (
            <div className="rounded-md border border-primary/30 bg-background/65 p-3 sm:col-span-2">
              <Badge className="mb-2">Endereço</Badge>
              {address ? <><p className="text-[10px] font-medium tracking-wider text-primary uppercase">Novo endereço</p><p className="mt-1 whitespace-pre-wrap font-medium">{address}</p></> : null}
              {row.iptu ? <p className="mt-2 text-xs text-muted-foreground"><strong className="text-foreground">IPTU:</strong> {row.iptu}</p> : null}
            </div>
          ) : null}

          {row.socialCapital || qsa.length > 0 ? (
            <div className="grid gap-2 rounded-md border border-primary/30 bg-background/65 p-3 sm:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge className="w-fit">Capital social e QSA</Badge>
                {row.socialCapital ? <strong>Capital total: {formatBRLCurrency(row.socialCapital)}</strong> : null}
              </div>
              {qsa.map((member, index) => {
                const capitalValue = qsaMemberCapitalValue(row.socialCapital, member.participation);
                return (
                  <div key={`${member.name}-${index}`} className="rounded-md bg-muted/25 p-2.5">
                    <p className="font-semibold">
                      {member.changeType === "entered" ? "Entrada" : member.changeType === "left" ? "Saída" : member.changeType === "remaining" ? "Permanece" : "Alteração"} · {member.name}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {[
                        member.document && `CPF/CNPJ: ${member.document}`,
                        member.qualification,
                        member.previousParticipation && `Antes: ${formatQsaParticipation(member.previousParticipation)}`,
                        member.participation && `Final: ${formatQsaParticipation(member.participation)}`,
                        capitalValue && `Capital: ${formatBRLCurrency(capitalValue)}`,
                      ].filter(Boolean).join(" · ") || "Sem dados complementares"}
                    </p>
                    {member.quotaTransferDetails ? <p className="mt-1 text-xs"><strong>Quotas:</strong> {member.quotaTransferDetails}</p> : null}
                  </div>
                );
              })}
            </div>
          ) : null}

          {contactValues.length > 0 ? (
            <div className="rounded-md border border-primary/30 bg-background/65 p-3 sm:col-span-2">
              <Badge className="mb-2">Contato</Badge>
              <p className="text-[10px] font-medium tracking-wider text-primary uppercase">Novos dados de contato</p>
              <div className="mt-1 grid gap-1 sm:grid-cols-3">
                {row.contactName ? <p><strong>Nome:</strong> {row.contactName}</p> : null}
                {row.contactPhone ? <p><strong>Telefone:</strong> {row.contactPhone}</p> : null}
                {row.contactEmail ? <p><strong>E-mail:</strong> {row.contactEmail}</p> : null}
              </div>
            </div>
          ) : null}
        </div>

        {amendmentChangeCount === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">A alteração foi registrada somente nas observações abaixo.</p>
        ) : null}
        {row.requestDetails ? (
          <div className="rounded-md border bg-background/35 p-3">
            <strong>Observações:</strong>
            <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{row.requestDetails}</p>
          </div>
        ) : null}
        {row.billingAmount && row.billingDescription ? (
          <div className="rounded-md border border-gold/30 bg-gold/5 p-3">
            <strong>Cobrança do serviço:</strong> {formatBRLCurrency(row.billingAmount)}
            <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{row.billingDescription}</p>
            <p className="mt-1 text-xs text-muted-foreground">Será enviada ao Financeiro na confirmação do Informativo.</p>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className="grid gap-2 rounded-md border bg-muted/20 p-3">
      <p className="hud-label">Solicitação do cliente</p>
      <p><strong>{row.approvedLegalName ? "Razão social oficial:" : "Razão social:"}</strong> {officialLegalName ?? row.requestedLegalName ?? "—"}</p>
      {requestedNameDiffers ? (
        <p className="text-xs text-muted-foreground">
          <strong>Nome solicitado inicialmente:</strong> {row.requestedLegalName}
        </p>
      ) : null}
      {row.requestedActivities.length > 0 ? <p><strong>Atividades:</strong> {row.requestedActivities.map((activity) => activity.description).join("; ")}</p> : null}
      {row.removedActivities.length > 0 ? <p><strong>Atividades a retirar:</strong> {row.removedActivities.map((activity) => activity.description).join("; ")}</p> : null}
      {taxRegime ? <p><strong>Regime tributário:</strong> {TAX_REGIME_LABELS[taxRegime]}</p> : null}
      {row.iptu ? <p><strong>IPTU:</strong> {row.iptu}</p> : null}
      {row.socialCapital ? <p><strong>Capital social:</strong> {formatBRLCurrency(row.socialCapital)}</p> : null}
      {row.roomSize ? <p><strong>Tamanho da sala:</strong> {row.roomSize}</p> : null}
      {address ? <p className="whitespace-pre-wrap"><strong>Endereço:</strong> {address}</p> : null}
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
      {contactValues.length > 0 ? <p><strong>Contato:</strong> {contactValues.join(" · ")}</p> : null}
      {row.requestDetails ? <p className="whitespace-pre-wrap"><strong>Detalhes:</strong> {row.requestDetails}</p> : null}
      {row.billingAmount && row.billingDescription ? (
        <div className="mt-1 rounded-md border border-gold/30 bg-gold/5 p-3">
          <strong>Cobrança do serviço:</strong> {formatBRLCurrency(row.billingAmount)}
          <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{row.billingDescription}</p>
          <p className="mt-1 text-xs text-muted-foreground">Será enviada ao Financeiro na confirmação do Informativo.</p>
        </div>
      ) : null}
    </section>
  );
}

function NewCompanyFlowDialog({
  clanId,
}: {
  clanId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<CompanyFlowKind>("opening");
  const [existingClientId, setExistingClientId] = useState("");
  const [companyCnpj, setCompanyCnpj] = useState("");
  const [consultedCompany, setConsultedCompany] =
    useState<CompanyFlowClientLookupView | null>(null);
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
  const [billingAmount, setBillingAmount] = useState("");
  const [billingDescription, setBillingDescription] = useState("");
  const [govPassword, setGovPassword] = useState("");
  const [amendmentFields, setAmendmentFields] = useState<AmendmentField[]>([]);

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
  const opening = kind === "opening";
  const amendment = kind === "amendment";
  const closing = kind === "closure";
  const amendmentHas = (field: AmendmentField) => amendmentFields.includes(field);

  function seedOwnershipFromLookup(company: CompanyFlowClientLookupView["company"]) {
    if (!socialCapital && company.shareCapital) {
      setSocialCapital(company.shareCapital);
    }
    if (qsa.length === 0 && company.qsa.length > 0) {
      setQsa(company.qsa.map((member) => ({
        name: member.name,
        document: member.document,
        qualification: member.qualification,
        previousParticipation: member.participation,
        participation: member.participation,
        quotaTransferDetails: null,
        changeType: "remaining" as const,
      })));
    }
  }

  function toggleAmendmentField(field: AmendmentField) {
    if (field === "ownership" && !amendmentFields.includes(field) && consultedCompany) {
      seedOwnershipFromLookup(consultedCompany.company);
    }
    setAmendmentFields((current) =>
      current.includes(field)
        ? current.filter((item) => item !== field)
        : [...current, field],
    );
  }

  function lookupFlowCompany() {
    startTransition(async () => {
      const result = await lookupCompanyFlowClientCnpj({
        clanId,
        cnpj: companyCnpj,
      });
      if (!result.ok || !result.data) {
        toast.error(result.ok ? "A consulta não retornou dados." : result.error);
        return;
      }
      setConsultedCompany(result.data);
      setCompanyCnpj(formatCnpj(result.data.company.normalizedCnpj));
      setExistingClientId(result.data.client?.id ?? "");
      if (amendment && amendmentHas("ownership")) {
        seedOwnershipFromLookup(result.data.company);
      }
      if (result.data.client) {
        toast.success("Empresa localizada e vinculada ao Fluxo.");
      } else {
        toast.warning("CNPJ localizado na Receita, mas sem empresa correspondente no painel.");
      }
    });
  }

  function submit() {
    if (amendment && amendmentHas("ownership")) {
      if (!socialCapital || Number(socialCapital) <= 0) {
        toast.error("Informe o capital social após a alteração.");
        return;
      }
      if (qsa.length === 0 || qsa.some((member) => !member.name.trim())) {
        toast.error("Inclua todos os sócios da composição final e informe os nomes.");
        return;
      }
      if (qsa.some((member) => parseQsaParticipation(member.participation) === null)) {
        toast.error("Informe uma participação final válida para cada sócio.");
        return;
      }
      if (qsa.some((member) => (
        member.changeType === "left" || member.changeType === "updated"
      ) && (parseQsaParticipation(member.previousParticipation) ?? 0) <= 0)) {
        toast.error("Informe a participação anterior de quem saiu ou alterou suas quotas.");
        return;
      }
      if (qsa.some((member) => member.changeType === "left" && parseQsaParticipation(member.participation) !== 0)) {
        toast.error("Quem saiu do QSA precisa ficar com participação final de 0%.");
        return;
      }
      if (!qsaDistributionIsComplete(qsa)) {
        toast.error("A participação final dos sócios precisa fechar em 100%.");
        return;
      }
      if (qsa.some((member) => member.changeType !== "remaining" && !member.quotaTransferDetails?.trim())) {
        toast.error("Informe a origem ou o destino das quotas de cada sócio movimentado.");
        return;
      }
      if (qsa.some((member) => {
        if (member.changeType !== "remaining") return false;
        const previous = parseQsaParticipation(member.previousParticipation);
        const next = parseQsaParticipation(member.participation);
        return previous !== null && next !== null && Math.abs(previous - next) >= 0.001;
      })) {
        toast.error("Quando o percentual mudar, marque o sócio como “Alterou a participação”.");
        return;
      }
    }
    startTransition(async () => {
      const result = await createCompanyFlow({
        clanId,
        kind,
        source: "written",
        existingClientId: kind === "opening" ? null : existingClientId || null,
        requestedLegalName:
          opening || (amendment && amendmentHas("legalName")) ? legalName : "",
        requestedActivities:
          opening || (amendment && amendmentHas("activities"))
            ? splitActivities(activities)
            : [],
        removedActivities:
          amendment && amendmentHas("activities")
            ? splitActivities(removedActivities)
            : [],
        taxRegime:
          opening || (amendment && amendmentHas("taxRegime"))
            ? taxRegime || null
            : null,
        iptu: opening || (amendment && amendmentHas("address")) ? iptu : "",
        socialCapital:
          opening || (amendment && amendmentHas("ownership"))
            ? socialCapital
            : "",
        roomSize: opening ? roomSize : "",
        address: opening || (amendment && amendmentHas("address")) ? address : "",
        qsa: opening || (amendment && amendmentHas("ownership")) ? qsa : [],
        contactName:
          opening || (amendment && amendmentHas("contact")) ? contactName : "",
        contactPhone:
          opening || (amendment && amendmentHas("contact")) ? contactPhone : "",
        contactEmail:
          opening || (amendment && amendmentHas("contact")) ? contactEmail : "",
        requestDetails: details,
        billingAmount: opening ? "" : billingAmount,
        billingDescription: opening ? "" : billingDescription,
        govPassword: closing ? undefined : govPassword || undefined,
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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="lg" className="shadow-sm"><Plus aria-hidden /> Criar novo fluxo</Button>
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
                <Label htmlFor="flow-company-cnpj">CNPJ da empresa {kind === "amendment" ? "que será alterada" : "que será baixada"}</Label>
                <div className="flex gap-2">
                  <Input
                    id="flow-company-cnpj"
                    className="font-mono"
                    value={companyCnpj}
                    onChange={(event) => {
                      setCompanyCnpj(event.target.value);
                      setExistingClientId("");
                      setConsultedCompany(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && companyCnpj.replace(/\D/g, "").length === 14) {
                        event.preventDefault();
                        lookupFlowCompany();
                      }
                    }}
                    placeholder="00.000.000/0000-00"
                    inputMode="numeric"
                    autoComplete="off"
                  />
                  <Button type="button" variant="outline" disabled={pending || companyCnpj.replace(/\D/g, "").length !== 14} onClick={lookupFlowCompany}>
                    {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Search aria-hidden />} Consultar
                  </Button>
                </div>
              </div>
            )}
            {opening ? <div className="grid gap-1.5"><Label>Regime tributário *</Label><Select value={taxRegime || undefined} onValueChange={(value) => setTaxRegime(value as TaxRegime)}><SelectTrigger><SelectValue placeholder="Selecione o regime" /></SelectTrigger><SelectContent>{TAX_REGIMES.map((value) => <SelectItem key={value} value={value}>{TAX_REGIME_LABELS[value]}</SelectItem>)}</SelectContent></Select></div> : null}
            {opening ? <div className="grid gap-1.5"><Label>IPTU</Label><Input value={iptu} onChange={(event) => setIptu(event.target.value)} placeholder="Inscrição ou referência do IPTU" /></div> : null}
          </div>

          {!opening && consultedCompany ? (
            <section className={cn("grid gap-3 rounded-md border p-3", consultedCompany.client ? "border-success/30 bg-success/5" : "border-warning/35 bg-warning/5")}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="hud-label">Dados atuais consultados</p>
                  <h3 className="mt-1 font-medium">{consultedCompany.company.legalName}</h3>
                  <p className="mt-0.5 font-mono text-xs text-muted-foreground">{formatCnpj(consultedCompany.company.normalizedCnpj)}</p>
                </div>
                <Badge variant="outline">{consultedCompany.company.cadastralSituation ?? "Situação não informada"}</Badge>
              </div>
              {consultedCompany.client ? (
                <p className="text-xs text-success">
                  Vinculada ao cadastro “{consultedCompany.client.name}”{consultedCompany.matchedBy === "name" ? " pela razão social; o CNPJ ainda não consta no cadastro interno" : ""}.
                </p>
              ) : (
                <p className="text-xs text-warning">Esta empresa ainda não foi localizada entre os clientes ativos do painel. Complete o cadastro antes de abrir o Fluxo.</p>
              )}
              <div className="grid gap-2 text-sm sm:grid-cols-2">
                <div className="rounded-md bg-background/35 p-2.5"><strong className="block text-xs">Endereço atual</strong><span className="mt-1 block text-muted-foreground">{consultedCompany.company.address ? [[consultedCompany.company.address.street, consultedCompany.company.address.number].filter(Boolean).join(", "), consultedCompany.company.address.city, consultedCompany.company.address.state].filter(Boolean).join(" · ") : "Não informado"}</span></div>
                <div className="rounded-md bg-background/35 p-2.5"><strong className="block text-xs">Capital social</strong><span className="mt-1 block text-muted-foreground">{consultedCompany.company.shareCapital ? formatBRLCurrency(consultedCompany.company.shareCapital) : "Não informado"}</span></div>
                <div className="rounded-md bg-background/35 p-2.5"><strong className="block text-xs">Regime disponível</strong><span className="mt-1 block text-muted-foreground">{consultedCompany.company.isSimplesOptant ? "Simples Nacional" : consultedCompany.company.taxRegimes[0]?.form ?? "Não informado"}</span></div>
                <div className="rounded-md bg-background/35 p-2.5"><strong className="block text-xs">Natureza jurídica</strong><span className="mt-1 block text-muted-foreground">{consultedCompany.company.legalNature ?? "Não informada"}</span></div>
              </div>

              <div className="grid gap-2 rounded-md bg-background/35 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-xs">Atividades econômicas com CNAE</strong>
                  <Badge variant="outline">
                    {(consultedCompany.company.cnaeDescription ? 1 : 0) + consultedCompany.company.secondaryCnaes.length} atividade{(consultedCompany.company.cnaeDescription ? 1 : 0) + consultedCompany.company.secondaryCnaes.length === 1 ? "" : "s"}
                  </Badge>
                </div>
                {consultedCompany.company.cnaeDescription ? (
                  <div className="rounded-md border border-primary/25 bg-primary/5 p-2.5 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge>Principal</Badge>
                      <span className="font-mono text-xs text-muted-foreground">{consultedCompany.company.cnaeCode ?? "CNAE não informado"}</span>
                    </div>
                    <p className="mt-1.5">{consultedCompany.company.cnaeDescription}</p>
                  </div>
                ) : null}
                {consultedCompany.company.secondaryCnaes.length > 0 ? (
                  <div className="grid max-h-48 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
                    {consultedCompany.company.secondaryCnaes.map((activity) => (
                      <div key={`${activity.code}-${activity.description}`} className="rounded-md border bg-muted/15 p-2.5 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">Secundária</Badge>
                          <span className="font-mono text-xs text-muted-foreground">{activity.code}</span>
                        </div>
                        <p className="mt-1.5">{activity.description}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
                {!consultedCompany.company.cnaeDescription && consultedCompany.company.secondaryCnaes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Atividades não informadas.</p>
                ) : null}
              </div>

              <div className="grid gap-2 rounded-md bg-background/35 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-xs">QSA atual</strong>
                  <Badge variant="outline">{consultedCompany.company.qsa.length} integrante{consultedCompany.company.qsa.length === 1 ? "" : "s"}</Badge>
                </div>
                {consultedCompany.company.qsa.length > 0 ? (
                  <div className="grid max-h-52 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
                    {consultedCompany.company.qsa.map((member, index) => (
                      <div key={`${member.name}-${index}`} className="rounded-md border bg-muted/15 p-2.5 text-sm">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <p className="font-medium">{member.name}</p>
                          <Badge variant={member.participation ? "default" : "outline"}>
                            {member.participation ?? "Percentual não informado"}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{member.qualification ?? "Qualificação não informada"}</p>
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          {member.document ? <span className="font-mono">{member.document}</span> : null}
                          {member.joinedAt ? <span>Entrada em {formatLookupDate(member.joinedAt)}</span> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-sm text-muted-foreground">Quadro societário não informado.</p>}
                {consultedCompany.company.qsa.some((member) => !member.participation) ? (
                  <p className="text-xs text-warning/85">A consulta pública da Receita não informa a porcentagem societária. Confira a participação de cada sócio no contrato social.</p>
                ) : null}
              </div>
            </section>
          ) : null}

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
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><h3 className="font-medium">O que será alterado?</h3><p className="text-xs text-muted-foreground">Selecione os itens para abrir somente os campos necessários.</p></div>
                {amendmentFields.length > 0 ? <Badge variant="outline">{amendmentFields.length} selecionado{amendmentFields.length === 1 ? "" : "s"}</Badge> : null}
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {AMENDMENT_FIELDS.map((field) => {
                  const selected = amendmentHas(field.key);
                  return (
                    <button
                      key={field.key}
                      type="button"
                      role="checkbox"
                      aria-checked={selected}
                      className={cn(
                        "flex min-h-16 items-center gap-3 rounded-md border p-3 text-left transition-colors",
                        selected
                          ? "border-primary/60 bg-primary/10"
                          : "bg-card/35 hover:border-primary/35 hover:bg-muted/35",
                      )}
                      onClick={() => toggleAmendmentField(field.key)}
                    >
                      <span className={cn("grid size-5 shrink-0 place-items-center rounded-sm border", selected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40")}>
                        {selected ? <Check className="size-3.5" aria-hidden /> : null}
                      </span>
                      <span><strong className="block text-sm">{field.label}</strong><span className="text-xs text-muted-foreground">{field.description}</span></span>
                    </button>
                  );
                })}
              </div>

              {amendmentHas("legalName") ? <div className="grid gap-1.5"><Label>Nova razão social</Label><Input value={legalName} onChange={(event) => setLegalName(event.target.value)} placeholder="Digite a nova razão social" /></div> : null}
              {amendmentHas("taxRegime") ? <div className="grid gap-1.5"><Label>Novo regime tributário</Label><Select value={taxRegime || undefined} onValueChange={(value) => setTaxRegime(value as TaxRegime)}><SelectTrigger><SelectValue placeholder="Selecione o novo regime" /></SelectTrigger><SelectContent>{TAX_REGIMES.map((value) => <SelectItem key={value} value={value}>{TAX_REGIME_LABELS[value]}</SelectItem>)}</SelectContent></Select></div> : null}
              {amendmentHas("activities") ? <div className="grid gap-3 sm:grid-cols-2"><div className="grid gap-1.5"><Label>Atividades a adicionar</Label><Textarea value={activities} onChange={(event) => setActivities(event.target.value)} rows={3} placeholder="Uma atividade por linha" /></div><div className="grid gap-1.5"><Label>Atividades a retirar</Label><Textarea value={removedActivities} onChange={(event) => setRemovedActivities(event.target.value)} rows={3} placeholder="Uma atividade por linha" /></div></div> : null}
              {amendmentHas("address") ? <div className="grid gap-3 sm:grid-cols-2"><div className="grid gap-1.5"><Label>Novo endereço</Label><Textarea value={address} onChange={(event) => setAddress(event.target.value)} rows={3} placeholder="Rua, número, complemento, bairro, cidade/UF e CEP" /></div><div className="grid gap-1.5"><Label>IPTU do novo endereço</Label><Input value={iptu} onChange={(event) => setIptu(event.target.value)} placeholder="Inscrição ou referência do IPTU" /></div></div> : null}
              {amendmentHas("ownership") ? <AmendmentOwnershipFields socialCapital={socialCapital} onSocialCapitalChange={setSocialCapital} value={qsa} onChange={setQsa} /> : null}
              {amendmentHas("contact") ? <div className="grid gap-3 sm:grid-cols-2"><div className="grid gap-1.5"><Label>Contato</Label><Input value={contactName} onChange={(event) => setContactName(event.target.value)} placeholder="Nome do contato" /></div><div className="grid gap-1.5"><Label>Telefone</Label><Input value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} placeholder="(00) 00000-0000" /></div><div className="grid gap-1.5 sm:col-span-2"><Label>E-mail</Label><Input type="email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} placeholder="contato@empresa.com" /></div></div> : null}
              <div className="grid gap-1.5"><Label>Observações</Label><Textarea value={details} onChange={(event) => setDetails(event.target.value)} rows={5} placeholder="Descreva informações, cuidados ou outras alterações solicitadas" /></div>
            </section>
          ) : null}

          {opening ? <><div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5"><Label>Contato</Label><Input value={contactName} onChange={(event) => setContactName(event.target.value)} placeholder="Nome do contato" /></div>
            <div className="grid gap-1.5"><Label>Telefone</Label><Input value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} placeholder="(00) 00000-0000" /></div>
            <div className="grid gap-1.5"><Label>E-mail</Label><Input type="email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} placeholder="contato@empresa.com" /></div>
          </div>
          <div className="grid gap-1.5"><Label>{detailLabel}</Label><Textarea value={details} onChange={(event) => setDetails(event.target.value)} rows={4} placeholder={detailPlaceholder} /></div></> : null}
          {closing ? <div className="grid gap-1.5"><Label>Observações da baixa</Label><Textarea value={details} onChange={(event) => setDetails(event.target.value)} rows={6} placeholder="Descreva a data da baixa, recibo e demais observações" /></div> : null}
          {!opening ? (
            <section className="grid gap-3 rounded-md border border-gold/30 bg-gold/5 p-3">
              <div>
                <h3 className="font-medium">Cobrança do serviço</h3>
                <p className="text-xs text-muted-foreground">Opcional. Preenchendo os dois campos, o Informativo gerará uma missão para o Financeiro.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-[14rem_minmax(0,1fr)]">
                <div className="grid gap-1.5">
                  <Label>Valor cobrado</Label>
                  <CurrencyInput value={billingAmount} onValueChange={setBillingAmount} placeholder="R$ 0,00" />
                </div>
                <div className="grid gap-1.5">
                  <Label>Descrição da cobrança</Label>
                  <Input value={billingDescription} onChange={(event) => setBillingDescription(event.target.value)} placeholder="Ex.: Honorários pela alteração contratual" />
                </div>
              </div>
            </section>
          ) : null}
          {closing ? null : <div className="grid gap-1.5 rounded-md border border-primary/30 bg-primary/5 p-3"><Label htmlFor="gov-password" className="flex items-center gap-1.5"><ShieldCheck className="size-4" aria-hidden /> Senha Gov.br (opcional)</Label><Input id="gov-password" type="password" autoComplete="new-password" value={govPassword} onChange={(event) => setGovPassword(event.target.value)} placeholder="Fica cifrada e não entra no histórico" /><p className="text-xs text-muted-foreground">Somente o dono, o responsável societário e a liderança do Societário podem revelar esta senha.</p></div>}
        </div>
        <DialogFooter><Button type="button" disabled={pending || (!opening && !existingClientId)} onClick={submit}>{pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Send aria-hidden />} Enviar ao Societário</Button></DialogFooter>
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
  const rhVerificationState = getRhVerificationState(row);
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
      toast.success("Dados consultados na Receita. Revise antes de confirmar.");
    });
  }
  function confirmProcessing() {
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
      toast.success(amendment ? "Informativo confirmado." : closure ? "Baixa confirmada." : "Dados aprovados confirmados.");
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
          <div className="flex flex-wrap gap-2"><Badge variant="outline" className={STATUS_CLASS[row.status]}>{COMPANY_FLOW_STATUS_LABELS[row.status]}</Badge><Badge variant="outline">Origem: {FLOW_SOURCE_LABELS[row.source]}</Badge>{row.assignedName ? <Badge variant="outline">Societário: {row.assignedName}</Badge> : null}<RhVerificationBadge state={rhVerificationState} /></div>
          <FlowRequestSummary row={row} />
          {rhVerificationState === "pending" ? (
            <section className="rounded-md border border-warning/45 bg-warning/10 p-3" role="status">
              <h3 className="flex items-center gap-2 text-warning"><Clock3 className="size-4" aria-hidden /> Verificação obrigatória do RH pendente</h3>
              <p className="mt-1 max-w-prose text-xs text-muted-foreground">O RH precisa baixar a folha e o pró-labore, ou confirmar que já estão regularizados. O Societário pode trabalhar no processo, mas não consegue confirmar a baixa enquanto essa missão estiver pendente.</p>
            </section>
          ) : rhVerificationState === "confirmed" ? (
            <section className="rounded-md border border-success/35 bg-success/5 p-3" role="status">
              <h3 className="flex items-center gap-2 text-success"><ShieldCheck className="size-4" aria-hidden /> Folha e pró-labore confirmados pelo RH</h3>
              <p className="mt-1 text-xs text-muted-foreground">Validação concluída{row.rhVerificationCompletedAt ? ` em ${new Date(row.rhVerificationCompletedAt).toLocaleString("pt-BR")}` : ""}. A confirmação da baixa está liberada para o Societário.</p>
            </section>
          ) : null}
          {row.hasGovSecret ? <section className="rounded-md border border-primary/30 bg-primary/5 p-3"><p className="flex items-center gap-1.5 font-medium"><KeyRound className="size-4" aria-hidden /> Acesso Gov.br protegido</p>{revealedSecret ? <p className="mt-2 rounded bg-background px-2 py-1 font-mono text-sm break-all">{revealedSecret}</p> : <Button type="button" className="mt-2" variant="outline" size="sm" disabled={pending || !row.canReturn} onClick={revealSecret}><Eye aria-hidden /> Revelar senha</Button>}</section> : null}
          {row.status === "in_progress" && row.canReturn ? (
            <section className="grid gap-3 border-t pt-4">
              <div>
                <h3 className="font-medium">{amendment ? "Confirmação do informativo" : closure ? "Confirmação da baixa" : "Confirmação dos dados aprovados"}</h3>
                <p className="text-xs text-muted-foreground">{amendment ? "Confira as informações e confirme quando todas as alterações estiverem concluídas." : closure ? "Confirme quando o processo de baixa estiver concluído." : "Registre e confirme os dados aprovados."}</p>
              </div>
              {simpleConfirmation ? (
                <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">{amendment ? "Confira as alterações destacadas acima. Ao confirmar, você registra que todos esses itens foram concluídos pelo Societário." : "Esta confirmação registra que a baixa foi concluída pelo Societário."}</div>
              ) : (
                <>
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto]"><div className="grid gap-1.5"><Label>CNPJ aprovado</Label><Input value={cnpj} onChange={(event) => setCnpj(event.target.value)} placeholder="00.000.000/0000-00" inputMode="numeric" /></div><Button type="button" className="self-end" variant="outline" disabled={pending || !cnpj.trim()} onClick={lookupCnpj}><Search aria-hidden /> Consultar CNPJ</Button></div>
                  <div className="grid gap-1.5"><Label>Razão social oficial (Receita)</Label><Input value={approvedName} readOnly placeholder="Consulte o CNPJ para preencher" /><p className="text-xs text-muted-foreground">Este nome é conferido novamente pelo CNPJ ao devolver o Fluxo.</p></div>
                  <div className="grid gap-1.5"><Label>Atividades aprovadas</Label><Textarea value={approvedActivities} onChange={(event) => setApprovedActivities(event.target.value)} rows={3} placeholder="Uma atividade por linha" /></div>
                </>
              )}
              {simpleConfirmation ? null : <div className="grid gap-1.5"><Label>Retorno e observações</Label><Textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} placeholder="O que foi deferido, pendências ou cuidados" /></div>}
              <Button type="button" disabled={pending || (!simpleConfirmation && !notes.trim()) || (closure && rhVerificationState === "pending")} onClick={confirmProcessing}>
                {closure && rhVerificationState === "pending" ? <Clock3 aria-hidden /> : <Send aria-hidden />}
                {amendment ? "Confirmar informativo" : closure ? rhVerificationState === "pending" ? "Aguardando confirmação do RH" : "Confirmar baixa" : "Confirmar dados aprovados"}
              </Button>
            </section>
          ) : null}
          {["awaiting_owner", "informative_drafting"].includes(row.status) && row.canPrepareInformative ? <section className="grid gap-2 border-t pt-4"><h3 className="font-medium">Próximo passo</h3><p className="text-xs text-muted-foreground">O Informativo mostrará o resumo da alteração para conferência; acrescente somente alguma missão ou observação adicional, se necessário.</p><Button type="button" disabled={pending} onClick={prepareInformative}><ClipboardPenLine aria-hidden /> {row.status === "informative_drafting" ? "Gerar Informativo novamente" : "Preparar Informativo"}</Button></section> : null}
          {row.status === "informative_drafting" ? <p className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">A preparação do Informativo está aberta. Você pode gerar o texto novamente até criar a prévia em Informativos.</p> : null}
          {row.status === "sent_to_corporate" && row.canClaim ? <Button type="button" disabled={pending} onClick={claim}><UserRoundCheck aria-hidden /> Assumir processamento</Button> : null}
          {row.status === "completed" ? <div className="rounded-md border border-success/30 bg-success/5 p-3 text-sm text-success"><CheckCircle2 className="mr-1 inline size-4" aria-hidden /> Informativo gerado e Fluxo concluído. A confirmação das missões segue em Informativos.</div> : null}
          {row.history.length > 0 ? <section className="grid gap-2 border-t pt-4"><h3 className="font-medium">Histórico</h3>{row.history.map((event) => <div key={event.id} className="rounded-md bg-muted/35 px-3 py-2 text-xs"><span className="font-medium">{eventLabel(event.eventType, row.kind)}</span><span className="text-muted-foreground"> · {event.actorName} · {new Date(event.createdAt).toLocaleString("pt-BR")}</span>{event.note ? <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{event.note}</p> : null}</div>)}</section> : null}
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
  rows,
}: {
  clanId: string;
  canCreate: boolean;
  rows: readonly CompanyFlowView[];
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<CompanyFlowStatus | "all">("all");
  const [view, setView] = useState<"open" | "history">("open");
  const openRows = useMemo(
    () => rows.filter((row) => OPEN_FLOW_STATUSES.includes(row.status)),
    [rows],
  );
  const historyRows = useMemo(
    () => rows.filter((row) => HISTORY_FLOW_STATUSES.includes(row.status)),
    [rows],
  );
  const statusOptions = view === "open" ? OPEN_FLOW_STATUSES : HISTORY_FLOW_STATUSES;
  const visible = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
    const source = view === "open" ? openRows : historyRows;
    return source.filter((row) => {
      const haystack = `${row.requestedLegalName ?? ""} ${row.approvedLegalName ?? ""} ${row.existingClientName ?? ""} ${row.resultCnpj ?? ""}`.toLocaleLowerCase("pt-BR");
      return (
        (!normalizedQuery || haystack.includes(normalizedQuery)) &&
        (status === "all" || row.status === status)
      );
    });
  }, [historyRows, openRows, query, status, view]);

  function changeView(next: "open" | "history") {
    setView(next);
    setStatus("all");
    setQuery("");
  }

  return (
    <div className="grid gap-5">
      <section className="panel-cut flex flex-col gap-5 border-l-2 border-l-primary bg-card/50 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
            <Workflow className="size-5" aria-hidden />
          </span>
          <div>
            <p className="hud-label mb-1">Central de solicitações</p>
            <h2 className="font-heading text-xl font-medium">Fluxo Societário</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Crie pedidos de abertura, alteração e baixa. A tela principal mostra somente o que ainda precisa de ação.
            </p>
          </div>
        </div>
        {canCreate ? <NewCompanyFlowDialog clanId={clanId} /> : null}
      </section>

      <div className="flex w-fit rounded-lg border bg-muted/25 p-1" role="tablist" aria-label="Visão dos fluxos">
        <Button
          type="button"
          variant={view === "open" ? "secondary" : "ghost"}
          aria-pressed={view === "open"}
          onClick={() => changeView("open")}
        >
          <Clock3 aria-hidden /> Em andamento
          <span className="rounded-full bg-background/60 px-1.5 font-mono text-[10px]">{openRows.length}</span>
        </Button>
        <Button
          type="button"
          variant={view === "history" ? "secondary" : "ghost"}
          aria-pressed={view === "history"}
          onClick={() => changeView("history")}
        >
          <Archive aria-hidden /> Concluídos
          <span className="rounded-full bg-background/60 px-1.5 font-mono text-[10px]">{historyRows.length}</span>
        </Button>
      </div>

      {view === "open" ? (
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="rounded-lg border bg-card/35 p-3">
            <span className="text-xs text-muted-foreground">Aguardando atendimento</span>
            <strong className="mt-1 block font-mono text-xl">{openRows.filter((row) => row.status === "sent_to_corporate").length}</strong>
          </div>
          <div className="rounded-lg border bg-card/35 p-3">
            <span className="text-xs text-muted-foreground">Em processamento</span>
            <strong className="mt-1 block font-mono text-xl">{openRows.filter((row) => row.status === "in_progress").length}</strong>
          </div>
          <div className="rounded-lg border bg-card/35 p-3">
            <span className="text-xs text-muted-foreground">Aguardando Informativo</span>
            <strong className="mt-1 block font-mono text-xl">{openRows.filter((row) => ["awaiting_owner", "informative_drafting"].includes(row.status)).length}</strong>
          </div>
        </div>
      ) : (
        <div>
          <h3 className="font-medium">Histórico de fluxos</h3>
          <p className="text-sm text-muted-foreground">Consulte processos concluídos ou cancelados sem misturá-los ao trabalho do dia.</p>
        </div>
      )}

      <div className="grid gap-2 md:grid-cols-[minmax(12rem,1fr)_15rem]">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Buscar nos fluxos ${view === "open" ? "em andamento" : "concluídos"}`} />
        </div>
        <Select value={status} onValueChange={(value) => setStatus(value as CompanyFlowStatus | "all")}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as situações</SelectItem>
            {statusOptions.map((value) => <SelectItem key={value} value={value}>{COMPANY_FLOW_STATUS_LABELS[value]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        {visible.map((row) => (
          <article
            key={row.id}
            className={cn(
              "panel-cut grid gap-3 border-l-2 border-l-primary/45 bg-card/45 p-4 transition-colors hover:bg-accent/25 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center",
              row.status === "cancelled" && "border-l-muted-foreground/40 opacity-70",
            )}
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{COMPANY_FLOW_KIND_LABELS[row.kind]}</Badge>
                <Badge variant="outline" className={STATUS_CLASS[row.status]}>{COMPANY_FLOW_STATUS_LABELS[row.status]}</Badge>
                <RhVerificationBadge state={getRhVerificationState(row)} />
              </div>
              <h3 className="mt-2 truncate text-base font-medium">{row.approvedLegalName ?? row.requestedLegalName ?? row.existingClientName ?? "Empresa"}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{flowStageDescription(row)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {row.resultCnpj ? formatCnpj(row.resultCnpj) : `Origem: ${FLOW_SOURCE_LABELS[row.source]}`}
                {` · Atualizado ${new Date(row.updatedAt).toLocaleDateString("pt-BR")}`}
              </p>
              {row.processingNotes ? <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{row.processingNotes}</p> : null}
            </div>
            <FlowDetailDialog clanId={clanId} row={row} />
          </article>
        ))}
        {visible.length === 0 ? (
          <div className="grid min-h-44 justify-items-center content-center gap-2 rounded-lg border border-dashed p-8 text-center">
            {view === "open" ? <CheckCircle2 className="size-8 text-success" aria-hidden /> : <Archive className="size-8 text-muted-foreground" aria-hidden />}
            <p className="font-medium">{view === "open" ? "Nenhum fluxo em andamento" : "Nenhum fluxo no histórico"}</p>
            <p className="max-w-md text-sm text-muted-foreground">
              {query || status !== "all"
                ? "Tente limpar a busca ou mudar o filtro."
                : view === "open"
                  ? "Quando um novo pedido for criado, ele aparecerá aqui."
                  : "Os fluxos concluídos e cancelados aparecerão nesta área."}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
