"use client";

import { Input } from "@/components/ui/input";
import { nfseConstructionSchema, type NfseConstruction } from "@/lib/nfse/template";

import { Choice, Field } from "./nfse-settings-dialog";

/**
 * A obra da nota (E0370): nos serviços de obra o Sistema Nacional exige saber
 * qual obra é. Identifica-se pelo CNO (ou CEI), pelo endereço da obra ou pelo
 * CIB, com a inscrição imobiliária opcional. Usado no formulário de emissão e
 * na correção da nota com erro.
 */

const KINDS = [
  ["cno", "CNO ou CEI"],
  ["address", "Endereço da obra"],
  ["cib", "CIB"],
] as const;

export interface ConstructionForm {
  kind: NfseConstruction["kind"];
  code: string;
  zipCode: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  propertyRegistration: string;
}

export function constructionForm(value: NfseConstruction | null | undefined): ConstructionForm {
  return {
    kind: value?.kind ?? "cno",
    code: value && value.kind !== "address" ? value.code : "",
    zipCode: value?.kind === "address" ? value.zipCode : "",
    street: value?.kind === "address" ? value.street : "",
    number: value?.kind === "address" ? value.number : "",
    complement: value?.kind === "address" ? (value.complement ?? "") : "",
    district: value?.kind === "address" ? value.district : "",
    propertyRegistration: value?.propertyRegistration ?? "",
  };
}

/** O formulário vira a obra conferida pela mesma regra do servidor, ou o primeiro problema. */
export function readConstruction(form: ConstructionForm): { ok: true; value: NfseConstruction } | { ok: false; error: string } {
  const raw =
    form.kind === "address"
      ? { kind: form.kind, zipCode: form.zipCode, street: form.street, number: form.number, complement: form.complement, district: form.district, propertyRegistration: form.propertyRegistration }
      : { kind: form.kind, code: form.code, propertyRegistration: form.propertyRegistration };
  const parsed = nfseConstructionSchema.safeParse(raw);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: parsed.error.issues[0]?.message ?? "Confira os dados da obra." };
}

/** Uma linha para a conferência antes de emitir. */
export function constructionSummary(value: NfseConstruction): string {
  const main =
    value.kind === "cno"
      ? `CNO/CEI ${value.code}`
      : value.kind === "cib"
        ? `CIB ${value.code}`
        : `${value.street}, ${value.number}${value.complement ? ` (${value.complement})` : ""} · ${value.district} · CEP ${value.zipCode.replace(/^(\d{5})(\d{3})$/, "$1-$2")}`;
  return value.propertyRegistration ? `${main} · inscrição imobiliária ${value.propertyRegistration}` : main;
}

export function ConstructionFields({ id, form, onChange }: { id: string; form: ConstructionForm; onChange: (form: ConstructionForm) => void }) {
  const set = (key: keyof ConstructionForm) => (event: React.ChangeEvent<HTMLInputElement>) => onChange({ ...form, [key]: event.target.value });
  return (
    <fieldset className="grid gap-3 rounded-md border p-3">
      <legend className="px-1 text-sm font-medium">Obra desta nota · obrigatória neste serviço</legend>
      <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
        <Field id={`${id}-kind`} label="Identificar por">
          <Choice id={`${id}-kind`} value={form.kind} options={KINDS} onChange={(kind) => onChange({ ...form, kind: kind as ConstructionForm["kind"] })} />
        </Field>
        {form.kind === "cno" ? (
          <Field id={`${id}-code`} label="Número do CNO ou CEI" hint="Como está no cadastro da obra; pontos e barras são ignorados.">
            <Input id={`${id}-code`} value={form.code} inputMode="numeric" autoComplete="off" onChange={set("code")} />
          </Field>
        ) : form.kind === "cib" ? (
          <Field id={`${id}-code`} label="CIB" hint="Cadastro Imobiliário Brasileiro, 8 caracteres.">
            <Input id={`${id}-code`} value={form.code} maxLength={8} autoComplete="off" onChange={set("code")} />
          </Field>
        ) : (
          <Field id={`${id}-zip`} label="CEP da obra">
            <Input id={`${id}-zip`} value={form.zipCode} inputMode="numeric" autoComplete="off" onChange={set("zipCode")} />
          </Field>
        )}
      </div>
      {form.kind === "address" ? (
        <>
          <Field id={`${id}-street`} label="Rua">
            <Input id={`${id}-street`} value={form.street} maxLength={255} autoComplete="off" onChange={set("street")} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-[6rem_1fr_1fr]">
            <Field id={`${id}-number`} label="Número">
              <Input id={`${id}-number`} value={form.number} maxLength={60} autoComplete="off" onChange={set("number")} />
            </Field>
            <Field id={`${id}-complement`} label="Complemento">
              <Input id={`${id}-complement`} value={form.complement} maxLength={156} autoComplete="off" onChange={set("complement")} />
            </Field>
            <Field id={`${id}-district`} label="Bairro">
              <Input id={`${id}-district`} value={form.district} maxLength={60} autoComplete="off" onChange={set("district")} />
            </Field>
          </div>
        </>
      ) : null}
      <Field id={`${id}-insc`} label="Inscrição imobiliária" hint="Opcional. A da prefeitura para a obra ou o IPTU.">
        <Input id={`${id}-insc`} value={form.propertyRegistration} maxLength={30} autoComplete="off" onChange={set("propertyRegistration")} />
      </Field>
    </fieldset>
  );
}
