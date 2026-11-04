"use client";

import { FileSearch, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ClientNfseIssuerView } from "@/lib/client-nfse/loaders";
import { formatAppDate } from "@/lib/date-time";

import { saveIssuer, suggestIssuerSetup } from "./client-nfse-actions";
import { FiscalFields, FiscalSummary, fiscalFormToTemplate, initialFiscalForm, type FiscalForm } from "./client-nfse-fiscal-form";

/** Dados fiscais de uma empresa já cadastrada: resumo, formulário e "preencher pela última nota". */
export function ClientNfseIssuerDialog({
  clanId,
  issuer,
  open,
  onOpenChange,
}: {
  clanId: string;
  issuer: ClientNfseIssuerView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [filling, startFilling] = useTransition();
  const [series, setSeries] = useState(issuer.dpsSeries);
  const [active, setActive] = useState(issuer.active);
  const [form, setForm] = useState<FiscalForm>(() => initialFiscalForm(issuer.template));
  const [cityLabel, setCityLabel] = useState(issuer.cityLabel);
  const [filledFrom, setFilledFrom] = useState<string | null>(null);

  function changeOpen(next: boolean) {
    if (next) {
      setSeries(issuer.dpsSeries);
      setActive(issuer.active);
      setForm(initialFiscalForm(issuer.template));
      setCityLabel(issuer.cityLabel);
      setFilledFrom(null);
    }
    onOpenChange(next);
  }

  function fill() {
    startFilling(async () => {
      const result = await suggestIssuerSetup({ clanId, clientId: issuer.clientId, issuerId: issuer.id });
      if (!result.ok || !result.data) {
        toast.error(result.ok ? "Sem sugestão." : result.error);
        return;
      }
      if (!result.data.template) {
        setFilledFrom("Nenhuma nota desta empresa guardada nos últimos meses.");
        return;
      }
      setForm(initialFiscalForm(result.data.template));
      setCityLabel(result.data.cityLabel);
      setFilledFrom(`Preenchido pela nota de ${formatAppDate(result.data.basedOn.lastIssuedAt!)}. Confira e salve.`);
    });
  }

  function save() {
    startTransition(async () => {
      const result = await saveIssuer({ clanId, issuerId: issuer.id, clientId: issuer.clientId, template: fiscalFormToTemplate(form), dpsSeries: series, active });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Dados fiscais salvos.");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Dados fiscais · {issuer.name}</DialogTitle>
          <DialogDescription>O que não muda de uma nota para outra desta empresa.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2 text-sm" aria-live="polite">
          <Button type="button" variant="outline" size="sm" disabled={filling} onClick={fill}>
            {filling ? <LoaderCircle className="animate-spin" aria-hidden /> : <FileSearch aria-hidden />} Preencher pela última nota emitida
          </Button>
          {filledFrom ? <span className="text-muted-foreground">{filledFrom}</span> : null}
        </div>
        <FiscalSummary form={form} series={series} cityLabel={cityLabel} />
        <FiscalFields form={form} onChange={(next) => { setForm(next); if (next.cityCode !== form.cityCode) setCityLabel(null); }} series={series} onSeriesChange={setSeries} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-primary" checked={active} onChange={(event) => setActive(event.target.checked)} />
          Ativa (desmarque para as notas desta empresa saírem da tela)
        </label>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Voltar</Button>
          <Button type="button" disabled={pending || filling} onClick={save}>
            {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : null} Salvar dados fiscais
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
