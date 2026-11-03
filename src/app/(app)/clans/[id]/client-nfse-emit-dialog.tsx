"use client";

import { ChevronDown, LoaderCircle, Search, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatCnpj, normalizeCnpj, validateTaxDocument } from "@/domain/cnpj";
import { clientNfseMonthDescription, type ClientNfseReference } from "@/domain/client-nfse";
import type { ClientNfseIssuerView } from "@/lib/client-nfse/loaders";
import { formatBRLCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

import { emitNote, lookupTakerCnpj } from "./client-nfse-actions";
import { useIssuerCustomers } from "./client-nfse-customers";
import { Choice, Field } from "./nfse-settings-dialog";

const REFERENCES = [["previous", "Ao mês anterior"], ["current", "Ao próprio mês"]] as const;

type AddressValue = { street: string | null; number: string | null; complement: string | null; district: string | null; city: string | null; state: string | null; zipCode: string | null };
type Address = { zipCode: string; street: string; number: string; complement: string; district: string; city: string; state: string };

/** O que preenche o formulário: um tomador da empresa, um cliente das notas do Portal ou uma nota a repetir. */
export interface EmitPrefill {
  document: string;
  name: string;
  address: AddressValue | null;
  amount: string | null;
  description: string | null;
}

function addressForm(address: AddressValue | null): Address {
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

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Mês da emissão em Brasília: é o mês em que a nota avulsa entra. */
function currentPeriod(): { year: number; month: number } {
  const [year, month] = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }).split("-").map(Number);
  return { year, month };
}

/**
 * "+ Emitir nota": tomador, valor e descrição, e a nota vai para a fila na
 * hora. O tomador sai do cadastro da empresa ou dos clientes das notas que
 * ela já emitiu no Portal; CPF/CNPJ novo vira tomador ao emitir.
 */
export function ClientNfseEmitDialog({
  clanId,
  issuer,
  prefill = null,
  onOpenChange,
}: {
  clanId: string;
  issuer: ClientNfseIssuerView;
  prefill?: EmitPrefill | null;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [sending, startSending] = useTransition();
  const [looking, startLooking] = useTransition();
  // Chave deste formulário: clicar duas vezes (ou repetir o envio) não pede duas notas.
  const [requestId] = useState(() => crypto.randomUUID());
  const [query, setQuery] = useState("");
  const [document, setDocument] = useState(prefill ? formatCnpj(prefill.document) : "");
  const [name, setName] = useState(prefill?.name ?? "");
  const [address, setAddress] = useState<Address>(() => addressForm(prefill?.address ?? null));
  const [amount, setAmount] = useState(prefill?.amount ?? "");
  const [text, setText] = useState(prefill?.description ?? "");
  const [reference, setReference] = useState<ClientNfseReference>("previous");
  const [more, setMore] = useState(false);
  const [ownService, setOwnService] = useState(false);
  const [service, setService] = useState({
    nationalTaxCode: issuer.template?.service.nationalTaxCode ?? "",
    municipalTaxCode: issuer.template?.service.municipalTaxCode ?? "",
    nbsCode: issuer.template?.service.nbsCode ?? "",
  });
  const [confirming, setConfirming] = useState(false);
  const { view } = useIssuerCustomers(clanId, issuer.id, true);
  const digits = normalizeCnpj(document);
  const documentOk = validateTaxDocument(digits);
  const period = currentPeriod();
  const finalText = text.trim() ? clientNfseMonthDescription(text, period, reference) : "";

  // Tomadores da empresa primeiro; depois os clientes das notas do Portal que ainda não são.
  const sources = useMemo<EmitPrefill[]>(() => {
    const known = new Set(issuer.takers.map((taker) => taker.document));
    return [
      ...issuer.takers.map((taker) => ({ document: taker.document, name: taker.name, address: taker.address, amount: taker.lastAmount, description: taker.lastDescription })),
      ...(view?.customers ?? [])
        .filter((customer) => !known.has(customer.takerDocument))
        .map((customer) => ({ document: customer.takerDocument, name: customer.takerName, address: customer.address, amount: customer.amount || null, description: customer.description || null })),
    ];
  }, [issuer.takers, view]);
  const matches = useMemo(() => {
    const needle = normalize(query.trim());
    const queryDigits = query.replace(/\D/g, "");
    if (needle.length < 2) return [];
    return sources.filter((source) => normalize(source.name).includes(needle) || (queryDigits.length >= 3 && source.document.includes(queryDigits))).slice(0, 6);
  }, [sources, query]);

  function pick(source: EmitPrefill) {
    setDocument(formatCnpj(source.document));
    setName(source.name);
    setAddress(addressForm(source.address));
    if (source.amount) setAmount(source.amount);
    if (source.description) setText(source.description);
    setQuery("");
  }

  function onDocumentBlur() {
    if (!documentOk) return;
    setDocument(formatCnpj(digits));
    const known = sources.find((source) => source.document === digits);
    if (known && !name.trim()) pick(known);
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

  const blank = (value: string) => value.trim() || null;
  const ready = documentOk && name.trim() && amount && Number(amount) > 0 && text.trim();

  function emit() {
    startSending(async () => {
      const result = await emitNote({
        clanId,
        issuerId: issuer.id,
        requestId,
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
      });
      if (!result.ok) {
        toast.error(result.error);
        setConfirming(false);
        return;
      }
      toast.success(result.data?.repeated ? "Esta nota já tinha sido pedida." : "Nota na fila. Ela sai em instantes.");
      onOpenChange(false);
      router.refresh();
    });
  }

  const field = (key: keyof Address) => (event: React.ChangeEvent<HTMLInputElement>) => setAddress((current) => ({ ...current, [key]: event.target.value }));
  const id = `emit-${issuer.id}`;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl" aria-busy={sending}>
        <DialogHeader>
          <DialogTitle>Emitir nota · {issuer.name}</DialogTitle>
          <DialogDescription>Sai pelo CNPJ da empresa, com o certificado dela. Emitida, só se desfaz com cancelamento formal.</DialogDescription>
        </DialogHeader>
        {confirming ? (
          <div className="grid gap-2 rounded-md border bg-muted/30 p-3 text-sm">
            <span className="hud-label">Para</span>
            <span>
              {name} <span className="font-mono text-xs text-muted-foreground">{formatCnpj(digits)}</span>
            </span>
            <span className="hud-label">Descrição</span>
            <span>{finalText}</span>
            <span className="hud-label">Valor</span>
            <span className="font-mono text-lg tabular-nums">{formatBRLCurrency(amount)}</span>
          </div>
        ) : (
          <div className="grid gap-3">
            {sources.length > 0 ? (
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-search`}>Tomador</Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                  <Input
                    id={`${id}-search`}
                    type="search"
                    autoFocus
                    autoComplete="off"
                    data-1p-ignore
                    data-lpignore="true"
                    className="pl-8"
                    placeholder={`Buscar por nome ou CPF/CNPJ entre ${sources.length} cliente(s)`}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </div>
                {matches.length > 0 ? (
                  <ul className="grid divide-y rounded-md border bg-card" aria-label="Clientes encontrados">
                    {matches.map((source) => (
                      <li key={source.document}>
                        <button
                          type="button"
                          onClick={() => pick(source)}
                          className="grid w-full gap-0.5 px-3 py-2 text-left text-sm transition-colors hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        >
                          <span className="truncate">{source.name}</span>
                          <span className="font-mono text-xs text-muted-foreground tabular-nums">
                            {formatCnpj(source.document)}
                            {source.amount ? ` · última ${formatBRLCurrency(source.amount)}` : ""}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : query.trim().length >= 2 ? (
                  <p className="text-xs text-muted-foreground">Ninguém com esse nome ou documento. Preencha o CPF/CNPJ abaixo.</p>
                ) : null}
              </div>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <Field id={`${id}-doc`} label="CPF ou CNPJ">
                <Input id={`${id}-doc`} value={document} inputMode="numeric" autoComplete="off" data-1p-ignore data-lpignore="true" onChange={(event) => setDocument(event.target.value)} onBlur={onDocumentBlur} />
              </Field>
              <Button type="button" variant="outline" className="self-end" disabled={looking || digits.length !== 14 || !documentOk} onClick={lookup}>
                {looking ? <LoaderCircle className="animate-spin" aria-hidden /> : <Search aria-hidden />} Consultar CNPJ
              </Button>
            </div>
            {digits.length > 0 && !documentOk ? <p className="text-xs text-destructive">CPF ou CNPJ inválido.</p> : null}
            <Field id={`${id}-name`} label="Nome na nota"><Input id={`${id}-name`} value={name} maxLength={200} autoComplete="off" onChange={(event) => setName(event.target.value)} /></Field>
            <div className="grid gap-1.5 sm:max-w-56">
              <Label htmlFor={`${id}-amount`}>Valor</Label>
              <CurrencyInput id={`${id}-amount`} value={amount} onValueChange={setAmount} />
            </div>
            <Field id={`${id}-text`} label="Descrição do serviço" hint="{mes} vira o mês (MM/AAAA) e {ano} o ano.">
              <Textarea id={`${id}-text`} rows={3} maxLength={2000} value={text} onChange={(event) => setText(event.target.value)} />
            </Field>
            {text.includes("{") ? (
              <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm">{finalText}</p>
                <Field id={`${id}-ref`} label="{mes} é">
                  <Choice id={`${id}-ref`} value={reference} options={REFERENCES} onChange={(value) => setReference(value as ClientNfseReference)} />
                </Field>
              </div>
            ) : null}
            <Button type="button" variant="ghost" size="sm" className="justify-self-start" aria-expanded={more} onClick={() => setMore((value) => !value)}>
              <ChevronDown className={cn("transition-transform", more && "rotate-180")} aria-hidden /> Endereço e serviço
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
              </div>
            ) : null}
          </div>
        )}
        <DialogFooter>
          {confirming ? (
            <>
              <Button type="button" variant="outline" disabled={sending} onClick={() => setConfirming(false)}>Voltar e ajustar</Button>
              <Button type="button" disabled={sending} onClick={emit}>
                {sending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Send aria-hidden />} Emitir agora
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Voltar</Button>
              <Button type="button" disabled={!ready} onClick={() => setConfirming(true)}>
                <Send aria-hidden /> Emitir nota{amount && Number(amount) > 0 ? ` · ${formatBRLCurrency(amount)}` : ""}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
