"use client";

import { FilePenLine, FileText, History } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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
import type { FiscalApplicability } from "@/domain/fiscal-control";

import { saveFiscalClientProfile } from "./fiscal-actions";

export interface FiscalProfileHistoryView {
  id: string;
  version: number;
  eventType: "created" | "updated" | "backfilled" | "imported";
  actorName: string | null;
  changedFields: readonly string[];
  createdAt: string;
}

export interface FiscalProfileView {
  id: string | null;
  version: number;
  movementsApplicability: FiscalApplicability;
  incomingApplicability: FiscalApplicability;
  outgoingApplicability: FiscalApplicability;
  guideApplicability: FiscalApplicability;
  nfsApplicability: FiscalApplicability;
  factorRApplicability: FiscalApplicability;
  deliveryChannel: string | null;
  revenueReference: string | null;
  permanentNotes: string | null;
  missingFields: readonly string[];
  history: readonly FiscalProfileHistoryView[];
}

const APPLICABILITY_OPTIONS = [
  { value: "unknown", label: "Não informado" },
  { value: "required", label: "Sim" },
  { value: "not_required", label: "Não" },
  { value: "not_applicable", label: "Não se aplica" },
] as const;

const FIELD_LABELS: Record<string, string> = {
  movementsApplicability: "Movimentos",
  incomingApplicability: "Entrada",
  outgoingApplicability: "Saída",
  guideApplicability: "Guia",
  nfsApplicability: "NFS",
  factorRApplicability: "Fator R",
  deliveryChannel: "Entrega",
  revenueReference: "Referência de faturamento",
  permanentNotes: "Observações",
};

function ApplicabilityField({
  id,
  label,
  value,
  disabled,
  onValueChange,
}: {
  id: string;
  label: string;
  value: FiscalApplicability;
  disabled: boolean;
  onValueChange: (value: FiscalApplicability) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value}
        disabled={disabled}
        onValueChange={(next) => onValueChange(next as FiscalApplicability)}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {APPLICABILITY_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function eventLabel(value: FiscalProfileHistoryView["eventType"]): string {
  if (value === "backfilled") return "Recuperada";
  if (value === "imported") return "Importada";
  if (value === "created") return "Criada";
  return "Atualizada";
}

export function FiscalProfileDialog({
  clanId,
  clientId,
  clientName,
  profile,
  canManage,
}: {
  clanId: string;
  clientId: string;
  clientName: string;
  profile: FiscalProfileView;
  canManage: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [movements, setMovements] = useState(profile.movementsApplicability);
  const [incoming, setIncoming] = useState(profile.incomingApplicability);
  const [outgoing, setOutgoing] = useState(profile.outgoingApplicability);
  const [guide, setGuide] = useState(profile.guideApplicability);
  const [nfs, setNfs] = useState(profile.nfsApplicability);
  const [factorR, setFactorR] = useState(profile.factorRApplicability);
  const [delivery, setDelivery] = useState(profile.deliveryChannel ?? "");
  const [revenue, setRevenue] = useState(profile.revenueReference ?? "");
  const [notes, setNotes] = useState(profile.permanentNotes ?? "");
  const hasUnknown = [movements, incoming, outgoing, guide, nfs, factorR].some(
    (value) => value === "unknown",
  );

  function resetFromProfile() {
    setMovements(profile.movementsApplicability);
    setIncoming(profile.incomingApplicability);
    setOutgoing(profile.outgoingApplicability);
    setGuide(profile.guideApplicability);
    setNfs(profile.nfsApplicability);
    setFactorR(profile.factorRApplicability);
    setDelivery(profile.deliveryChannel ?? "");
    setRevenue(profile.revenueReference ?? "");
    setNotes(profile.permanentNotes ?? "");
  }

  function save() {
    startTransition(async () => {
      const result = await saveFiscalClientProfile({
        clanId,
        clientId,
        expectedVersion: profile.id ? profile.version : null,
        movementsApplicability: movements,
        incomingApplicability: incoming,
        outgoingApplicability: outgoing,
        guideApplicability: guide,
        nfsApplicability: nfs,
        factorRApplicability: factorR,
        deliveryChannel: delivery,
        revenueReference: revenue,
        permanentNotes: notes,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Ficha Fiscal atualizada.");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) resetFromProfile();
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          {canManage ? <FilePenLine aria-hidden /> : <FileText aria-hidden />}
          Ficha
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Ficha Fiscal · {clientName}</DialogTitle>
          <DialogDescription>
            Regras permanentes da empresa. Trocar o responsável da carteira
            não altera estas informações.
          </DialogDescription>
        </DialogHeader>

        {profile.missingFields.length > 0 ? (
          <div className="rounded-lg border border-warning/35 bg-warning/10 p-3 text-xs">
            Ficha incompleta: revise {profile.missingFields.join(", ")}.
          </div>
        ) : null}

        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <ApplicabilityField id={`${clientId}-movements`} label="Movimentos" value={movements} disabled={!canManage} onValueChange={setMovements} />
            <ApplicabilityField id={`${clientId}-incoming`} label="Entrada" value={incoming} disabled={!canManage} onValueChange={setIncoming} />
            <ApplicabilityField id={`${clientId}-outgoing`} label="Saída" value={outgoing} disabled={!canManage} onValueChange={setOutgoing} />
            <ApplicabilityField id={`${clientId}-guide`} label="Guia" value={guide} disabled={!canManage} onValueChange={setGuide} />
            <ApplicabilityField id={`${clientId}-nfs`} label="NFS" value={nfs} disabled={!canManage} onValueChange={setNfs} />
            <ApplicabilityField id={`${clientId}-factor-r`} label="Controla Fator R" value={factorR} disabled={!canManage} onValueChange={setFactorR} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor={`${clientId}-delivery`}>Forma de entrega</Label>
              <Input
                id={`${clientId}-delivery`}
                value={delivery}
                disabled={!canManage}
                maxLength={120}
                placeholder="Onvio, malote, e-mail, pessoa…"
                onChange={(event) => setDelivery(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${clientId}-revenue`}>Referência de faturamento</Label>
              <CurrencyInput
                id={`${clientId}-revenue`}
                value={revenue}
                disabled={!canManage}
                onValueChange={setRevenue}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={`${clientId}-notes`}>Observações permanentes</Label>
            <Textarea
              id={`${clientId}-notes`}
              value={notes}
              disabled={!canManage}
              maxLength={4000}
              rows={4}
              placeholder="Limites, certificados, Fator R e cuidados recorrentes…"
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>

          {profile.history.length > 0 ? (
            <section className="grid gap-2 border-t pt-3">
              <h3 className="flex items-center gap-1.5 text-sm font-medium">
                <History className="size-4" aria-hidden /> Histórico da ficha
              </h3>
              <ul className="grid gap-1.5">
                {profile.history.map((event) => (
                  <li key={event.id} className="flex flex-wrap items-center gap-2 rounded-md bg-muted/35 px-2.5 py-2 text-xs">
                    <Badge variant="outline">v{event.version}</Badge>
                    <span>{eventLabel(event.eventType)}</span>
                    <span className="text-muted-foreground">
                      por {event.actorName ?? "migração"} · {event.createdAt}
                    </span>
                    {event.changedFields.length > 0 ? (
                      <span className="basis-full text-muted-foreground">
                        {event.changedFields.map((field) => FIELD_LABELS[field] ?? field).join(", ")}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        {canManage ? (
          <DialogFooter>
            <Button type="button" disabled={pending || hasUnknown || !delivery.trim()} onClick={save}>
              Salvar ficha
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
