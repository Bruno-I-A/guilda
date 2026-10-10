"use client";

import { LoaderCircle, Settings2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { CnpjInput } from "@/components/ui/cnpj-input";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { NfseTemplate } from "@/lib/nfse/template";

import { saveNfseSettings } from "./nfse-actions";
import type { NfseSettingsPanelView } from "./nfse-panel";

const NONE = "none";

const OPTIONS = {
  opSimpNac: [["1", "Não optante"], ["2", "MEI"], ["3", "Optante ME/EPP"]],
  regApTribSN: [[NONE, "Não informar"], ["1", "Federais e ISS pelo Simples"], ["2", "Federais pelo Simples, ISS por fora"], ["3", "Federais e ISS por fora"]],
  regEspTrib: [["0", "Nenhum"], ["1", "Ato cooperado"], ["2", "Estimativa"], ["3", "Microempresa municipal"], ["4", "Notário ou registrador"], ["5", "Profissional autônomo"], ["6", "Sociedade de profissionais"], ["9", "Outros"]],
  taxation: [["1", "Operação tributável"], ["2", "Imunidade"], ["3", "Exportação de serviço"], ["4", "Não incidência"]],
  withholding: [["1", "Não retido"], ["2", "Retido pelo tomador"], ["3", "Retido pelo intermediário"]],
  totalTaxes: [["none", "Não informar valor de tributos"], ["simples", "Percentual do Simples Nacional"]],
} as const;

const DEFAULTS = {
  monthly: "Honorários contábeis referentes à competência {competencia}.",
  additionalInstallment: "Parcela adicional de honorários contábeis de {ano}.",
};

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

function Choice({ id, value, options, onChange }: { id: string; value: string; options: readonly (readonly [string, string])[]; onChange: (value: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id}><SelectValue /></SelectTrigger>
      <SelectContent>{options.map(([optionValue, label]) => <SelectItem key={optionValue} value={optionValue}>{label}</SelectItem>)}</SelectContent>
    </Select>
  );
}

/** Modelo da nota do escritório (admin). Na etapa 3 ele nasce do XML de uma nota real. */
export function NfseSettingsDialog({ clanId, settings }: { clanId: string; settings: NfseSettingsPanelView | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const t: Partial<NfseTemplate> = settings?.template ?? {};
  // Tudo string no formulário; o Zod da action valida o modelo de verdade.
  const [form, setForm] = useState<Record<string, string>>({
    providerCnpj: settings?.providerCnpj ?? "",
    dpsSeries: settings?.dpsSeries ?? "1",
    cityCode: t.cityCode ?? "",
    municipalRegistration: t.municipalRegistration ?? "",
    opSimpNac: t.taxRegime?.opSimpNac ?? "3",
    regApTribSN: t.taxRegime?.regApTribSN ?? NONE,
    regEspTrib: t.taxRegime?.regEspTrib ?? "0",
    nationalTaxCode: t.service?.nationalTaxCode ?? "171901",
    municipalTaxCode: t.service?.municipalTaxCode ?? "",
    nbsCode: t.service?.nbsCode ?? "",
    taxation: t.issqn?.taxation ?? "1",
    withholding: t.issqn?.withholding ?? "1",
    rate: t.issqn?.rate ?? "",
    totalTaxesKind: t.totalTaxes?.kind ?? "none",
    totalTaxesPercent: t.totalTaxes?.kind === "simples" ? t.totalTaxes.percent : "",
    monthly: t.descriptions?.monthly ?? DEFAULTS.monthly,
    additionalInstallment: t.descriptions?.additionalInstallment ?? DEFAULTS.additionalInstallment,
  });
  const set = (key: string) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  const optional = (value: string) => (value.trim() ? value.trim() : undefined);

  function save() {
    const template = {
      cityCode: form.cityCode.trim(),
      municipalRegistration: optional(form.municipalRegistration),
      taxRegime: {
        opSimpNac: form.opSimpNac,
        regApTribSN: form.regApTribSN === NONE ? undefined : form.regApTribSN,
        regEspTrib: form.regEspTrib,
      },
      service: { nationalTaxCode: form.nationalTaxCode.trim(), municipalTaxCode: optional(form.municipalTaxCode), nbsCode: optional(form.nbsCode) },
      issqn: { taxation: form.taxation, withholding: form.withholding, rate: optional(form.rate) },
      totalTaxes: form.totalTaxesKind === "simples" ? { kind: "simples", percent: form.totalTaxesPercent.trim() } : { kind: "none" },
      descriptions: { monthly: form.monthly, additionalInstallment: form.additionalInstallment },
    } as NfseTemplate;
    startTransition(async () => {
      const result = await saveNfseSettings({ clanId, providerCnpj: form.providerCnpj, dpsSeries: form.dpsSeries.trim(), template });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Modelo da nota salvo.");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline"><Settings2 aria-hidden /> Modelo da nota</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Modelo da nota de honorário</DialogTitle>
          <DialogDescription>O que não muda de uma nota para outra. Copie de uma nota já emitida no Portal Nacional.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id="nfse-cnpj" label="CNPJ do escritório"><CnpjInput id="nfse-cnpj" value={form.providerCnpj} onValueChange={set("providerCnpj")} /></Field>
          <Field id="nfse-series" label="Série da DPS" hint="1 a 49999. O Emissor Web usa 70000 a 79999."><Input id="nfse-series" inputMode="numeric" value={form.dpsSeries} onChange={(event) => set("dpsSeries")(event.target.value)} /></Field>
          <Field id="nfse-city" label="Município (código IBGE)" hint="7 dígitos."><Input id="nfse-city" inputMode="numeric" value={form.cityCode} onChange={(event) => set("cityCode")(event.target.value)} /></Field>
          <Field id="nfse-im" label="Inscrição municipal (opcional)"><Input id="nfse-im" value={form.municipalRegistration} onChange={(event) => set("municipalRegistration")(event.target.value)} /></Field>
          <Field id="nfse-simples" label="Situação no Simples"><Choice id="nfse-simples" value={form.opSimpNac} options={OPTIONS.opSimpNac} onChange={set("opSimpNac")} /></Field>
          <Field id="nfse-apuracao" label="Regime de apuração do Simples"><Choice id="nfse-apuracao" value={form.regApTribSN} options={OPTIONS.regApTribSN} onChange={set("regApTribSN")} /></Field>
          <Field id="nfse-especial" label="Regime especial"><Choice id="nfse-especial" value={form.regEspTrib} options={OPTIONS.regEspTrib} onChange={set("regEspTrib")} /></Field>
          <Field id="nfse-ctrib" label="Código de tributação nacional" hint="6 dígitos (item, subitem, desdobro)."><Input id="nfse-ctrib" inputMode="numeric" value={form.nationalTaxCode} onChange={(event) => set("nationalTaxCode")(event.target.value)} /></Field>
          <Field id="nfse-cmun" label="Código municipal (opcional)"><Input id="nfse-cmun" inputMode="numeric" value={form.municipalTaxCode} onChange={(event) => set("municipalTaxCode")(event.target.value)} /></Field>
          <Field id="nfse-nbs" label="Código NBS (opcional)"><Input id="nfse-nbs" inputMode="numeric" value={form.nbsCode} onChange={(event) => set("nbsCode")(event.target.value)} /></Field>
          <Field id="nfse-iss" label="Tributação do ISS"><Choice id="nfse-iss" value={form.taxation} options={OPTIONS.taxation} onChange={set("taxation")} /></Field>
          <Field id="nfse-ret" label="Retenção do ISS"><Choice id="nfse-ret" value={form.withholding} options={OPTIONS.withholding} onChange={set("withholding")} /></Field>
          <Field id="nfse-aliq" label="Alíquota do ISS (opcional)" hint="Formato 2.00."><Input id="nfse-aliq" inputMode="decimal" value={form.rate} onChange={(event) => set("rate")(event.target.value)} /></Field>
          <Field id="nfse-tot" label="Total de tributos"><Choice id="nfse-tot" value={form.totalTaxesKind} options={OPTIONS.totalTaxes} onChange={set("totalTaxesKind")} /></Field>
          {form.totalTaxesKind === "simples" ? (
            <Field id="nfse-totpct" label="Percentual do Simples" hint="Formato 6.00."><Input id="nfse-totpct" inputMode="decimal" value={form.totalTaxesPercent} onChange={(event) => set("totalTaxesPercent")(event.target.value)} /></Field>
          ) : null}
          <div className="sm:col-span-2"><Field id="nfse-desc" label="Descrição da nota mensal" hint="{competencia} vira MM/AAAA."><Textarea id="nfse-desc" rows={2} value={form.monthly} onChange={(event) => set("monthly")(event.target.value)} /></Field></div>
          <div className="sm:col-span-2"><Field id="nfse-desc-pa" label="Descrição da PA" hint="{ano} vira AAAA."><Textarea id="nfse-desc-pa" rows={2} value={form.additionalInstallment} onChange={(event) => set("additionalInstallment")(event.target.value)} /></Field></div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>Voltar</Button>
          <Button type="button" disabled={pending} onClick={save}>{pending ? <LoaderCircle className="animate-spin" aria-hidden /> : null} Salvar modelo</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
