"use client";

import { AlertTriangle, Archive, ArchiveRestore, CheckCircle2, Eye, LoaderCircle, Pencil, Plus, RefreshCw, Upload } from "lucide-react";
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
  finalizeClientReplacementImport,
  getLatestClientReplacementImport,
  processClientReplacementImport,
  retryClientReplacementLookups,
  setClientReplacementRowRegime,
  setClientActive,
  startClientReplacementImport,
  updateClient,
  type ClientImportProgress,
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
  const [pending, startTransition] = useTransition();
  const [progress, setProgress] = useState<ClientImportProgress | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [retryIn, setRetryIn] = useState(0);

  async function wait(seconds: number) {
    for (let remaining = seconds; remaining > 0; remaining--) {
      setRetryIn(remaining);
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
    }
    setRetryIn(0);
  }

  async function processUntilReview(initial: ClientImportProgress) {
    let current = initial;
    setProgress(current);
    while (current.status === "processing" || current.status === "cooldown") {
      if (current.status === "cooldown") {
        await wait(current.retryAfterSeconds);
      }
      const result = await processClientReplacementImport({ batchId: current.batchId });
      if (!result.ok || !result.data) {
        toast.error(result.ok ? "Consulta sem progresso." : result.error);
        return;
      }
      current = result.data;
      setProgress(current);
      if (current.status === "processing") {
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
      }
    }
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setOpen(true);
          startTransition(async () => {
            const result = await getLatestClientReplacementImport();
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            if (result.data) {
              if (result.data.status === "processing" || result.data.status === "cooldown") {
                await processUntilReview(result.data);
              } else {
                setProgress(result.data);
              }
            }
          });
        }}
      >
        <Upload aria-hidden /> Importar Excel
      </Button>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) {
            setProgress(null);
            setConfirmation("");
            setRetryIn(0);
          }
        }}
      >
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Substituir pela base real</DialogTitle>
            <DialogDescription>
              A planilha é validada e cada CNPJ é consultado antes de qualquer
              exclusão. E-mail e celular da planilha são preservados como contato operacional.
            </DialogDescription>
          </DialogHeader>
          {!progress ? (
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                const formData = new FormData(event.currentTarget);
                startTransition(async () => {
                  const result = await startClientReplacementImport(formData);
                  if (!result.ok || !result.data) {
                    toast.error(result.ok ? "Importação sem lote." : result.error);
                    return;
                  }
                  await processUntilReview(result.data);
                });
              }}
            >
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
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
                Validar e consultar CNPJs
              </Button>
            </DialogFooter>
          </form>
          ) : (
            <div className="grid gap-4" aria-live="polite" aria-busy={pending}>
              <div className="panel-cut panel-cut-sm grid grid-cols-3 gap-3 p-4">
                <div><p className="font-mono font-semibold tabular-nums">{progress.total}</p><p className="hud-label">empresas</p></div>
                <div><p className="font-mono font-semibold tabular-nums text-success">{progress.consulted}</p><p className="hud-label">consultadas</p></div>
                <div><p className="font-mono font-semibold tabular-nums text-destructive">{progress.errors}</p><p className="hud-label">com erro</p></div>
              </div>

              {!pending ? (
                <Button variant="ghost" onClick={() => setProgress(null)}>
                  Enviar outra planilha
                </Button>
              ) : null}

              {pending ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <LoaderCircle className="animate-spin" aria-hidden />
                  {retryIn > 0
                    ? `Limite temporário atingido. Retomando em ${retryIn}s…`
                    : "Consultando um CNPJ por vez…"}
                </div>
              ) : null}

              {progress.review.length > 0 ? (
                <div className="grid gap-2">
                  <h3>Itens que exigem atenção</h3>
                  <div className="grid max-h-72 gap-2 overflow-y-auto">
                    {progress.review.map((row) => (
                      <div key={row.rowNumber} className="panel-cut panel-cut-sm grid gap-2 p-3 text-sm">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                          <div className="min-w-0 flex-1">
                            <p className="font-medium">{row.name}</p>
                            <p className="font-mono text-xs text-muted-foreground">{formatCnpj(row.cnpj)}</p>
                            {row.error ? <p className="mt-1 text-destructive">{row.error}</p> : null}
                            {row.cadastralSituation && row.cadastralSituation.toUpperCase() !== "ATIVA" ? (
                              <p className="mt-1 text-warning">Situação na Receita: {row.cadastralSituation}</p>
                            ) : null}
                          </div>
                        </div>
                        {!row.error && !row.taxRegime ? (
                          <Select
                            onValueChange={(value) => startTransition(async () => {
                              const result = await setClientReplacementRowRegime({ batchId: progress.batchId, rowNumber: row.rowNumber, taxRegime: value as TaxRegime });
                              if (!result.ok || !result.data) {
                                toast.error(result.ok ? "Revisão sem retorno." : result.error);
                                return;
                              }
                              setProgress(result.data);
                            })}
                          >
                            <SelectTrigger className="w-full"><SelectValue placeholder="Definir regime tributário" /></SelectTrigger>
                            <SelectContent>{TAX_REGIMES.map((regime) => <SelectItem key={regime} value={regime}>{TAX_REGIME_LABELS[regime]}</SelectItem>)}</SelectContent>
                          </Select>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {progress.errors > 0 && !pending ? (
                <Button variant="outline" onClick={() => startTransition(async () => {
                  const reset = await retryClientReplacementLookups({ batchId: progress.batchId });
                  if (!reset.ok || !reset.data) {
                    toast.error(reset.ok ? "Reconsulta sem retorno." : reset.error);
                    return;
                  }
                  await processUntilReview(reset.data);
                })}>
                  <RefreshCw aria-hidden /> Tentar consultas novamente
                </Button>
              ) : null}

              {progress.status === "ready" ? (
                <div className="grid gap-3 border-t border-border pt-4">
                  <div className="flex gap-2 text-sm text-success"><CheckCircle2 className="size-4 shrink-0" aria-hidden /> Todas as consultas e regimes estão prontos.</div>
                  <div className="grid gap-2">
                    <Label htmlFor="replace-confirmation">Confirme a substituição definitiva</Label>
                    <Input id="replace-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="ZERAR E IMPORTAR" />
                    <p className="text-xs text-muted-foreground">Isso apaga clientes, fluxos, missões, informativos, controles mensais e XP de teste. Usuários, clãs, integrações e configurações permanecem.</p>
                  </div>
                  <Button variant="destructive" className="touch-target" disabled={pending || confirmation !== "ZERAR E IMPORTAR"} onClick={() => startTransition(async () => {
                    const result = await finalizeClientReplacementImport({ batchId: progress.batchId, confirmation: "ZERAR E IMPORTAR" });
                    if (!result.ok || !result.data) {
                      toast.error(result.ok ? "Importação sem resumo." : result.error);
                      return;
                    }
                    toast.success(`${result.data.imported} empresas reais importadas; ${result.data.inactive} ficaram inativas conforme a Receita.`);
                    setOpen(false);
                    router.refresh();
                  })}>
                    Zerar testes e importar base real
                  </Button>
                </div>
              ) : null}
            </div>
          )}
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
