"use client";

import { Archive, ArchiveRestore, Pencil, Plus } from "lucide-react";
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

import { createClient, setClientActive, updateClient } from "./actions";

interface ClientView {
  id: string;
  name: string;
  taxRegime: TaxRegime;
  cnpj: string | null;
  active: boolean;
}

function ClientFormDialog({
  open,
  onOpenChange,
  title,
  description,
  initial,
  submitLabel,
  onSubmit,
  pending,
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
  }) => void;
  pending: boolean;
}) {
  const [taxRegime, setTaxRegime] = useState<TaxRegime>(
    initial?.taxRegime ?? "simples",
  );
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
              cnpj: String(form.get("cnpj") ?? ""),
            });
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="client-name">Nome</Label>
            <Input
              id="client-name"
              name="name"
              defaultValue={initial?.name ?? ""}
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
            <Input
              id="client-cnpj"
              name="cnpj"
              defaultValue={initial?.cnpj ? formatCnpj(initial.cnpj) : ""}
              placeholder="00.000.000/0000-00"
              inputMode="numeric"
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
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
      <ClientFormDialog
        open={open}
        onOpenChange={setOpen}
        title="Nova empresa-cliente"
        description="Cadastre as empresas que serão acompanhadas nos fechamentos."
        submitLabel="Cadastrar"
        pending={pending}
        onSubmit={(fields) =>
          startTransition(async () => {
            const result = await createClient(fields);
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            toast.success("Empresa cadastrada!");
            setOpen(false);
            router.refresh();
          })
        }
      />
    </>
  );
}

export function ClientRowActions({ client }: { client: ClientView }) {
  const router = useRouter();
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
    <div className="flex shrink-0 items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Editar ${client.name}`}
        disabled={pending}
        onClick={() => setEditOpen(true)}
      >
        <Pencil aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon"
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
