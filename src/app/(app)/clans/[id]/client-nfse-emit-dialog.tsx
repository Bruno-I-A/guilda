"use client";

import { AlertTriangle, ChevronDown, LoaderCircle, Search, Send } from "lucide-react";
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
import type { NfseRetentions } from "@/domain/nfse-retentions";
import type { ClientNfseIssuerView } from "@/lib/client-nfse/loaders";
import { portalReadIsStale } from "@/lib/client-nfse/presentation";
import type { ServiceOverride } from "@/lib/client-nfse/registry";
import { formatBRLCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

import { emitNote, lookupTakerCnpj } from "./client-nfse-actions";
import { useIssuerCustomers } from "./client-nfse-customers";
import { formToRetentions, RetentionFields, retentionForm, retentionProblem, RetentionSummary, type RetentionForm } from "./client-nfse-retentions";
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
  /** As retenções do tomador (cliente das notas do Portal ainda não tem). */
  retentions?: NfseRetentions | null;
  /** Veio da previsão do mês: abre direto na conferência, com o serviço da nota de origem. */
  forecast?: { sourceAccessKey: string; service: ServiceOverride | null; textNeedsReview: boolean; portalReadAt: string | null };
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

function addressIsReady(address: Address): boolean {
  return Boolean(address.street.trim() && address.district.trim() && address.city.trim() && address.state.trim() && address.zipCode.replace(/\D/g, "").length === 8);
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
  const forecast = prefill?.forecast ?? null;
  // A nota de origem só vale enquanto o cliente for o dela: trocar o cliente faz uma nota nova.
  const [sourceAccessKey, setSourceAccessKey] = useState(forecast?.sourceAccessKey);
  const [ownService, setOwnService] = useState(Boolean(forecast?.service));
  const [service, setService] = useState({
    nationalTaxCode: forecast?.service?.nationalTaxCode ?? issuer.template?.service.nationalTaxCode ?? "",
    municipalTaxCode: forecast?.service?.municipalTaxCode ?? issuer.template?.service.municipalTaxCode ?? "",
    nbsCode: forecast?.service?.nbsCode ?? issuer.template?.service.nbsCode ?? "",
  });
  // Prevista completa abre na conferência: é um olhar e um clique. Faltando algo, abre para preencher.
  const [confirming, setConfirming] = useState(() =>
    Boolean(forecast && !forecast.textNeedsReview && Number(prefill?.amount) > 0 && prefill?.description && (!issuer.template?.ibsCbs || addressIsReady(addressForm(prefill?.address ?? null)))),
  );
  // Retenções: vêm do tomador; ajustar aqui vale para esta nota e, marcado, vira o padrão dele.
  const [retention, setRetention] = useState<RetentionForm>(() => retentionForm(prefill?.retentions));
  const [retentionOpen, setRetentionOpen] = useState(Boolean(prefill?.retentions));
  const [rememberRetentions, setRememberRetentions] = useState(true);
  const [step, setStep] = useState(prefill ? 1 : 0);
  const [manual, setManual] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  // A lista de clientes lê as notas guardadas: só carrega quando a pessoa vai escolher um.
  const { view, loading, error: customersError } = useIssuerCustomers(clanId, issuer.id, step === 0, reload);
  const digits = normalizeCnpj(document);
  const documentOk = validateTaxDocument(digits);
  const period = currentPeriod();
  const finalText = text.trim() ? clientNfseMonthDescription(text, period, reference) : "";

  // Tomadores da empresa primeiro; depois os clientes das notas do Portal que ainda não são.
  const sources = useMemo<EmitPrefill[]>(() => {
    const known = new Set(issuer.takers.map((taker) => taker.document));
    return [
      ...issuer.takers.map((taker) => ({ document: taker.document, name: taker.name, address: taker.address, amount: taker.lastAmount, description: taker.lastDescription, retentions: taker.retentions })),
      ...(view?.customers ?? [])
        .filter((customer) => !known.has(customer.takerDocument))
        .map((customer) => ({ document: customer.takerDocument, name: customer.takerName, address: customer.address, amount: customer.amount || null, description: customer.description || null })),
    ];
  }, [issuer.takers, view]);
  const matches = useMemo(() => {
    const needle = normalize(query.trim());
    const queryDigits = query.replace(/\D/g, "");
    if (!needle) return sources.slice(0, 6);
    return sources.filter((source) => normalize(source.name).includes(needle) || (queryDigits.length >= 3 && source.document.includes(queryDigits))).slice(0, 6);
  }, [sources, query]);

  function pick(source: EmitPrefill) {
    if (source.document !== prefill?.document) setSourceAccessKey(undefined);
    setDocument(formatCnpj(source.document));
    setName(source.name);
    setAddress(addressForm(source.address));
    setAmount(source.amount ?? "");
    setText(source.description ?? "");
    setRetention(retentionForm(source.retentions));
    setRetentionOpen(Boolean(source.retentions));
    setQuery("");
    setStep(1);
    setError(null);
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
  const requiresAddress = Boolean(issuer.template?.ibsCbs);
  const addressReady = !requiresAddress || addressIsReady(address);
  const retentionError = retentionProblem(retention);
  const ready = documentOk && name.trim() && amount && Number(amount) > 0 && text.trim() && addressReady && !retentionError;

  function emit() {
    startSending(async () => {
      setError(null);
      try {
      const result = await emitNote({
        clanId,
        issuerId: issuer.id,
        requestId,
        sourceAccessKey,
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
        retentions: formToRetentions(retention),
        rememberRetentions,
      });
      if (!result.ok) {
        setError(result.error);
        setConfirming(false);
        setMore(true);
        return;
      }
      toast.success(result.data?.repeated ? "Esta nota já tinha sido pedida." : "Nota enviada para emissão. Acompanhe a situação na lista.");
      onOpenChange(false);
      router.replace(`/clans/${clanId}?tab=client-notes&fiscalYear=${period.year}&fiscalMonth=${period.month}`, { scroll: false });
      router.refresh();
      } catch {
        setError("Não foi possível confirmar a resposta. Tente novamente neste formulário: o mesmo pedido não cria outra nota.");
      }
    });
  }

  const field = (key: keyof Address) => (event: React.ChangeEvent<HTMLInputElement>) => setAddress((current) => ({ ...current, [key]: event.target.value }));
  const id = `emit-${issuer.id}`;

  return (
    <Dialog open onOpenChange={(open) => { if (!sending) onOpenChange(open); }}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl" aria-busy={sending}>
        <DialogHeader>
          <DialogTitle>{confirming ? "Confira antes de emitir" : step === 0 ? "Para quem é a nota?" : "Preencha a nota"}</DialogTitle>
          <DialogDescription>{issuer.name} · {issuer.cnpj ? formatCnpj(issuer.cnpj) : ""}</DialogDescription>
        </DialogHeader>
        <ol className="grid grid-cols-3 gap-2 border-b pb-3 text-sm" aria-label="Etapas da emissão">
          {["Cliente", "Nota", "Conferência"].map((label, index) => <li key={label} aria-current={(confirming ? 2 : step) === index ? "step" : undefined} className={cn("flex items-center gap-2", (confirming ? 2 : step) === index ? "font-medium text-primary" : "text-muted-foreground")}><span className="font-mono">{index + 1}.</span>{label}</li>)}
        </ol>
        {error ? <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
        {confirming ? (
          <div className="grid gap-2 rounded-md border bg-muted/30 p-3 text-sm">
            <span className="text-muted-foreground">Emissão hoje · {new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</span>
            <span className="hud-label">Para</span>
            <span>
              {name} <span className="font-mono text-xs text-muted-foreground">{formatCnpj(digits)}</span>
            </span>
            <span className="hud-label">Descrição</span>
            <span>{finalText}</span>
            <span className="hud-label">Valor</span>
            <span className="font-mono text-lg tabular-nums">{formatBRLCurrency(amount)}</span>
            {forecast && sourceAccessKey ? <span className="text-xs text-muted-foreground">Valor e texto vêm da nota do mês passado. Se mudou algo, use Voltar e ajustar.</span> : null}
            {formToRetentions(retention) ? <RetentionSummary form={retention} amount={amount} /> : <span className="text-xs text-muted-foreground">Sem retenções.</span>}
            {forecast && sourceAccessKey && portalReadIsStale(forecast.portalReadAt, new Date()) ? (
              <p role="status" className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-sm">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                As notas do Portal desta empresa não são lidas há mais de um dia. Se esta nota já foi feita lá, ainda não aparece aqui.
              </p>
            ) : null}
            <p className="border-t pt-2 text-xs text-muted-foreground">Ao confirmar, a nota será enviada ao Sistema Nacional. Depois de emitida, alterações exigem cancelamento.</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {step === 0 ? <>
            {!manual ? (
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-search`}>Buscar cliente (tomador)</Label>
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
                    placeholder="Nome, CPF ou CNPJ"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </div>
                {loading ? <p role="status" className="text-xs text-muted-foreground">Buscando também nas notas anteriores…</p> : null}
                {customersError ? <div role="alert" className="text-sm text-warning"><p>{customersError}</p><Button type="button" size="sm" variant="outline" onClick={() => setReload((value) => value + 1)}>Buscar novamente</Button></div> : null}
                {!query && matches.length > 0 ? <p className="text-xs text-muted-foreground">Escolha um cliente ou busque pelo nome acima.</p> : null}
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
                  <p className="text-sm text-muted-foreground">Cliente não encontrado. Use “Novo cliente” para preencher os dados.</p>
                ) : null}
                <Button type="button" variant="outline" className="mt-2 justify-self-start" onClick={() => { setSourceAccessKey(undefined); setDocument(""); setName(query); setAddress(addressForm(null)); setAmount(""); setText(""); setManual(true); }}>+ Novo cliente</Button>
              </div>
            ) : null}
            {manual ? <>
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
            <p className="text-xs text-muted-foreground">O cliente será salvo ao enviar a primeira nota.</p>
            </> : null}
            </> : null}
            {step === 1 ? <>
            {forecast?.textNeedsReview && sourceAccessKey ? (
              <p role="status" className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-sm">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                O texto cita uma data que a Guilda não conseguiu trocar. Corrija antes de emitir.
              </p>
            ) : null}
            <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 p-3 text-sm"><div className="min-w-0"><p className="font-medium">{name}</p><p className="font-mono text-xs text-muted-foreground">{formatCnpj(digits)}</p></div><Button type="button" size="sm" variant="ghost" onClick={() => { setStep(0); setManual(false); }}>Trocar cliente</Button></div>
            <div className="grid gap-1.5 sm:max-w-56">
              <Label htmlFor={`${id}-amount`}>Valor</Label>
              <CurrencyInput id={`${id}-amount`} value={amount} onValueChange={setAmount} />
            </div>
            <Field id={`${id}-text`} label="Descrição do serviço" hint="Confira o texto e o período do serviço, mesmo ao repetir uma nota anterior.">
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
            <Button type="button" variant="ghost" size="sm" className="justify-self-start" aria-expanded={retentionOpen} onClick={() => setRetentionOpen((value) => !value)}>
              <ChevronDown className={cn("transition-transform", retentionOpen && "rotate-180")} aria-hidden /> Retenções{formToRetentions(retention) ? " · esta nota retém" : ""}
            </Button>
            {retentionOpen ? (
              <div className="grid gap-3 rounded-md border p-3">
                <RetentionFields id={`${id}-ret`} form={retention} onChange={setRetention} />
                <RetentionSummary form={retention} amount={amount} />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4 accent-primary" checked={rememberRetentions} onChange={(event) => setRememberRetentions(event.target.checked)} />
                  Usar estas retenções nas próximas notas deste cliente
                </label>
              </div>
            ) : null}
            <Button type="button" variant="ghost" size="sm" className="justify-self-start" aria-expanded={more} onClick={() => setMore((value) => !value)}>
              <ChevronDown className={cn("transition-transform", more && "rotate-180")} aria-hidden /> Endereço e serviço
            </Button>
            {more || requiresAddress ? (
              <div className="grid gap-3">
                <fieldset className="grid gap-3 rounded-md border p-3">
                  <legend className="px-1 text-sm font-medium">Endereço do cliente {requiresAddress ? "· obrigatório para esta nota" : "· opcional"}</legend>
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
            {!addressReady ? <p role="status" className="text-sm text-warning">Complete rua, bairro, CEP, cidade e UF para continuar.</p> : null}
            </> : null}
          </div>
        )}
        <DialogFooter>
          {confirming ? (
            <>
              <Button type="button" variant="outline" disabled={sending} onClick={() => setConfirming(false)}>Voltar e ajustar</Button>
              <Button type="button" disabled={sending} onClick={emit}>
                {sending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Send aria-hidden />} {sending ? "Enviando…" : "Confirmar e emitir"}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => { if (step === 1) setStep(0); else if (manual) setManual(false); else onOpenChange(false); }}>Voltar</Button>
              {step === 0 && manual ? <Button type="button" disabled={!documentOk || !name.trim() || looking} onClick={() => setStep(1)}>Continuar</Button> : null}
              {step === 1 ? <Button type="button" disabled={!ready} onClick={() => setConfirming(true)}>Conferir nota</Button> : null}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
