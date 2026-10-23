"use client";

import { FilePenLine, FilePlus2, LoaderCircle, Search, Trash2, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatCnpj, normalizeCnpj, validateTaxDocument } from "@/domain/cnpj";
import { clientNfseMonthDescription, type ClientNfseReference } from "@/domain/client-nfse";
import type { ClientNfseIssuerView, ClientNfseModelView, ClientNfseTakerView } from "@/lib/client-nfse/loaders";

import { deleteModel, deleteTaker, lookupTakerCnpj, saveModel, saveTaker } from "./client-nfse-actions";
import { Choice, Field } from "./nfse-settings-dialog";

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"] as const;

type Address = { zipCode: string; street: string; number: string; complement: string; district: string; city: string; state: string };

function addressForm(address: ClientNfseTakerView["address"]): Address {
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

function useRun(onDone: () => void) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function run(action: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error ?? "Não deu certo.");
        return;
      }
      toast.success(success);
      onDone();
      router.refresh();
    });
  }
  return { pending, run };
}

function DeleteButton({ pending, onClick, children }: { pending: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Button type="button" variant="ghost" className="touch-target mr-auto text-destructive" disabled={pending} onClick={onClick}>
      <Trash2 aria-hidden /> {children}
    </Button>
  );
}

/** Tomador da empresa emissora: quem recebe a nota. */
export function ClientNfseTakerDialog({ clanId, issuerId, taker }: { clanId: string; issuerId: string; taker: ClientNfseTakerView | null }) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useRun(() => setOpen(false));
  const [looking, startLooking] = useTransition();
  const [name, setName] = useState("");
  const [document, setDocument] = useState("");
  const [address, setAddress] = useState<Address>(addressForm(null));
  const [active, setActive] = useState(true);
  const digits = normalizeCnpj(document);
  const documentOk = validateTaxDocument(digits);
  const idBase = taker?.id ?? `new-${issuerId}`;

  function reset() {
    setName(taker?.name ?? "");
    setDocument(taker ? formatCnpj(taker.document) : "");
    setAddress(addressForm(taker?.address ?? null));
    setActive(taker?.active ?? true);
  }

  function lookup() {
    startLooking(async () => {
      const result = await lookupTakerCnpj({ clanId, cnpj: digits });
      if (!result.ok || !result.data) {
        toast.error(result.ok ? "Consulta vazia." : result.error);
        return;
      }
      if (!name.trim()) setName(result.data.name);
      if (result.data.address) setAddress(addressForm(result.data.address));
      toast.success("Nome e endereço preenchidos pela consulta do CNPJ.");
    });
  }

  const field = (key: keyof Address) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setAddress((current) => ({ ...current, [key]: event.target.value }));
  const blank = (value: string) => value.trim() || null;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (next) reset(); setOpen(next); }}>
      <DialogTrigger asChild>
        {taker ? (
          <Button type="button" variant="ghost" size="sm" className="touch-target"><FilePenLine aria-hidden /> Editar</Button>
        ) : (
          <Button type="button" variant="outline" size="sm"><UserPlus aria-hidden /> Novo tomador</Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{taker ? `Tomador · ${taker.name}` : "Novo tomador"}</DialogTitle>
          <DialogDescription>Quem recebe a nota desta empresa. Com CNPJ, a consulta preenche nome e endereço.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <Field id={`${idBase}-doc`} label="CPF ou CNPJ">
              <Input
                id={`${idBase}-doc`}
                value={document}
                inputMode="numeric"
                autoComplete="off"
                onChange={(event) => setDocument(event.target.value)}
                onBlur={() => { if (documentOk) setDocument(formatCnpj(digits)); }}
              />
            </Field>
            <Button type="button" variant="outline" className="self-end" disabled={looking || digits.length !== 14 || !documentOk} onClick={lookup}>
              {looking ? <LoaderCircle className="animate-spin" aria-hidden /> : <Search aria-hidden />} Consultar CNPJ
            </Button>
          </div>
          {digits.length > 0 && !documentOk ? <p className="text-xs text-destructive">CPF ou CNPJ inválido.</p> : null}
          <Field id={`${idBase}-name`} label="Nome na nota"><Input id={`${idBase}-name`} value={name} maxLength={200} autoComplete="off" onChange={(event) => setName(event.target.value)} /></Field>
          <fieldset className="grid gap-3 rounded-md border p-3">
            <legend className="px-1 text-xs text-muted-foreground">Endereço (obrigatório quando a nota leva IBS/CBS)</legend>
            <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
              <Field id={`${idBase}-zip`} label="CEP"><Input id={`${idBase}-zip`} value={address.zipCode} inputMode="numeric" autoComplete="off" onChange={field("zipCode")} /></Field>
              <Field id={`${idBase}-street`} label="Rua"><Input id={`${idBase}-street`} value={address.street} autoComplete="off" onChange={field("street")} /></Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-[6rem_1fr_1fr]">
              <Field id={`${idBase}-number`} label="Número"><Input id={`${idBase}-number`} value={address.number} autoComplete="off" onChange={field("number")} /></Field>
              <Field id={`${idBase}-complement`} label="Complemento"><Input id={`${idBase}-complement`} value={address.complement} autoComplete="off" onChange={field("complement")} /></Field>
              <Field id={`${idBase}-district`} label="Bairro"><Input id={`${idBase}-district`} value={address.district} autoComplete="off" onChange={field("district")} /></Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_5rem]">
              <Field id={`${idBase}-city`} label="Cidade"><Input id={`${idBase}-city`} value={address.city} autoComplete="off" onChange={field("city")} /></Field>
              <Field id={`${idBase}-state`} label="UF"><Input id={`${idBase}-state`} value={address.state} maxLength={2} autoComplete="off" onChange={field("state")} /></Field>
            </div>
          </fieldset>
          {taker ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-primary" checked={active} onChange={(event) => setActive(event.target.checked)} />
              Ativo (desmarque para as notas dele pararem de abrir no mês)
            </label>
          ) : null}
        </div>
        <DialogFooter>
          {taker ? (
            <DeleteButton
              pending={pending}
              onClick={() => {
                if (!window.confirm(`Apagar ${taker.name}? As notas padrão dele saem junto. Com nota já pedida, desative em vez de apagar.`)) return;
                run(() => deleteTaker({ clanId, id: taker.id }), "Tomador apagado.");
              }}
            >
              Apagar
            </DeleteButton>
          ) : null}
          <Button
            type="button"
            disabled={pending || !name.trim() || !documentOk}
            onClick={() =>
              run(
                () =>
                  saveTaker({
                    clanId,
                    issuerId,
                    takerId: taker?.id ?? null,
                    name,
                    document: digits,
                    address: {
                      street: blank(address.street),
                      number: blank(address.number),
                      complement: blank(address.complement),
                      district: blank(address.district),
                      city: blank(address.city),
                      state: blank(address.state),
                      zipCode: blank(address.zipCode),
                    },
                    active,
                  }),
                taker ? "Tomador atualizado." : "Tomador cadastrado.",
              )
            }
          >
            {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : null} {taker ? "Salvar tomador" : "Cadastrar tomador"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const REFERENCES = [["previous", "Ao mês anterior (em novembro, 10/2026)"], ["current", "Ao próprio mês (em novembro, 11/2026)"]] as const;
const SERVICE_MODES = [["issuer", "O do modelo fiscal da empresa"], ["own", "Outro serviço só nesta nota"]] as const;

/** A nota que se repete todo mês: tomador, valor, descrição e a referência. */
export function ClientNfseModelDialog({
  clanId,
  issuer,
  model,
  period,
}: {
  clanId: string;
  issuer: ClientNfseIssuerView;
  model: ClientNfseModelView | null;
  /** O mês de hoje, para mostrar como a descrição vai sair. */
  period: { year: number; month: number };
}) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useRun(() => setOpen(false));
  const [takerId, setTakerId] = useState("");
  const [amount, setAmount] = useState("");
  const [text, setText] = useState("");
  const [reference, setReference] = useState<ClientNfseReference>("previous");
  const [serviceMode, setServiceMode] = useState<"issuer" | "own">("issuer");
  const [service, setService] = useState({ nationalTaxCode: "", municipalTaxCode: "", nbsCode: "" });
  const [active, setActive] = useState(true);
  const takers = issuer.takers.filter((taker) => taker.active || taker.id === model?.takerId);
  const idBase = model?.id ?? `new-model-${issuer.id}`;

  function reset() {
    setTakerId(model?.takerId ?? takers[0]?.id ?? "");
    setAmount(model?.amount ?? "");
    setText(model?.description ?? "SERVIÇOS PRESTADOS REFERENTE A {mes}");
    setReference(model?.reference ?? "previous");
    setServiceMode(model?.service ? "own" : "issuer");
    setService({
      nationalTaxCode: model?.service?.nationalTaxCode ?? issuer.template?.service.nationalTaxCode ?? "",
      municipalTaxCode: model?.service?.municipalTaxCode ?? issuer.template?.service.municipalTaxCode ?? "",
      nbsCode: model?.service?.nbsCode ?? issuer.template?.service.nbsCode ?? "",
    });
    setActive(model?.active ?? true);
  }

  const preview = text.trim() ? clientNfseMonthDescription(text, period, reference) : "";
  return (
    <Dialog open={open} onOpenChange={(next) => { if (next) reset(); setOpen(next); }}>
      <DialogTrigger asChild>
        {model ? (
          <Button type="button" variant="ghost" size="sm" className="touch-target"><FilePenLine aria-hidden /> Editar</Button>
        ) : (
          <Button type="button" variant="outline" size="sm" disabled={issuer.takers.length === 0} title={issuer.takers.length === 0 ? "Cadastre um tomador antes." : undefined}>
            <FilePlus2 aria-hidden /> Nova nota padrão
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{model ? "Nota padrão" : "Nova nota padrão"} · {issuer.name}</DialogTitle>
          <DialogDescription>Sai todo mês ao abrir o mês. Valor e descrição ainda se ajustam no mês, sem mudar o padrão.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field id={`${idBase}-taker`} label="Tomador">
            <Choice id={`${idBase}-taker`} value={takerId} options={takers.map((taker) => [taker.id, `${taker.name} · ${formatCnpj(taker.document)}`] as const)} onChange={setTakerId} />
          </Field>
          <div className="grid gap-1.5">
            <Label htmlFor={`${idBase}-amount`}>Valor</Label>
            <CurrencyInput id={`${idBase}-amount`} value={amount} onValueChange={setAmount} />
          </div>
          <Field id={`${idBase}-text`} label="Descrição do serviço" hint="{mes} vira MM/AAAA e {ano} vira AAAA.">
            <Textarea id={`${idBase}-text`} rows={3} maxLength={2000} value={text} onChange={(event) => setText(event.target.value)} />
          </Field>
          <Field id={`${idBase}-ref`} label="A nota se refere">
            <Choice id={`${idBase}-ref`} value={reference} options={REFERENCES} onChange={(value) => setReference(value as ClientNfseReference)} />
          </Field>
          {preview ? (
            <div className="grid gap-1 rounded-md border bg-muted/30 p-3">
              <p className="hud-label">Em {MONTHS[period.month - 1]} sai assim</p>
              <p className="text-sm whitespace-pre-wrap">{preview}</p>
            </div>
          ) : null}
          <Field id={`${idBase}-svc`} label="Serviço">
            <Choice id={`${idBase}-svc`} value={serviceMode} options={SERVICE_MODES} onChange={(value) => setServiceMode(value as "issuer" | "own")} />
          </Field>
          {serviceMode === "own" ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field id={`${idBase}-ctrib`} label="Tributação nacional" hint="6 dígitos."><Input id={`${idBase}-ctrib`} inputMode="numeric" value={service.nationalTaxCode} onChange={(event) => setService((current) => ({ ...current, nationalTaxCode: event.target.value }))} /></Field>
              <Field id={`${idBase}-cmun`} label="Municipal" hint="Opcional."><Input id={`${idBase}-cmun`} inputMode="numeric" value={service.municipalTaxCode} onChange={(event) => setService((current) => ({ ...current, municipalTaxCode: event.target.value }))} /></Field>
              <Field id={`${idBase}-nbs`} label="NBS" hint="Opcional."><Input id={`${idBase}-nbs`} inputMode="numeric" value={service.nbsCode} onChange={(event) => setService((current) => ({ ...current, nbsCode: event.target.value }))} /></Field>
            </div>
          ) : null}
          {model ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-primary" checked={active} onChange={(event) => setActive(event.target.checked)} />
              Ativa (desmarque para pausar: ela deixa de abrir nos próximos meses)
            </label>
          ) : null}
        </div>
        <DialogFooter>
          {model ? (
            <DeleteButton
              pending={pending}
              onClick={() => {
                if (!window.confirm("Apagar esta nota padrão? As notas dela nos meses abertos saem junto. Se já gerou nota, pause em vez de apagar.")) return;
                run(() => deleteModel({ clanId, id: model.id }), "Nota padrão apagada.");
              }}
            >
              Apagar
            </DeleteButton>
          ) : null}
          <Button
            type="button"
            disabled={pending || !takerId || !amount || !text.trim()}
            onClick={() =>
              run(
                () =>
                  saveModel({
                    clanId,
                    issuerId: issuer.id,
                    modelId: model?.id ?? null,
                    takerId,
                    amount,
                    description: text,
                    reference,
                    service:
                      serviceMode === "own"
                        ? {
                            nationalTaxCode: service.nationalTaxCode.trim(),
                            municipalTaxCode: service.municipalTaxCode.trim() || undefined,
                            nbsCode: service.nbsCode.trim() || undefined,
                          }
                        : null,
                    active,
                  }),
                model ? "Nota padrão salva." : "Nota padrão cadastrada.",
              )
            }
          >
            {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : null} {model ? "Salvar nota padrão" : "Cadastrar nota padrão"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
