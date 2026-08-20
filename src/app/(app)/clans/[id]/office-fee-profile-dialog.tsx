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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { OfficeFeeBillingMethod } from "@/domain/office-fee-control";

import { saveOfficeFeeProfile } from "./office-fee-actions";

export interface OfficeFeeProfileHistoryView {
  id: string;
  version: number;
  eventType: "created" | "updated" | "imported";
  actorName: string | null;
  changedFields: readonly string[];
  createdAt: string;
}

export interface OfficeFeeProfileView {
  id: string | null;
  version: number;
  billingMethod: OfficeFeeBillingMethod;
  chargesAdditionalInstallment: boolean;
  monthlyFee: string;
  permanentNotes: string | null;
  history: readonly OfficeFeeProfileHistoryView[];
}

const BILLING_METHODS: Array<{ value: OfficeFeeBillingMethod; label: string }> = [
  { value: "asaas", label: "Asaas" },
  { value: "recibo", label: "Recibo" },
  { value: "pix", label: "Pix" },
  { value: "other", label: "Outro" },
];

const FIELD_LABELS: Record<string, string> = {
  billingMethod: "Cobrança",
  chargesAdditionalInstallment: "Parcela adicional",
  monthlyFee: "Honorário mensal",
  permanentNotes: "Observações",
};

export const OFFICE_FEE_BILLING_LABELS: Record<OfficeFeeBillingMethod, string> = {
  asaas: "Asaas",
  recibo: "Recibo",
  pix: "Pix",
  other: "Outro",
};

function eventLabel(event: OfficeFeeProfileHistoryView["eventType"]): string {
  if (event === "created") return "Criado";
  if (event === "imported") return "Importado";
  return "Atualizado";
}

export function OfficeFeeProfileDialog({
  clanId,
  clientId,
  clientName,
  profile,
  canManage,
  triggerLabel,
}: {
  clanId: string;
  clientId: string;
  clientName: string;
  profile: OfficeFeeProfileView | null;
  canManage: boolean;
  triggerLabel?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [billingMethod, setBillingMethod] = useState<OfficeFeeBillingMethod>(
    profile?.billingMethod ?? "asaas",
  );
  const [additionalInstallment, setAdditionalInstallment] = useState(
    profile?.chargesAdditionalInstallment ? "yes" : "no",
  );
  const [monthlyFee, setMonthlyFee] = useState(profile?.monthlyFee ?? "");
  const [notes, setNotes] = useState(profile?.permanentNotes ?? "");

  function reset() {
    setBillingMethod(profile?.billingMethod ?? "asaas");
    setAdditionalInstallment(profile?.chargesAdditionalInstallment ? "yes" : "no");
    setMonthlyFee(profile?.monthlyFee ?? "");
    setNotes(profile?.permanentNotes ?? "");
  }

  function save() {
    startTransition(async () => {
      const result = await saveOfficeFeeProfile({
        clanId,
        clientId,
        expectedVersion: profile?.id ? profile.version : null,
        billingMethod,
        chargesAdditionalInstallment: additionalInstallment === "yes",
        monthlyFee,
        permanentNotes: notes,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(profile ? "Honorário atualizado." : "Honorário cadastrado.");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) reset();
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant={triggerLabel ? "outline" : "ghost"} size="sm">
          {canManage ? <FilePenLine aria-hidden /> : <FileText aria-hidden />}
          {triggerLabel ?? (canManage ? "Editar" : "Ver")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Honorário do escritório · {clientName}</DialogTitle>
          <DialogDescription>
            Esta regra é permanente. O fechamento de cada mês guarda um retrato
            dela antes de alguém marcar as etapas como concluídas.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor={`${clientId}-billing-method`}>Cobrança</Label>
              <Select value={billingMethod} disabled={!canManage} onValueChange={(value) => setBillingMethod(value as OfficeFeeBillingMethod)}>
                <SelectTrigger id={`${clientId}-billing-method`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BILLING_METHODS.map((method) => <SelectItem key={method.value} value={method.value}>{method.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${clientId}-additional-installment`}>Cobra parcela adicional?</Label>
              <Select value={additionalInstallment} disabled={!canManage} onValueChange={setAdditionalInstallment}>
                <SelectTrigger id={`${clientId}-additional-installment`}><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="yes">Sim</SelectItem><SelectItem value="no">Não</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${clientId}-monthly-fee`}>Honorário mensal</Label>
            <CurrencyInput
              id={`${clientId}-monthly-fee`}
              value={monthlyFee}
              disabled={!canManage}
              onValueChange={setMonthlyFee}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${clientId}-office-fee-notes`}>Observações</Label>
            <Textarea
              id={`${clientId}-office-fee-notes`}
              value={notes}
              disabled={!canManage}
              maxLength={4000}
              rows={4}
              placeholder="Rateios, exceções de mês, empresas agrupadas e cuidados na emissão…"
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
          {profile?.history.length ? (
            <section className="grid gap-2 border-t pt-3">
              <h3 className="flex items-center gap-1.5 text-sm font-medium"><History className="size-4" aria-hidden /> Histórico do honorário</h3>
              <ul className="grid gap-1.5">
                {profile.history.map((event) => (
                  <li key={event.id} className="flex flex-wrap items-center gap-2 rounded-md bg-muted/35 px-2.5 py-2 text-xs">
                    <Badge variant="outline">v{event.version}</Badge>
                    <span>{eventLabel(event.eventType)}</span>
                    <span className="text-muted-foreground">por {event.actorName ?? "migração"} · {event.createdAt}</span>
                    {event.changedFields.length > 0 ? <span className="basis-full text-muted-foreground">{event.changedFields.map((field) => FIELD_LABELS[field] ?? field).join(", ")}</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
        {canManage ? (
          <DialogFooter>
            <Button type="button" disabled={pending || !monthlyFee} onClick={save}>Salvar honorário</Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
