"use client";

import { Archive, ArchiveRestore, Eye, LoaderCircle, Pencil, Plus, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCnpj } from "@/domain/cnpj";
import { TAX_REGIME_LABELS, TAX_REGIMES, type TaxRegime } from "@/lib/clients-ui";

import type { ActionResult } from "@/lib/action-context";

import {
  createClient,
  lookupClientRegistrationCnpj,
  setClientActive,
  updateClient,
  type ClientRegistrationLookupView,
} from "./actions";
import {
  ClientDetailsDialog,
  type ClientDetailsView,
} from "./client-details-dialog";
import { DeleteClientButton } from "./delete-client-dialog";

type ClientView = ClientDetailsView;

function ClientFormDialog({
  open,
  onOpenChange,
  title,
  description,
  initial,
  submitLabel,
  onSubmit,
  pending,
  cnpjLookup = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  initial?: ClientView;
  submitLabel: string;
  onSubmit: (fields: {
    name: string;
    taxRegime: TaxRegime;
    cnpj: string;
    operationalEmail: string;
    operationalPhone: string;
  }) => void;
  pending: boolean;
  cnpjLookup?: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [cnpj, setCnpj] = useState(initial?.cnpj ? formatCnpj(initial.cnpj) : "");
  const [taxRegime, setTaxRegime] = useState<TaxRegime>(
    initial?.taxRegime ?? "simples",
  );
  const [lookup, setLookup] = useState<ClientRegistrationLookupView | null>(null);
  const [lookupPending, startLookupTransition] = useTransition();
  const cnpjDigits = cnpj.replace(/\D/g, "");
  const lookupReady = !cnpjLookup || cnpjDigits.length === 0 || lookup?.normalizedCnpj === cnpjDigits;

  function consultCnpj() {
    startLookupTransition(async () => {
      const result = await lookupClientRegistrationCnpj({ cnpj });
      if (!result.ok || !result.data) {
        toast.error(result.ok ? "Consulta sem dados." : result.error);
        setLookup(null);
        return;
      }
      setLookup(result.data);
      setCnpj(formatCnpj(result.data.normalizedCnpj));
      setName(result.data.legalName);
      if (result.data.suggestedTaxRegime) {
        setTaxRegime(result.data.suggestedTaxRegime);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            onSubmit({
              name: String(form.get("name") ?? ""),
              taxRegime,
              cnpj,
              operationalEmail: String(form.get("operationalEmail") ?? ""),
              operationalPhone: String(form.get("operationalPhone") ?? ""),
            });
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="client-name">Nome</Label>
            <Input
              id="client-name"
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex.: Padaria Estrela do Norte LTDA"
              maxLength={200}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="client-regime">Regime tributário</Label>
            <Select
              value={taxRegime}
              onValueChange={(v) => setTaxRegime(v as TaxRegime)}
            >
              <SelectTrigger id="client-regime" className="w-full">
                <SelectValue>{TAX_REGIME_LABELS[taxRegime]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {TAX_REGIMES.map((regime) => (
                  <SelectItem key={regime} value={regime}>
                    {TAX_REGIME_LABELS[regime]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="client-cnpj">CNPJ (opcional)</Label>
            <div className={cnpjLookup ? "grid gap-2 sm:grid-cols-[1fr_auto]" : undefined}>
              <Input
                id="client-cnpj"
                name="cnpj"
                value={cnpj}
                onChange={(event) => {
                  setCnpj(event.target.value);
                  setLookup(null);
                }}
                placeholder="00.000.000/0000-00"
                inputMode="numeric"
              />
              {cnpjLookup ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={lookupPending || cnpjDigits.length !== 14}
                  onClick={consultCnpj}
                >
                  {lookupPending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Search aria-hidden />}
                  Consultar
                </Button>
              ) : null}
            </div>
          </div>
          {lookup ? (
            <section className="grid gap-2 border border-success/35 bg-success/5 p-3" aria-live="polite">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{lookup.legalName}</p>
                <Badge variant="outline" className="border-success/40 text-success">
                  {lookup.cadastralSituation ?? "Consultada"}
                </Badge>
              </div>
              {lookup.tradeName ? <p className="text-xs text-muted-foreground">Nome fantasia: {lookup.tradeName}</p> : null}
              {lookup.cnaeDescription ? (
                <p className="text-xs">
                  <span className="font-mono text-muted-foreground">{lookup.cnaeCode}</span> · {lookup.cnaeDescription}
                  {lookup.secondaryCnaes.length > 0 ? ` · +${lookup.secondaryCnaes.length} secundária${lookup.secondaryCnaes.length === 1 ? "" : "s"}` : ""}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Ao cadastrar, endereço, atividades, QSA, capital social e contatos públicos também serão salvos.
              </p>
            </section>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="client-email">E-mail operacional</Label>
              <Input
                id="client-email"
                name="operationalEmail"
                type="email"
                defaultValue={initial?.operationalEmail ?? ""}
                placeholder="contato@empresa.com"
                maxLength={200}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="client-phone">Celular operacional</Label>
              <Input
                id="client-phone"
                name="operationalPhone"
                defaultValue={initial?.operationalPhone ?? ""}
                placeholder="(00) 00000-0000"
                inputMode="tel"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending || lookupPending || !lookupReady}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function NewClientButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus aria-hidden /> Nova empresa
      </Button>
      {open ? (
        <ClientFormDialog
          open={open}
          onOpenChange={setOpen}
          title="Nova empresa-cliente"
          description="Consulte o CNPJ para preencher e salvar a ficha cadastral completa."
          submitLabel="Cadastrar empresa"
          pending={pending}
          cnpjLookup
          onSubmit={(fields) =>
            startTransition(async () => {
              const result = await createClient(fields);
              if (!result.ok) {
                toast.error(result.error);
                return;
              }
              toast.success("Empresa cadastrada com os dados da consulta!");
              setOpen(false);
              router.refresh();
            })
          }
        />
      ) : null}
    </>
  );
}

export function ClientRowActions({
  client,
  isAdmin,
}: {
  client: ClientView;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<ActionResult>, successMessage: string) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(successMessage);
      setEditOpen(false);
      router.refresh();
    });
  }

  return (
    // `touch-target` em cada ícone: são controles de 32px dentro de uma linha
    // de lista, e no celular o dedo não acerta isso.
    <div className="flex shrink-0 items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        className="touch-target"
        aria-label={`Ver dados de ${client.name}`}
        onClick={() => setDetailsOpen(true)}
      >
        <Eye aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="touch-target"
        aria-label={`Editar ${client.name}`}
        disabled={pending}
        onClick={() => setEditOpen(true)}
      >
        <Pencil aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="touch-target"
        aria-label={client.active ? `Desativar ${client.name}` : `Reativar ${client.name}`}
        disabled={pending}
        onClick={() =>
          run(
            () => setClientActive({ clientId: client.id, active: !client.active }),
            client.active ? "Empresa desativada." : "Empresa reativada.",
          )
        }
      >
        {client.active ? <Archive aria-hidden /> : <ArchiveRestore aria-hidden />}
      </Button>
      {isAdmin ? (
        <DeleteClientButton clientId={client.id} clientName={client.name} />
      ) : null}

      {detailsOpen ? (
        <ClientDetailsDialog
          client={client}
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
        />
      ) : null}

      {editOpen ? (
        <ClientFormDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          title="Editar empresa"
          description="O regime define em qual grupo a empresa aparece nos fechamentos."
          initial={client}
          submitLabel="Salvar alterações"
          pending={pending}
          onSubmit={(fields) =>
            run(
              () => updateClient({ clientId: client.id, ...fields }),
              "Empresa atualizada!",
            )
          }
        />
      ) : null}
    </div>
  );
}
