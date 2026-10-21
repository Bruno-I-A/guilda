"use client";

import { FilePenLine, History, LoaderCircle, Search, Trash2, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatCnpj, normalizeCnpj, validateTaxDocument } from "@/domain/cnpj";

import { deleteOfficeFeeProfile, lookupOfficeFeeTakerCnpj, saveOfficeFeeTaker } from "./office-fee-actions";
import { OFFICE_FEE_FIELD_LABELS, type OfficeFeeProfileView } from "./office-fee-profile-dialog";

export interface OfficeFeeTakerAddressView {
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
}

export interface OfficeFeeTakerView {
  id: string;
  name: string;
  document: string;
  address: OfficeFeeTakerAddressView | null;
  active: boolean;
}

const EMPTY_ADDRESS = { zipCode: "", street: "", number: "", complement: "", district: "", city: "", state: "" };
type AddressForm = typeof EMPTY_ADDRESS;

function addressForm(address: OfficeFeeTakerAddressView | null): AddressForm {
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

/** Avulso: paga honorário e recebe nota sem ser empresa-cliente. */
export function OfficeFeeTakerDialog({
  clanId,
  taker,
  profile,
}: {
  clanId: string;
  taker: OfficeFeeTakerView | null;
  profile: OfficeFeeProfileView | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [document, setDocument] = useState("");
  const [address, setAddress] = useState<AddressForm>(EMPTY_ADDRESS);
  const [active, setActive] = useState(true);
  const [additionalInstallment, setAdditionalInstallment] = useState("no");
  const [monthlyFee, setMonthlyFee] = useState("");
  const [notes, setNotes] = useState("");
  const digits = normalizeCnpj(document);
  const documentOk = validateTaxDocument(digits);
  const idBase = taker?.id ?? "new-taker";

  function reset() {
    setName(taker?.name ?? "");
    setDocument(taker ? formatCnpj(taker.document) : "");
    setAddress(addressForm(taker?.address ?? null));
    setActive(taker?.active ?? true);
    setAdditionalInstallment(profile?.chargesAdditionalInstallment ? "yes" : "no");
    setMonthlyFee(profile?.monthlyFee ?? "");
    setNotes(profile?.permanentNotes ?? "");
  }

  function field(key: keyof AddressForm) {
    return (event: React.ChangeEvent<HTMLInputElement>) => setAddress((current) => ({ ...current, [key]: event.target.value }));
  }

  function lookup() {
    startTransition(async () => {
      const result = await lookupOfficeFeeTakerCnpj({ clanId, cnpj: digits });
      if (!result.ok || !result.data) {
        toast.error(result.ok ? "Consulta vazia." : result.error);
        return;
      }
      if (!name.trim()) setName(result.data.name);
      if (result.data.address) setAddress(addressForm(result.data.address));
      toast.success("Nome e endereço preenchidos pela consulta do CNPJ.");
    });
  }

  function save() {
    startTransition(async () => {
      const result = await saveOfficeFeeTaker({
        clanId,
        takerId: taker?.id ?? null,
        expectedVersion: taker ? profile?.version ?? null : null,
        name,
        document: digits,
        address,
        active,
        chargesAdditionalInstallment: additionalInstallment === "yes",
        monthlyFee,
        permanentNotes: notes,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(taker ? "Tomador atualizado." : "Tomador cadastrado.");
      setOpen(false);
      router.refresh();
    });
  }

  function remove() {
    if (!taker) return;
    if (!window.confirm(`Apagar o tomador ${taker.name}? Sai do cadastro e das linhas do Mês a mês. Se já tiver nota emitida, desmarque “Ativo” em vez de apagar.`)) return;
    startTransition(async () => {
      const result = await deleteOfficeFeeProfile({ clanId, clientId: null, takerId: taker.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Tomador apagado.");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) reset();
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        {taker ? (
          <Button type="button" variant="ghost" size="sm"><FilePenLine aria-hidden /> Editar</Button>
        ) : (
          <Button type="button" variant="outline"><UserPlus aria-hidden /> Cadastrar tomador avulso</Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{taker ? `Tomador avulso · ${taker.name}` : "Novo tomador avulso"}</DialogTitle>
          <DialogDescription>
            Para quem paga honorário e precisa de nota sem ser empresa-cliente, como uma filial de terceiro ou
            um produtor rural com CPF. Não entra na lista de empresas nem nos outros clãs.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div className="grid gap-1.5">
              <Label htmlFor={`${idBase}-document`}>CPF ou CNPJ</Label>
              <Input
                id={`${idBase}-document`}
                value={document}
                inputMode="numeric"
                autoComplete="off"
                placeholder="000.000.000-00 ou 00.000.000/0000-00"
                onChange={(event) => setDocument(event.target.value)}
                onBlur={() => { if (validateTaxDocument(digits)) setDocument(formatCnpj(digits)); }}
              />
              {digits.length > 0 && !documentOk ? <p className="text-xs text-destructive">CPF ou CNPJ inválido.</p> : null}
            </div>
            <Button type="button" variant="outline" className="self-end" disabled={pending || digits.length !== 14 || !documentOk} onClick={lookup}>
              {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Search aria-hidden />} Consultar CNPJ
            </Button>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${idBase}-name`}>Nome na nota</Label>
            <Input id={`${idBase}-name`} value={name} maxLength={200} autoComplete="off" onChange={(event) => setName(event.target.value)} />
          </div>
          <fieldset className="grid gap-3 rounded-lg border p-3">
            <legend className="px-1 text-xs text-muted-foreground">Endereço (a nota com IBS/CBS exige rua, bairro, CEP e cidade)</legend>
            <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
              <div className="grid gap-1.5"><Label htmlFor={`${idBase}-zip`}>CEP</Label><Input id={`${idBase}-zip`} value={address.zipCode} inputMode="numeric" autoComplete="off" onChange={field("zipCode")} /></div>
              <div className="grid gap-1.5"><Label htmlFor={`${idBase}-street`}>Rua</Label><Input id={`${idBase}-street`} value={address.street} autoComplete="off" onChange={field("street")} /></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-[6rem_1fr_1fr]">
              <div className="grid gap-1.5"><Label htmlFor={`${idBase}-number`}>Número</Label><Input id={`${idBase}-number`} value={address.number} autoComplete="off" onChange={field("number")} /></div>
              <div className="grid gap-1.5"><Label htmlFor={`${idBase}-complement`}>Complemento</Label><Input id={`${idBase}-complement`} value={address.complement} autoComplete="off" onChange={field("complement")} /></div>
              <div className="grid gap-1.5"><Label htmlFor={`${idBase}-district`}>Bairro</Label><Input id={`${idBase}-district`} value={address.district} autoComplete="off" onChange={field("district")} /></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_5rem]">
              <div className="grid gap-1.5"><Label htmlFor={`${idBase}-city`}>Cidade</Label><Input id={`${idBase}-city`} value={address.city} autoComplete="off" onChange={field("city")} /></div>
              <div className="grid gap-1.5"><Label htmlFor={`${idBase}-state`}>UF</Label><Input id={`${idBase}-state`} value={address.state} maxLength={2} autoComplete="off" onChange={field("state")} /></div>
            </div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor={`${idBase}-additional`}>Cobra parcela adicional?</Label>
              <Select value={additionalInstallment} onValueChange={setAdditionalInstallment}>
                <SelectTrigger id={`${idBase}-additional`}><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="yes">Sim</SelectItem><SelectItem value="no">Não</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${idBase}-fee`}>Honorário mensal</Label>
              <CurrencyInput id={`${idBase}-fee`} value={monthlyFee} onValueChange={setMonthlyFee} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${idBase}-notes`}>Observações</Label>
            <Textarea id={`${idBase}-notes`} value={notes} maxLength={4000} rows={3} onChange={(event) => setNotes(event.target.value)} />
          </div>
          {taker ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="accent-primary" checked={active} onChange={(event) => setActive(event.target.checked)} />
              Ativo (desmarque para parar de abrir o mês e de emitir nota)
            </label>
          ) : null}
          {profile?.history.length ? (
            <section className="grid gap-2 border-t pt-3">
              <h3 className="flex items-center gap-1.5 text-sm font-medium"><History className="size-4" aria-hidden /> Histórico</h3>
              <ul className="grid gap-1.5">
                {profile.history.map((event) => (
                  <li key={event.id} className="flex flex-wrap items-center gap-2 rounded-md bg-muted/35 px-2.5 py-2 text-xs">
                    <Badge variant="outline">v{event.version}</Badge>
                    <span className="text-muted-foreground">por {event.actorName ?? "migração"} · {event.createdAt}</span>
                    {event.changedFields.length > 0 ? <span className="basis-full text-muted-foreground">{event.changedFields.map((item) => OFFICE_FEE_FIELD_LABELS[item] ?? item).join(", ")}</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
        <DialogFooter>
          {taker ? (
            <Button type="button" variant="ghost" className="mr-auto text-destructive" disabled={pending} onClick={remove}>
              <Trash2 aria-hidden /> Apagar
            </Button>
          ) : null}
          <Button type="button" disabled={pending || !name.trim() || !documentOk || !monthlyFee} onClick={save}>
            {taker ? "Salvar tomador" : "Cadastrar tomador"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
