"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { amountToCents } from "@/domain/nfse";
import { hasNfseRetentions, retentionBreakdown, RETENTION_PERCENT_PATTERN, type NfseRetentions } from "@/domain/nfse-retentions";
import { formatBRLCurrency } from "@/lib/currency";

import { saveTakerRetentions } from "./client-nfse-actions";
import { Field } from "./nfse-settings-dialog";

/** O formulário das retenções: percentuais como a pessoa digita ("1,5"). */
export interface RetentionForm {
  issWithheld: boolean;
  issRate: string;
  irrf: string;
  cp: string;
  pis: string;
  cofins: string;
  csll: string;
  pisCofinsCst: string;
}

const PERCENT_FIELDS = [
  ["irrf", "IR"],
  ["cp", "INSS"],
  ["pis", "PIS"],
  ["cofins", "COFINS"],
  ["csll", "CSLL"],
] as const;

function shown(value: string | null): string {
  return value ? value.replace(".", ",") : "";
}

export function retentionForm(retentions: NfseRetentions | null | undefined): RetentionForm {
  return {
    issWithheld: retentions?.issWithheld ?? false,
    issRate: shown(retentions?.issRate ?? null),
    irrf: shown(retentions?.irrf ?? null),
    cp: shown(retentions?.cp ?? null),
    pis: shown(retentions?.pis ?? null),
    cofins: shown(retentions?.cofins ?? null),
    csll: shown(retentions?.csll ?? null),
    pisCofinsCst: retentions?.pisCofinsCst ?? "01",
  };
}

function percent(value: string): string | null {
  const text = value.trim().replace(",", ".");
  return text ? text : null;
}

/** O que vai ao servidor; null = nota sem retenção. */
export function formToRetentions(form: RetentionForm): NfseRetentions | null {
  const retentions: NfseRetentions = {
    issWithheld: form.issWithheld,
    issRate: form.issWithheld ? percent(form.issRate) : null,
    irrf: percent(form.irrf),
    cp: percent(form.cp),
    pis: percent(form.pis),
    cofins: percent(form.cofins),
    csll: percent(form.csll),
    pisCofinsCst: form.pisCofinsCst.trim() || "01",
  };
  return hasNfseRetentions(retentions) ? retentions : null;
}

/** Problema do formulário em português, ou null quando dá para enviar. */
export function retentionProblem(form: RetentionForm): string | null {
  const values = formToRetentions(form);
  if (!values) return null;
  if (values.issWithheld && (!values.issRate || Number(values.issRate) <= 0)) return "Com ISS retido, informe a alíquota do ISS.";
  if (values.issRate && Number(values.issRate) > 5) return "A alíquota do ISS vai até 5%.";
  for (const key of ["issRate", "irrf", "cp", "pis", "cofins", "csll"] as const) {
    const value = values[key];
    if (value && !RETENTION_PERCENT_PATTERN.test(value)) return "Percentual de retenção no formato 1,50.";
  }
  if ((values.pis || values.cofins) && !/^[0-9]{2}$/.test(values.pisCofinsCst)) return "O CST do PIS/COFINS tem 2 dígitos.";
  return null;
}

function cents(amount: string): number | null {
  try {
    return amount ? amountToCents(amount) : null;
  } catch {
    return null;
  }
}

/** O que a nota retém e quanto sobra para a empresa receber. */
export function RetentionSummary({ form, amount }: { form: RetentionForm; amount: string }) {
  const values = formToRetentions(form);
  const total = cents(amount);
  if (!values || total === null || retentionProblem(form)) return null;
  const lines = retentionBreakdown(values, total);
  if (lines.length === 0) return null;
  const withheld = lines.reduce((sum, line) => sum + line.cents, 0);
  return (
    <dl className="grid gap-1 rounded-md border bg-muted/30 p-3 text-sm">
      {lines.map((line) => (
        <div key={line.label} className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Retido {line.label}</dt>
          <dd className="font-mono tabular-nums">{formatBRLCurrency((line.cents / 100).toFixed(2))}</dd>
        </div>
      ))}
      <div className="flex justify-between gap-3 border-t pt-1 font-medium">
        <dt>Líquido a receber</dt>
        <dd className="font-mono tabular-nums">{formatBRLCurrency(((total - withheld) / 100).toFixed(2))}</dd>
      </div>
    </dl>
  );
}

/** "ISS 2% · IR 1,5%" — o que a configuração retém, em uma linha. */
export function retentionLabel(retentions: NfseRetentions | null | undefined): string {
  if (!retentions || !hasNfseRetentions(retentions)) return "Sem retenções";
  const parts: string[] = [];
  if (retentions.issWithheld && retentions.issRate) parts.push(`ISS ${shown(retentions.issRate)}%`);
  for (const [key, label] of PERCENT_FIELDS) {
    const value = retentions[key];
    if (value && Number(value) > 0) parts.push(`${label} ${shown(value)}%`);
  }
  return `Retém ${parts.join(" · ")}`;
}

/** Os campos das retenções: ISS retido pelo tomador e os percentuais federais. */
export function RetentionFields({ id, form, onChange }: { id: string; form: RetentionForm; onChange: (next: RetentionForm) => void }) {
  const set = (key: keyof RetentionForm) => (event: React.ChangeEvent<HTMLInputElement>) => onChange({ ...form, [key]: event.target.value });
  const pisCofins = Boolean(percent(form.pis) || percent(form.cofins));
  const problem = retentionProblem(form);
  return (
    <div className="grid gap-3">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4 accent-primary" checked={form.issWithheld} onChange={(event) => onChange({ ...form, issWithheld: event.target.checked })} />
        ISS retido pelo tomador
      </label>
      {form.issWithheld ? (
        <Field id={`${id}-iss`} label="Alíquota do ISS (%)" hint="Ex.: 2 ou 2,5.">
          <Input id={`${id}-iss`} inputMode="decimal" className="max-w-32 font-mono" value={form.issRate} onChange={set("issRate")} />
        </Field>
      ) : null}
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm">Retenções federais (%) · deixe em branco o que não retém</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {PERCENT_FIELDS.map(([key, label]) => (
            <Field key={key} id={`${id}-${key}`} label={label}>
              <Input id={`${id}-${key}`} inputMode="decimal" className="font-mono" placeholder="0" value={form[key]} onChange={set(key)} />
            </Field>
          ))}
        </div>
      </fieldset>
      {pisCofins ? (
        <Field id={`${id}-cst`} label="CST do PIS/COFINS" hint="2 dígitos; 01 é a operação tributável com alíquota básica.">
          <Input id={`${id}-cst`} inputMode="numeric" maxLength={2} className="max-w-20 font-mono" value={form.pisCofinsCst} onChange={set("pisCofinsCst")} />
        </Field>
      ) : null}
      {problem ? <p role="alert" className="text-sm text-destructive">{problem}</p> : null}
    </div>
  );
}

/** Retenções do tomador, editadas na lista de tomadores: valem para as próximas notas dele. */
export function TakerRetentionsDialog({
  clanId,
  taker,
  onOpenChange,
}: {
  clanId: string;
  taker: { id: string; name: string; retentions: NfseRetentions | null };
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState<RetentionForm>(() => retentionForm(taker.retentions));
  const [saving, startSaving] = useTransition();
  const problem = retentionProblem(form);

  function save() {
    startSaving(async () => {
      const result = await saveTakerRetentions({ clanId, takerId: taker.id, retentions: formToRetentions(form) });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Retenções de ${taker.name} gravadas. Valem para as próximas notas.`);
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!saving) onOpenChange(open); }}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Retenções · {taker.name}</DialogTitle>
          <DialogDescription>O que as notas para este cliente retêm. Na emissão dá para ajustar uma nota só.</DialogDescription>
        </DialogHeader>
        <RetentionFields id={`taker-${taker.id}`} form={form} onChange={setForm} />
        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>Voltar</Button>
          <Button type="button" disabled={saving || Boolean(problem)} onClick={save}>
            {saving ? <LoaderCircle className="animate-spin" aria-hidden /> : null} Gravar retenções
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
