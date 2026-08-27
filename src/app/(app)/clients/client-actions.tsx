"use client";

import { Archive, ArchiveRestore, LoaderCircle, Pencil, Plus, Upload } from "lucide-react";
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

import {
  createClient,
  importClientsFromSpreadsheet,
  setClientActive,
  updateClient,
  type ImportClientsResult,
} from "./actions";
import { DeleteClientButton } from "./delete-client-dialog";

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

export function ImportClientsButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [taxRegime, setTaxRegime] = useState<TaxRegime>("simples");
  const [pending, startTransition] = useTransition();
  const [summary, setSummary] = useState<ImportClientsResult | null>(null);

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Upload aria-hidden /> Importar Excel
      </Button>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) setSummary(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Importar empresas</DialogTitle>
            <DialogDescription>
              Envie uma planilha por regime. Use uma coluna de nome e, se tiver,
              uma coluna de CNPJ.
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              const formData = new FormData(event.currentTarget);
              formData.set("taxRegime", taxRegime);
              startTransition(async () => {
                const result = await importClientsFromSpreadsheet(formData);
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }

                const data = result.data;
                if (!data) {
                  toast.error("Importação sem resumo.");
                  return;
                }

                setSummary(data);
                toast.success(
                  `${data.created} ${data.created === 1 ? "criada" : "criadas"}, ` +
                    `${data.updated} ${data.updated === 1 ? "atualizada" : "atualizadas"}.`,
                );
                router.refresh();
              });
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="import-regime">Regime deste arquivo</Label>
              <Select
                value={taxRegime}
                onValueChange={(v) => setTaxRegime(v as TaxRegime)}
              >
                <SelectTrigger id="import-regime" className="w-full">
                  <SelectValue>{TAX_REGIME_LABELS[taxRegime]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {TAX_REGIMES.filter((regime) => regime !== "association").map(
                    (regime) => (
                      <SelectItem key={regime} value={regime}>
                        {TAX_REGIME_LABELS[regime]}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="import-file">Planilha</Label>
              <Input
                id="import-file"
                name="file"
                type="file"
                accept=".xlsx,.csv"
                required
              />
            </div>

            {/* Placar da importação: número em mono tabular, o que ele conta
                em `hud-label` (é rótulo de dado, não título). */}
            {summary ? (
              <div className="panel-cut panel-cut-sm p-3 text-sm">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div>
                    <p className="font-mono text-lg font-semibold tabular-nums text-foreground">
                      {summary.created}
                    </p>
                    <p className="hud-label">criadas</p>
                  </div>
                  <div>
                    <p className="font-mono text-lg font-semibold tabular-nums text-foreground">
                      {summary.updated}
                    </p>
                    <p className="hud-label">atualizadas</p>
                  </div>
                  <div>
                    <p className="font-mono text-lg font-semibold tabular-nums text-foreground">
                      {summary.unchanged}
                    </p>
                    <p className="hud-label">sem mudança</p>
                  </div>
                  <div>
                    <p className="font-mono text-lg font-semibold tabular-nums text-foreground">
                      {summary.rejected.length}
                    </p>
                    <p className="hud-label">rejeitadas</p>
                  </div>
                </div>
                {summary.rejected.length > 0 ? (
                  <ul className="mt-3 grid max-h-28 gap-1 overflow-auto border-t pt-3 text-xs text-muted-foreground">
                    {summary.rejected.slice(0, 8).map((item) => (
                      <li key={`${item.rowNumber}-${item.error}`}>
                        Linha{" "}
                        <span className="font-mono tabular-nums">
                          {item.rowNumber}
                        </span>
                        : {item.error}
                      </li>
                    ))}
                    {summary.rejected.length > 8 ? (
                      <li>
                        Mais {summary.rejected.length - 8}{" "}
                        {summary.rejected.length - 8 === 1
                          ? "linha rejeitada"
                          : "linhas rejeitadas"}
                        .
                      </li>
                    ) : null}
                  </ul>
                ) : null}
              </div>
            ) : null}

            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
                Importar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
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
