"use client";

import type { ReactNode } from "react";

import { Input } from "@/components/ui/input";
import type { NfseIssuerTemplate } from "@/lib/nfse/template";

import { Choice, Field, NONE, OPTIONS } from "./nfse-settings-dialog";

/**
 * Os dados fiscais da empresa emissora: o resumo em uma linha (o que se
 * confere de relance) e o formulário em blocos, que só abre para editar.
 */

export type FiscalForm = Record<string, string>;

const REGIMES = [["3", "Optante do Simples (ME/EPP)"], ["1", "Não optante (Presumido ou Real)"]] as const;
const TOTAL_TAXES = [["simples", "Percentual do Simples Nacional"], ["percent", "Percentuais por esfera"], ["none", "Não informar"]] as const;

export function initialFiscalForm(template: NfseIssuerTemplate | null, fallback: { simples: boolean; cityCode: string | null } = { simples: true, cityCode: null }): FiscalForm {
  const t = template;
  const simples = t ? t.taxRegime.opSimpNac !== "1" : fallback.simples;
  return {
    cityCode: t?.cityCode ?? fallback.cityCode ?? "",
    municipalRegistration: t?.municipalRegistration ?? "",
    opSimpNac: simples ? "3" : "1",
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

export function fiscalFormToTemplate(form: FiscalForm): NfseIssuerTemplate {
  const optional = (value: string) => (value.trim() ? value.trim() : undefined);
  return {
    cityCode: form.cityCode.trim(),
    municipalRegistration: optional(form.municipalRegistration),
    taxRegime: { opSimpNac: form.opSimpNac, regApTribSN: form.regApTribSN === NONE ? undefined : form.regApTribSN, regEspTrib: form.regEspTrib },
    service: { nationalTaxCode: form.nationalTaxCode.trim(), municipalTaxCode: optional(form.municipalTaxCode), nbsCode: optional(form.nbsCode) },
    // Sem retenção na v1: o ISS é da empresa.
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
}

/** "060101" → "06.01.01". */
function serviceCode(code: string): string {
  return /^\d{6}$/.test(code) ? `${code.slice(0, 2)}.${code.slice(2, 4)}.${code.slice(4)}` : code;
}

function percentLabel(value: string): string {
  return `${value.replace(".", ",")}%`;
}

/** Os dados fiscais de relance: uma etiqueta por informação. */
export function FiscalSummary({ form, series, cityLabel }: { form: FiscalForm; series: string; cityLabel: string | null }) {
  const items: { label: string; value: string | null; wide?: boolean }[] = [
    { label: "Município", value: cityLabel ?? (form.cityCode ? `IBGE ${form.cityCode}` : null) },
    { label: "Regime", value: form.opSimpNac === "3" ? "Simples ME/EPP" : "Não optante" },
    {
      label: "Tributos",
      value:
        form.totalTaxesKind === "simples"
          ? form.totalTaxesPercent ? `DAS ${percentLabel(form.totalTaxesPercent)}` : null
          : form.totalTaxesKind === "percent"
            ? `${percentLabel(form.federal || "0")} fed · ${percentLabel(form.state || "0")} est · ${percentLabel(form.municipal || "0")} mun`
            : "não informados",
    },
    { label: "Serviço", value: form.nationalTaxCode ? `${serviceCode(form.nationalTaxCode)}${form.municipalTaxCode ? ` / ${form.municipalTaxCode}` : ""}` : null },
    { label: "ISS", value: form.rate ? percentLabel(form.rate) : "sem alíquota" },
    { label: "IBS/CBS", value: form.ibsCbsEnabled === "yes" ? `${form.operationIndicator} · ${form.cst} · ${form.classification}` : "não informa" },
    { label: "Série DPS", value: series || null, wide: true },
  ];
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border/70 bg-border/40 sm:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className={item.wide ? "grid min-w-0 gap-0.5 bg-card/80 px-3 py-2 sm:col-span-2" : "grid min-w-0 gap-0.5 bg-card/80 px-3 py-2"}>
          <dt className="hud-label">{item.label}</dt>
          <dd className={item.value ? "font-mono text-sm break-words" : "text-sm text-warning"}>{item.value ?? "faltando"}</dd>
        </div>
      ))}
    </dl>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="grid gap-3 border-t pt-3 first:border-t-0 first:pt-0">
      <legend className="hud-label float-left mb-1 w-full">{title}</legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

/** O formulário completo, em blocos: prestador, serviço, tributos, reforma e numeração. */
export function FiscalFields({
  form,
  onChange,
  series,
  onSeriesChange,
}: {
  form: FiscalForm;
  onChange: (next: FiscalForm) => void;
  series: string;
  onSeriesChange: (value: string) => void;
}) {
  const set = (key: string) => (value: string) => onChange({ ...form, [key]: value });
  const text = (key: string) => (event: React.ChangeEvent<HTMLInputElement>) => set(key)(event.target.value);
  const regimeOptions = form.opSimpNac === "3" ? OPTIONS.regApTribSN : ([[NONE, "Não se aplica"]] as const);
  return (
    <div className="grid gap-4">
      <Block title="Prestador">
        <Field id="cn-city" label="Município (código IBGE)" hint="7 dígitos."><Input id="cn-city" inputMode="numeric" value={form.cityCode} onChange={text("cityCode")} /></Field>
        <Field id="cn-im" label="Inscrição municipal (opcional)"><Input id="cn-im" value={form.municipalRegistration} onChange={text("municipalRegistration")} /></Field>
        <Field id="cn-regime" label="Situação no Simples">
          <Choice
            id="cn-regime"
            value={form.opSimpNac}
            options={REGIMES}
            onChange={(value) => onChange({ ...form, opSimpNac: value, regApTribSN: value === "3" ? "1" : NONE, totalTaxesKind: value === "3" ? "simples" : "percent" })}
          />
        </Field>
        <Field id="cn-apuracao" label="Regime de apuração do Simples"><Choice id="cn-apuracao" value={form.regApTribSN} options={regimeOptions} onChange={set("regApTribSN")} /></Field>
        <Field id="cn-especial" label="Regime especial"><Choice id="cn-especial" value={form.regEspTrib} options={OPTIONS.regEspTrib} onChange={set("regEspTrib")} /></Field>
      </Block>
      <Block title="Serviço">
        <Field id="cn-ctrib" label="Tributação nacional" hint="6 dígitos. Cada nota pode usar outro."><Input id="cn-ctrib" inputMode="numeric" value={form.nationalTaxCode} onChange={text("nationalTaxCode")} /></Field>
        <Field id="cn-cmun" label="Código municipal (opcional)" hint="O que vem depois da barra no Portal."><Input id="cn-cmun" inputMode="numeric" value={form.municipalTaxCode} onChange={text("municipalTaxCode")} /></Field>
        <Field id="cn-nbs" label="NBS (opcional)"><Input id="cn-nbs" inputMode="numeric" value={form.nbsCode} onChange={text("nbsCode")} /></Field>
        <Field id="cn-iss" label="Tributação do ISS"><Choice id="cn-iss" value={form.taxation} options={OPTIONS.taxation} onChange={set("taxation")} /></Field>
        <Field id="cn-aliq" label="Alíquota do ISS (opcional)" hint="Formato 2.00. Sem retenção."><Input id="cn-aliq" inputMode="decimal" value={form.rate} onChange={text("rate")} /></Field>
      </Block>
      <Block title="Tributos aproximados">
        <Field id="cn-tot" label="Total de tributos"><Choice id="cn-tot" value={form.totalTaxesKind} options={TOTAL_TAXES} onChange={set("totalTaxesKind")} /></Field>
        {form.totalTaxesKind === "simples" ? (
          <Field id="cn-totpct" label="Percentual do Simples" hint="Alíquota efetiva do DAS, formato 6.00."><Input id="cn-totpct" inputMode="decimal" value={form.totalTaxesPercent} onChange={text("totalTaxesPercent")} /></Field>
        ) : null}
        {form.totalTaxesKind === "percent" ? (
          <>
            <Field id="cn-fed" label="% federal" hint="Formato 13.45."><Input id="cn-fed" inputMode="decimal" value={form.federal} onChange={text("federal")} /></Field>
            <Field id="cn-est" label="% estadual"><Input id="cn-est" inputMode="decimal" value={form.state} onChange={text("state")} /></Field>
            <Field id="cn-mun" label="% municipal"><Input id="cn-mun" inputMode="decimal" value={form.municipal} onChange={text("municipal")} /></Field>
          </>
        ) : null}
      </Block>
      <Block title="Reforma tributária">
        <Field id="cn-ibscbs" label="IBS/CBS" hint="Informe se o Portal já preenche nas notas da empresa."><Choice id="cn-ibscbs" value={form.ibsCbsEnabled} options={OPTIONS.ibsCbs} onChange={set("ibsCbsEnabled")} /></Field>
        {form.ibsCbsEnabled === "yes" ? (
          <>
            <Field id="cn-indop" label="Indicador de operação" hint="6 dígitos."><Input id="cn-indop" inputMode="numeric" value={form.operationIndicator} onChange={text("operationIndicator")} /></Field>
            <Field id="cn-cst" label="CST" hint="3 dígitos."><Input id="cn-cst" inputMode="numeric" value={form.cst} onChange={text("cst")} /></Field>
            <Field id="cn-cclass" label="Classificação tributária" hint="6 dígitos."><Input id="cn-cclass" inputMode="numeric" value={form.classification} onChange={text("classification")} /></Field>
          </>
        ) : null}
      </Block>
      <Block title="Numeração">
        <Field id="cn-series" label="Série da DPS" hint="1 a 49999, uma que a empresa não use em outro sistema (o Portal usa 70000+).">
          <Input id="cn-series" inputMode="numeric" value={series} onChange={(event) => onSeriesChange(event.target.value)} />
        </Field>
      </Block>
    </div>
  );
}
