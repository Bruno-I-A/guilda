"use client";

import { ChevronDown, LoaderCircle, Search, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatCnpj, normalizeCnpj, validateTaxDocument } from "@/domain/cnpj";
import { clientNfseMonthDescription, type ClientNfseReference } from "@/domain/client-nfse";
import type { ClientNfseIssuerView, ClientNfseNoteView } from "@/lib/client-nfse/loaders";
import { cn } from "@/lib/utils";

import { deleteModel, lookupTakerCnpj, saveNote } from "./client-nfse-actions";
import { Choice, Field } from "./nfse-settings-dialog";

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"] as const;
const REFERENCES = [["previous", "Ao mês anterior"], ["current", "Ao próprio mês"]] as const;

type Address = { zipCode: string; street: string; number: string; complement: string; district: string; city: string; state: string };

function addressForm(address: ClientNfseNoteView["takerAddress"]): Address {
  return {
    zipCode: address?.zipCode ?? "",
    street: address?.street ?? "",
    number: address?.number ?? "",
    complement: address?.complement ?? "",
    district: address?.district ?? "",
    city: address?.city ?? "",
    state: address?.state ?? "",
  };
}

/**
 * A nota padrão com o tomador no mesmo formulário. Digitar o CPF/CNPJ de quem
 * já recebe nota desta empresa reaproveita o tomador; CNPJ novo se consulta.
 */
export function ClientNfseNoteDialog({
  clanId,
  issuer,
  note,
  period,
  open,
  onOpenChange,
}: {
  clanId: string;
  issuer: ClientNfseIssuerView;
  note: ClientNfseNoteView | null;
  period: { year: number; month: number };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [looking, startLooking] = useTransition();
  const [document, setDocument] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState<Address>(addressForm(null));
  const [amount, setAmount] = useState("");
  const [text, setText] = useState("");
  const [reference, setReference] = useState<ClientNfseReference>("previous");
  const [more, setMore] = useState(false);
  const [ownService, setOwnService] = useState(false);
  const [service, setService] = useState({ nationalTaxCode: "", municipalTaxCode: "", nbsCode: "" });
  const [active, setActive] = useState(true);
  const digits = normalizeCnpj(document);
  const documentOk = validateTaxDocument(digits);
  const known = new Map(issuer.notes.map((item) => [item.takerDocument, item]));

  function changeOpen(next: boolean) {
    if (next) {
      setDocument(note ? formatCnpj(note.takerDocument) : "");
      setName(note?.takerName ?? "");
      setAddress(addressForm(note?.takerAddress ?? null));
      setAmount(note?.model.amount ?? "");
      setText(note?.model.description ?? "");
      setReference(note?.model.reference ?? "previous");
      setOwnService(Boolean(note?.model.service));
      setService({
        nationalTaxCode: note?.model.service?.nationalTaxCode ?? issuer.template?.service.nationalTaxCode ?? "",
        municipalTaxCode: note?.model.service?.municipalTaxCode ?? issuer.template?.service.municipalTaxCode ?? "",
        nbsCode: note?.model.service?.nbsCode ?? issuer.template?.service.nbsCode ?? "",
      });
      setActive(note?.model.active ?? true);
      setMore(false);
    }
    onOpenChange(next);
  }

  /** CPF/CNPJ de quem já recebe nota desta empresa: traz nome e endereço. */
  function onDocumentBlur() {
    if (!documentOk) return;
    setDocument(formatCnpj(digits));
    const taker = known.get(digits);
    if (taker && !name.trim()) {
      setName(taker.takerName);
      setAddress(addressForm(taker.takerAddress));
    }
  }

  function lookup() {
    startLooking(async () => {
      const result = await lookupTakerCnpj({ clanId, cnpj: digits });
      if (!result.ok || !result.data) {
        toast.error(result.ok ? "Consulta vazia." : result.error);
        return;
      }
      setName(result.data.name);
      if (result.data.address) setAddress(addressForm(result.data.address));
      toast.success("Nome e endereço preenchidos pela consulta do CNPJ.");
    });
  }

  function run(action: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error ?? "Não deu certo.");
        return;
      }
      toast.success(success);
      onOpenChange(false);
      router.refresh();
    });
  }

  const blank = (value: string) => value.trim() || null;
  const preview = text.trim() ? clientNfseMonthDescription(text, period, reference) : "";
  const field = (key: keyof Address) => (event: React.ChangeEvent<HTMLInputElement>) => setAddress((current) => ({ ...current, [key]: event.target.value }));
  const id = note?.modelId ?? `new-${issuer.id}`;

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{note ? "Nota padrão" : "Nova nota"} · {issuer.name}</DialogTitle>
          <DialogDescription>Sai todo mês. Valor e texto de um mês só se ajustam direto na linha.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <Field id={`${id}-doc`} label="CPF ou CNPJ do tomador">
              <Input id={`${id}-doc`} value={document} inputMode="numeric" autoComplete="off" data-1p-ignore data-lpignore="true" onChange={(event) => setDocument(event.target.value)} onBlur={onDocumentBlur} />
            </Field>
            <Button type="button" variant="outline" className="self-end" disabled={looking || digits.length !== 14 || !documentOk} onClick={lookup}>
              {looking ? <LoaderCircle className="animate-spin" aria-hidden /> : <Search aria-hidden />} Consultar CNPJ
            </Button>
          </div>
          {digits.length > 0 && !documentOk ? <p className="text-xs text-destructive">CPF ou CNPJ inválido.</p> : null}
          <Field id={`${id}-name`} label="Nome na nota"><Input id={`${id}-name`} value={name} maxLength={200} autoComplete="off" onChange={(event) => setName(event.target.value)} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-amount`}>Valor</Label>
              <CurrencyInput id={`${id}-amount`} value={amount} onValueChange={setAmount} />
            </div>
            <Field id={`${id}-ref`} label="A nota se refere">
              <Choice id={`${id}-ref`} value={reference} options={REFERENCES} onChange={(value) => setReference(value as ClientNfseReference)} />
            </Field>
          </div>
          <Field id={`${id}-text`} label="Descrição do serviço" hint="{mes} vira o mês (MM/AAAA) e {ano} o ano.">
            <Textarea id={`${id}-text`} rows={3} maxLength={2000} value={text} placeholder="SERVIÇOS PRESTADOS REFERENTE A {mes}" onChange={(event) => setText(event.target.value)} />
          </Field>
          {preview ? (
            <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <span className="hud-label mr-2">Em {MONTHS[period.month - 1]}</span>
              {preview}
            </p>
          ) : null}
          <Button type="button" variant="ghost" size="sm" className="justify-self-start" aria-expanded={more} onClick={() => setMore((value) => !value)}>
            <ChevronDown className={cn("transition-transform", more && "rotate-180")} aria-hidden /> Endereço, serviço e pausa
          </Button>
          {more ? (
            <div className="grid gap-3">
              <fieldset className="grid gap-3 rounded-md border p-3">
                <legend className="px-1 text-xs text-muted-foreground">Endereço do tomador (obrigatório quando a nota leva IBS/CBS)</legend>
                <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
                  <Field id={`${id}-zip`} label="CEP"><Input id={`${id}-zip`} value={address.zipCode} inputMode="numeric" autoComplete="off" onChange={field("zipCode")} /></Field>
                  <Field id={`${id}-street`} label="Rua"><Input id={`${id}-street`} value={address.street} autoComplete="off" onChange={field("street")} /></Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-[6rem_1fr_1fr]">
                  <Field id={`${id}-number`} label="Número"><Input id={`${id}-number`} value={address.number} autoComplete="off" onChange={field("number")} /></Field>
                  <Field id={`${id}-complement`} label="Complemento"><Input id={`${id}-complement`} value={address.complement} autoComplete="off" onChange={field("complement")} /></Field>
                  <Field id={`${id}-district`} label="Bairro"><Input id={`${id}-district`} value={address.district} autoComplete="off" onChange={field("district")} /></Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-[1fr_5rem]">
                  <Field id={`${id}-city`} label="Cidade"><Input id={`${id}-city`} value={address.city} autoComplete="off" onChange={field("city")} /></Field>
                  <Field id={`${id}-state`} label="UF"><Input id={`${id}-state`} value={address.state} maxLength={2} autoComplete="off" onChange={field("state")} /></Field>
                </div>
              </fieldset>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-primary" checked={ownService} onChange={(event) => setOwnService(event.target.checked)} />
                Esta nota usa outro serviço (não o dos dados fiscais da empresa)
              </label>
              {ownService ? (
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field id={`${id}-ctrib`} label="Tributação nacional" hint="6 dígitos."><Input id={`${id}-ctrib`} inputMode="numeric" value={service.nationalTaxCode} onChange={(event) => setService((current) => ({ ...current, nationalTaxCode: event.target.value }))} /></Field>
                  <Field id={`${id}-cmun`} label="Municipal" hint="Opcional."><Input id={`${id}-cmun`} inputMode="numeric" value={service.municipalTaxCode} onChange={(event) => setService((current) => ({ ...current, municipalTaxCode: event.target.value }))} /></Field>
                  <Field id={`${id}-nbs`} label="NBS" hint="Opcional."><Input id={`${id}-nbs`} inputMode="numeric" value={service.nbsCode} onChange={(event) => setService((current) => ({ ...current, nbsCode: event.target.value }))} /></Field>
                </div>
              ) : null}
              {note ? (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4 accent-primary" checked={active} onChange={(event) => setActive(event.target.checked)} />
                  Ativa (desmarque para pausar: a nota some dos próximos meses)
                </label>
              ) : null}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          {note ? (
            <Button
              type="button"
              variant="ghost"
              className="touch-target mr-auto text-destructive"
              disabled={pending}
              onClick={() => {
                if (!window.confirm(`Apagar a nota padrão de ${note.takerName}? Se ela já gerou nota, pause em vez de apagar.`)) return;
                run(() => deleteModel({ clanId, id: note.modelId }), "Nota padrão apagada.");
              }}
            >
              <Trash2 aria-hidden /> Apagar
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Voltar</Button>
          <Button
            type="button"
            disabled={pending || !documentOk || !name.trim() || !amount || !text.trim()}
            onClick={() =>
              run(
                () =>
                  saveNote({
                    clanId,
                    issuerId: issuer.id,
                    modelId: note?.modelId ?? null,
                    taker: {
                      document: digits,
                      name,
                      address: {
                        street: blank(address.street),
                        number: blank(address.number),
                        complement: blank(address.complement),
                        district: blank(address.district),
                        city: blank(address.city),
                        state: blank(address.state),
                        zipCode: blank(address.zipCode),
                      },
                    },
                    amount,
                    description: text,
                    reference,
                    service: ownService
                      ? { nationalTaxCode: service.nationalTaxCode.trim(), municipalTaxCode: service.municipalTaxCode.trim() || undefined, nbsCode: service.nbsCode.trim() || undefined }
                      : null,
                    active,
                  }),
                note ? "Nota padrão salva." : "Nota cadastrada. Ela já aparece no mês.",
              )
            }
          >
            {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : null} {note ? "Salvar nota" : "Cadastrar nota"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
