"use client";

import { Building2, FileSearch, LoaderCircle, Settings2 } from "lucide-react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatCnpj } from "@/domain/cnpj";
import { formatAppDate } from "@/lib/date-time";
import type { ClientNfseCandidateView, ClientNfseIssuerView } from "@/lib/client-nfse/loaders";
import type { NfseIssuerTemplate } from "@/lib/nfse/template";

import { saveIssuer, suggestIssuerSetup } from "./client-nfse-actions";
import { Choice, Field, NONE, OPTIONS } from "./nfse-settings-dialog";

const REGIMES = [["3", "Optante do Simples (ME/EPP)"], ["1", "Não optante (Presumido ou Real)"]] as const;
const TOTAL_TAXES = [["simples", "Percentual do Simples Nacional"], ["percent", "Percentuais por esfera"], ["none", "Não informar"]] as const;
const CERTIFICATE_LABELS: Record<ClientNfseCandidateView["certificate"], string> = {
  valid: "certificado ok",
  pending: "certificado em conferência",
  invalid: "certificado com problema",
  missing: "sem certificado",
};

/** Série padrão: longe da 1 (a mais usada por outros sistemas) e fora da faixa do Portal (70000+). */
const DEFAULT_SERIES = "900";

function initialForm(template: NfseIssuerTemplate | null, simples = true, cityCode: string | null = null): Record<string, string> {
  const t = template;
  return {
    cityCode: t?.cityCode ?? cityCode ?? "",
    municipalRegistration: t?.municipalRegistration ?? "",
    opSimpNac: t?.taxRegime.opSimpNac === "1" || (!t && !simples) ? "1" : "3",
    regApTribSN: t ? t.taxRegime.regApTribSN ?? NONE : simples ? "1" : NONE,
    regEspTrib: t?.taxRegime.regEspTrib ?? "0",
    nationalTaxCode: t?.service.nationalTaxCode ?? "",
    municipalTaxCode: t?.service.municipalTaxCode ?? "",
    nbsCode: t?.service.nbsCode ?? "",
    taxation: t?.issqn.taxation ?? "1",
    rate: t?.issqn.rate ?? "",
    totalTaxesKind: t?.totalTaxes.kind ?? (simples ? "simples" : "percent"),
    totalTaxesPercent: t?.totalTaxes.kind === "simples" ? t.totalTaxes.percent : "",
    federal: t?.totalTaxes.kind === "percent" ? t.totalTaxes.federal : "",
    state: t?.totalTaxes.kind === "percent" ? t.totalTaxes.state : "0",
    municipal: t?.totalTaxes.kind === "percent" ? t.totalTaxes.municipal : "",
    ibsCbsEnabled: t?.ibsCbs ? "yes" : "no",
    operationIndicator: t?.ibsCbs?.operationIndicator ?? "",
    cst: t?.ibsCbs?.cst ?? "",
    classification: t?.ibsCbs?.classification ?? "",
  };
}

/**
 * O modelo fiscal da empresa emissora: o que não muda de uma nota para outra.
 * Sem empresa (novo), escolhe quem tem CNPJ e não é MEI; o município e o
 * regime vêm sugeridos do cadastro dela.
 */
export function ClientNfseIssuerDialog({
  clanId,
  issuer,
  candidates = [],
  onCreated,
}: {
  clanId: string;
  issuer: ClientNfseIssuerView | null;
  candidates?: readonly ClientNfseCandidateView[];
  /** Empresa nova salva: quem abriu oferece as notas padrão tiradas das notas emitidas. */
  onCreated?: (issuer: { id: string; clientId: string; name: string }) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [clientId, setClientId] = useState(issuer?.clientId ?? "");
  const [series, setSeries] = useState(issuer?.dpsSeries ?? DEFAULT_SERIES);
  const [active, setActive] = useState(issuer?.active ?? true);
  const [form, setForm] = useState<Record<string, string>>(() => initialForm(issuer?.template ?? null));
  const set = (key: string) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  const optional = (value: string) => (value.trim() ? value.trim() : undefined);
  const candidate = candidates.find((item) => item.clientId === clientId) ?? null;
  const [filling, startFilling] = useTransition();
  const [filledFrom, setFilledFrom] = useState<string | null>(null);

  /**
   * Preenche pelo XML da última nota que a empresa emitiu (a rotina da aba XML
   * já guardou): modelo fiscal e, na empresa nova, uma série que ela não usa.
   */
  function fill(targetClientId: string, fallback: { simples: boolean; cityCode: string | null } | null) {
    startFilling(async () => {
      const result = await suggestIssuerSetup({ clanId, clientId: targetClientId, issuerId: issuer?.id ?? null });
      if (!result.ok || !result.data) {
        toast.error(result.ok ? "Sem sugestão." : result.error);
        return;
      }
      const suggestion = result.data;
      if (!issuer) setSeries(suggestion.dpsSeries);
      if (suggestion.template) {
        setForm(initialForm(suggestion.template, fallback?.simples ?? true, fallback?.cityCode ?? null));
        setFilledFrom(`Preenchido pela nota emitida em ${formatAppDate(suggestion.basedOn.lastIssuedAt!)}. Confira antes de salvar.`);
      } else {
        setFilledFrom("Nenhuma nota desta empresa guardada nos últimos meses: preencha com uma nota emitida no Portal.");
      }
    });
  }

  function reset() {
    setClientId(issuer?.clientId ?? "");
    setSeries(issuer?.dpsSeries ?? DEFAULT_SERIES);
    setActive(issuer?.active ?? true);
    setForm(initialForm(issuer?.template ?? null));
    setFilledFrom(null);
  }

  function pickCompany(id: string) {
    setClientId(id);
    const next = candidates.find((item) => item.clientId === id);
    if (!next) return;
    setForm(initialForm(null, next.suggestion.simples, next.suggestion.cityCode));
    setFilledFrom(null);
    fill(id, next.suggestion);
  }

  function save() {
    const template = {
      cityCode: form.cityCode.trim(),
      municipalRegistration: optional(form.municipalRegistration),
      taxRegime: { opSimpNac: form.opSimpNac, regApTribSN: form.regApTribSN === NONE ? undefined : form.regApTribSN, regEspTrib: form.regEspTrib },
      service: { nationalTaxCode: form.nationalTaxCode.trim(), municipalTaxCode: optional(form.municipalTaxCode), nbsCode: optional(form.nbsCode) },
      // Sem retenção na v1: o ISS é do prestador.
      issqn: { taxation: form.taxation, withholding: "1", rate: optional(form.rate) },
      totalTaxes:
        form.totalTaxesKind === "simples"
          ? { kind: "simples", percent: form.totalTaxesPercent.trim() }
          : form.totalTaxesKind === "percent"
            ? { kind: "percent", federal: form.federal.trim(), state: form.state.trim(), municipal: form.municipal.trim() }
            : { kind: "none" },
      ibsCbs:
        form.ibsCbsEnabled === "yes"
          ? { operationIndicator: form.operationIndicator.trim(), cst: form.cst.trim(), classification: form.classification.trim() }
          : undefined,
    } as NfseIssuerTemplate;
    startTransition(async () => {
      const result = await saveIssuer({ clanId, issuerId: issuer?.id ?? null, clientId, template, dpsSeries: series, active });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(issuer ? "Modelo fiscal salvo." : "Empresa adicionada.");
      setOpen(false);
      router.refresh();
      if (!issuer && result.data && candidate) onCreated?.({ id: result.data.issuerId, clientId, name: candidate.name });
    });
  }

  const regimeOptions = form.opSimpNac === "3" ? OPTIONS.regApTribSN : ([[NONE, "Não se aplica"]] as const);
  return (
    <Dialog open={open} onOpenChange={(next) => { if (next) reset(); setOpen(next); }}>
      <DialogTrigger asChild>
        {issuer ? (
          <Button type="button" variant="outline" size="sm"><Settings2 aria-hidden /> Modelo fiscal</Button>
        ) : (
          <Button type="button"><Building2 aria-hidden /> Adicionar empresa emissora</Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{issuer ? `Modelo fiscal · ${issuer.name}` : "Adicionar empresa emissora"}</DialogTitle>
          <DialogDescription>
            O que não muda de uma nota para outra. Copie de uma nota que a empresa já emitiu no Portal Nacional.
          </DialogDescription>
        </DialogHeader>
        {issuer || filling || filledFrom ? <div className="flex flex-wrap items-center gap-2 text-sm" aria-live="polite">
          {issuer ? (
            <Button type="button" variant="outline" size="sm" disabled={filling} onClick={() => fill(issuer.clientId, null)}>
              {filling ? <LoaderCircle className="animate-spin" aria-hidden /> : <FileSearch aria-hidden />} Preencher pela última nota emitida
            </Button>
          ) : null}
          {filling ? <span className="flex items-center gap-1.5 text-muted-foreground"><LoaderCircle className="size-4 animate-spin" aria-hidden /> Lendo as notas emitidas…</span> : null}
          {!filling && filledFrom ? <span className="text-muted-foreground">{filledFrom}</span> : null}
        </div> : null}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {issuer ? null : (
            <div className="sm:col-span-2">
              <Field id="cn-company" label="Empresa" hint={candidate ? `${formatCnpj(candidate.cnpj)} · ${CERTIFICATE_LABELS[candidate.certificate]}` : "Empresas ativas, com CNPJ e fora do MEI. O certificado A1 se envia na aba XML das notas."}>
                <Choice
                  id="cn-company"
                  value={clientId}
                  options={candidates.map((item) => [item.clientId, item.name] as const)}
                  onChange={pickCompany}
                />
              </Field>
            </div>
          )}
          <Field id="cn-series" label="Série da DPS" hint="1 a 49999. Use uma série que a empresa não use em outro sistema; o Portal usa 70000 a 79999.">
            <Input id="cn-series" inputMode="numeric" value={series} onChange={(event) => setSeries(event.target.value)} />
          </Field>
          <Field id="cn-city" label="Município (código IBGE)" hint={form.cityCode ? "Sugerido pelo endereço da empresa; confira." : "7 dígitos."}>
            <Input id="cn-city" inputMode="numeric" value={form.cityCode} onChange={(event) => set("cityCode")(event.target.value)} />
          </Field>
          <Field id="cn-im" label="Inscrição municipal (opcional)"><Input id="cn-im" value={form.municipalRegistration} onChange={(event) => set("municipalRegistration")(event.target.value)} /></Field>
          <Field id="cn-regime" label="Situação no Simples">
            <Choice
              id="cn-regime"
              value={form.opSimpNac}
              options={REGIMES}
              onChange={(value) => setForm((current) => ({
                ...current,
                opSimpNac: value,
                regApTribSN: value === "3" ? "1" : NONE,
                totalTaxesKind: value === "3" ? "simples" : "percent",
              }))}
            />
          </Field>
          <Field id="cn-apuracao" label="Regime de apuração do Simples"><Choice id="cn-apuracao" value={form.regApTribSN} options={regimeOptions} onChange={set("regApTribSN")} /></Field>
          <Field id="cn-especial" label="Regime especial"><Choice id="cn-especial" value={form.regEspTrib} options={OPTIONS.regEspTrib} onChange={set("regEspTrib")} /></Field>
          <Field id="cn-ctrib" label="Código de tributação nacional" hint="6 dígitos (item, subitem, desdobro). Cada nota padrão pode usar outro."><Input id="cn-ctrib" inputMode="numeric" value={form.nationalTaxCode} onChange={(event) => set("nationalTaxCode")(event.target.value)} /></Field>
          <Field id="cn-cmun" label="Código municipal (opcional)" hint="O que vem depois da barra no Portal, ex.: 06.01.01 / 001."><Input id="cn-cmun" inputMode="numeric" value={form.municipalTaxCode} onChange={(event) => set("municipalTaxCode")(event.target.value)} /></Field>
          <Field id="cn-nbs" label="Código NBS (opcional)"><Input id="cn-nbs" inputMode="numeric" value={form.nbsCode} onChange={(event) => set("nbsCode")(event.target.value)} /></Field>
          <Field id="cn-iss" label="Tributação do ISS"><Choice id="cn-iss" value={form.taxation} options={OPTIONS.taxation} onChange={set("taxation")} /></Field>
          <Field id="cn-aliq" label="Alíquota do ISS (opcional)" hint="Formato 2.00. Sem retenção: o ISS é da empresa."><Input id="cn-aliq" inputMode="decimal" value={form.rate} onChange={(event) => set("rate")(event.target.value)} /></Field>
          <Field id="cn-tot" label="Total de tributos"><Choice id="cn-tot" value={form.totalTaxesKind} options={TOTAL_TAXES} onChange={set("totalTaxesKind")} /></Field>
          {form.totalTaxesKind === "simples" ? (
            <Field id="cn-totpct" label="Percentual do Simples" hint="Alíquota efetiva do DAS da empresa, no formato 6.00."><Input id="cn-totpct" inputMode="decimal" value={form.totalTaxesPercent} onChange={(event) => set("totalTaxesPercent")(event.target.value)} /></Field>
          ) : null}
          {form.totalTaxesKind === "percent" ? (
            <>
              <Field id="cn-fed" label="% federal" hint="Formato 13.45."><Input id="cn-fed" inputMode="decimal" value={form.federal} onChange={(event) => set("federal")(event.target.value)} /></Field>
              <Field id="cn-est" label="% estadual"><Input id="cn-est" inputMode="decimal" value={form.state} onChange={(event) => set("state")(event.target.value)} /></Field>
              <Field id="cn-mun" label="% municipal"><Input id="cn-mun" inputMode="decimal" value={form.municipal} onChange={(event) => set("municipal")(event.target.value)} /></Field>
            </>
          ) : null}
          <Field id="cn-ibscbs" label="IBS/CBS (Reforma tributária)" hint="Se o Portal já preenche nas notas da empresa, informe."><Choice id="cn-ibscbs" value={form.ibsCbsEnabled} options={OPTIONS.ibsCbs} onChange={set("ibsCbsEnabled")} /></Field>
          {form.ibsCbsEnabled === "yes" ? (
            <>
              <Field id="cn-indop" label="Indicador de operação" hint="6 dígitos."><Input id="cn-indop" inputMode="numeric" value={form.operationIndicator} onChange={(event) => set("operationIndicator")(event.target.value)} /></Field>
              <Field id="cn-cst" label="CST do IBS/CBS" hint="3 dígitos."><Input id="cn-cst" inputMode="numeric" value={form.cst} onChange={(event) => set("cst")(event.target.value)} /></Field>
              <Field id="cn-cclass" label="Classificação tributária" hint="6 dígitos."><Input id="cn-cclass" inputMode="numeric" value={form.classification} onChange={(event) => set("classification")(event.target.value)} /></Field>
            </>
          ) : null}
          {issuer ? (
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" className="size-4 accent-primary" checked={active} onChange={(event) => setActive(event.target.checked)} />
              Ativa (desmarque para parar de abrir as notas desta empresa no mês)
            </label>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>Voltar</Button>
          <Button type="button" disabled={pending || filling || !clientId} onClick={save}>
            {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : null} {issuer ? "Salvar modelo" : "Adicionar empresa"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
