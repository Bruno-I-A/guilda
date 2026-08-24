"use client";

import {
  FilePenLine,
  FileSpreadsheet,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import {
  applyInstallmentImport,
  deleteFiscalInstallment,
  previewInstallmentImport,
  saveFiscalInstallment,
  type InstallmentImportPreview,
} from "./fiscal-installment-actions";

export interface FiscalInstallmentRowView {
  id: string;
  clientId: string;
  clientName: string;
  clientActive: boolean;
  installmentType: string;
  notes: string | null;
  deliveryMethod: string | null;
  installmentNumber: string | null;
  updatedAt: string;
}

type ClientOption = { id: string; name: string };

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

function InstallmentFormDialog({
  clanId,
  clients,
  row,
}: {
  clanId: string;
  clients: readonly ClientOption[];
  row?: FiscalInstallmentRowView;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [clientId, setClientId] = useState(row?.clientId ?? "");
  const [installmentType, setInstallmentType] = useState(row?.installmentType ?? "");
  const [notes, setNotes] = useState(row?.notes ?? "");
  const [deliveryMethod, setDeliveryMethod] = useState(row?.deliveryMethod ?? "");
  const [installmentNumber, setInstallmentNumber] = useState(row?.installmentNumber ?? "");

  function reset() {
    setClientId(row?.clientId ?? "");
    setInstallmentType(row?.installmentType ?? "");
    setNotes(row?.notes ?? "");
    setDeliveryMethod(row?.deliveryMethod ?? "");
    setInstallmentNumber(row?.installmentNumber ?? "");
  }

  function save() {
    startTransition(async () => {
      const result = await saveFiscalInstallment({
        clanId,
        installmentId: row?.id ?? null,
        clientId,
        installmentType,
        notes,
        deliveryMethod,
        installmentNumber,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(row ? "Parcelamento atualizado." : "Parcelamento adicionado.");
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
        <Button type="button" variant={row ? "ghost" : "default"} size="sm">
          {row ? <FilePenLine aria-hidden /> : <Plus aria-hidden />}
          {row ? "Editar" : "Novo parcelamento"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{row ? "Editar parcelamento" : "Novo parcelamento"}</DialogTitle>
          <DialogDescription>
            A mesma empresa pode ter vários parcelamentos cadastrados.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor={`${row?.id ?? "new"}-installment-client`}>Empresa *</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger id={`${row?.id ?? "new"}-installment-client`} className="w-full">
                <SelectValue placeholder="Selecione a empresa" />
              </SelectTrigger>
              <SelectContent>
                {clients.map((client) => (
                  <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${row?.id ?? "new"}-installment-type`}>Tipo de parcelamento *</Label>
            <Input
              id={`${row?.id ?? "new"}-installment-type`}
              value={installmentType}
              maxLength={240}
              placeholder="Ex.: Simples Nacional, INSS, Regularize, E-CAC MEI"
              onChange={(event) => setInstallmentType(event.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor={`${row?.id ?? "new"}-delivery-method`}>Forma de entrega</Label>
              <Input
                id={`${row?.id ?? "new"}-delivery-method`}
                value={deliveryMethod}
                maxLength={240}
                placeholder="WhatsApp, e-mail, impresso ou responsável"
                onChange={(event) => setDeliveryMethod(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${row?.id ?? "new"}-installment-number`}>Nº de parcelas</Label>
              <Input
                id={`${row?.id ?? "new"}-installment-number`}
                value={installmentNumber}
                maxLength={120}
                placeholder="Ex.: 2/13, 9/28 ou 80/150"
                onChange={(event) => setInstallmentNumber(event.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${row?.id ?? "new"}-installment-notes`}>Caminho / observações</Label>
            <Textarea
              id={`${row?.id ?? "new"}-installment-notes`}
              value={notes}
              maxLength={5000}
              rows={5}
              placeholder="Certificado, caminho no portal, cuidados e demais observações"
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            disabled={pending || !clientId || installmentType.trim().length < 2}
            onClick={save}
          >
            Salvar parcelamento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteInstallmentDialog({
  clanId,
  row,
}: {
  clanId: string;
  row: FiscalInstallmentRowView;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function remove() {
    startTransition(async () => {
      const result = await deleteFiscalInstallment({ clanId, installmentId: row.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Parcelamento excluído.");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Excluir parcelamento">
          <Trash2 aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Excluir este parcelamento?</DialogTitle>
          <DialogDescription>
            {row.clientName} · {row.installmentType}. Esta ação não pode ser desfeita.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>Voltar</Button>
          <Button type="button" variant="destructive" disabled={pending} onClick={remove}>
            Excluir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InstallmentImportDialog({ clanId }: { clanId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<InstallmentImportPreview | null>(null);
  const [selected, setSelected] = useState<Record<number, string>>({});

  function previewFile(formData: FormData) {
    formData.set("clanId", clanId);
    startTransition(async () => {
      const result = await previewInstallmentImport(formData);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (!result.data) {
        toast.error("A prévia não retornou dados.");
        return;
      }
      const next = result.data;
      setPreview(next);
      setSelected(Object.fromEntries(next.rows.map((row) => [row.rowNumber, row.suggestedClientId ?? ""])));
    });
  }

  function apply() {
    if (!preview) return;
    const unresolved = preview.rows.filter((row) => !selected[row.rowNumber]);
    if (unresolved.length > 0) {
      toast.error(`Selecione a empresa de ${unresolved.length} linha(s).`);
      return;
    }
    startTransition(async () => {
      const result = await applyInstallmentImport({
        clanId,
        rows: preview.rows.map((row) => ({
          rowNumber: row.rowNumber,
          sourceName: row.sourceName,
          clientId: selected[row.rowNumber]!,
          installmentType: row.installmentType,
          notes: row.notes ?? "",
          deliveryMethod: row.deliveryMethod ?? "",
          installmentNumber: row.installmentNumber ?? "",
        })),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${result.data?.imported ?? 0} parcelamento(s) importado(s).`);
      setOpen(false);
      setPreview(null);
      setSelected({});
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setPreview(null);
          setSelected({});
        }
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <FileSpreadsheet aria-hidden /> Importar Excel
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Importar parcelamentos do Excel</DialogTitle>
          <DialogDescription>
            Use um arquivo .xlsx com Empresa, Tipo de parcelamento, OBS, Forma de
            entrega e Nº de parcelas. Empresas repetidas são mantidas. Remova
            senhas e códigos de acesso antes da importação.
          </DialogDescription>
        </DialogHeader>
        {!preview ? (
          <form action={previewFile} className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="installment-file">Planilha .xlsx</Label>
              <Input id="installment-file" name="file" type="file" accept=".xlsx" required />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending}>Ler planilha</Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="grid gap-4">
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <Badge variant="secondary">{preview.rows.length} linhas</Badge>
              <span>{preview.fileName}</span>
              {preview.rejectedRows.length > 0 ? <span>{preview.rejectedRows.length} rejeitada(s)</span> : null}
              <span>{preview.skippedRows} ignorada(s)</span>
            </div>
            <div className="max-h-[55vh] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Linha</TableHead>
                    <TableHead>Empresa da planilha</TableHead>
                    <TableHead className="min-w-64">Empresa no sistema</TableHead>
                    <TableHead>Parcelamento</TableHead>
                    <TableHead>Entrega</TableHead>
                    <TableHead>Parcelas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.map((row) => (
                    <TableRow key={row.rowNumber}>
                      <TableCell className="font-mono text-xs">{row.rowNumber}</TableCell>
                      <TableCell>
                        <span className="font-medium">{row.sourceName}</span>
                        <span className="block text-[11px] text-muted-foreground">{row.explanation}</span>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={selected[row.rowNumber] ?? ""}
                          onValueChange={(clientId) => setSelected((current) => ({ ...current, [row.rowNumber]: clientId }))}
                        >
                          <SelectTrigger className={cn(!selected[row.rowNumber] && "border-destructive")}>
                            <SelectValue placeholder="Escolha a empresa" />
                          </SelectTrigger>
                          <SelectContent>
                            {preview.clients.map((client) => (
                              <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>{row.installmentType}</TableCell>
                      <TableCell>{row.deliveryMethod ?? "—"}</TableCell>
                      <TableCell>{row.installmentNumber ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {preview.rejectedRows.length > 0 ? (
              <div className="rounded-md border border-amber-400/30 bg-amber-400/5 p-3 text-xs">
                <p className="font-medium">Linhas não importadas</p>
                {preview.rejectedRows.map((row) => <p key={row.rowNumber}>Linha {row.rowNumber}: {row.message}</p>)}
              </div>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPreview(null)}>Escolher outro arquivo</Button>
              <Button
                type="button"
                disabled={pending || preview.rows.some((row) => !selected[row.rowNumber])}
                onClick={apply}
              >
                Importar {preview.rows.length} parcelamentos
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function FiscalInstallmentBoard({
  clanId,
  canManage,
  rows,
  clients,
}: {
  clanId: string;
  canManage: boolean;
  rows: readonly FiscalInstallmentRowView[];
  clients: readonly ClientOption[];
}) {
  const [query, setQuery] = useState("");
  const needle = normalize(query.trim());
  const visible = useMemo(
    () => rows.filter((row) => !needle || normalize(
      `${row.clientName} ${row.installmentType} ${row.notes ?? ""} ${row.deliveryMethod ?? ""} ${row.installmentNumber ?? ""}`,
    ).includes(needle)),
    [needle, rows],
  );
  const companyCount = new Set(rows.map((row) => row.clientId)).size;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-medium">Controle de parcelamentos</h2>
          <p className="text-sm text-muted-foreground">
            Base permanente com tipo, observações, entrega e número de parcelas.
          </p>
          <p className="mt-1 text-xs text-amber-300/80">
            Não registre senhas ou códigos de acesso nas observações; este campo
            guarda apenas caminhos e instruções operacionais.
          </p>
        </div>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <InstallmentImportDialog clanId={clanId} />
            <InstallmentFormDialog clanId={clanId} clients={clients} />
          </div>
        ) : null}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg bg-muted/40 p-3">
          <span className="text-xs text-muted-foreground">Parcelamentos</span>
          <strong className="block font-mono text-lg">{rows.length}</strong>
        </div>
        <div className="rounded-lg bg-muted/40 p-3">
          <span className="text-xs text-muted-foreground">Empresas</span>
          <strong className="block font-mono text-lg">{companyCount}</strong>
        </div>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar empresa, parcelamento, entrega ou observação"
          className="pl-9"
        />
      </div>
      {rows.length === 0 ? (
        <div className="grid justify-items-center gap-2 rounded-lg border border-dashed p-10 text-center">
          <FileSpreadsheet className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">Nenhum parcelamento cadastrado</p>
          <p className="max-w-lg text-sm text-muted-foreground">
            Importe a planilha atual ou adicione o primeiro parcelamento manualmente.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-52">Empresa</TableHead>
                <TableHead className="min-w-56">Tipo de parcelamento</TableHead>
                <TableHead className="min-w-80">Caminho / OBS</TableHead>
                <TableHead className="min-w-40">Forma de entrega</TableHead>
                <TableHead className="min-w-28">Nº de parcelas</TableHead>
                {canManage ? <TableHead><span className="sr-only">Ações</span></TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((row) => (
                <TableRow key={row.id} className={cn(!row.clientActive && "opacity-60")}>
                  <TableCell>
                    <span className="font-medium">{row.clientName}</span>
                    {!row.clientActive ? <Badge variant="outline" className="ml-2 text-[10px]">inativa</Badge> : null}
                  </TableCell>
                  <TableCell>{row.installmentType}</TableCell>
                  <TableCell className="whitespace-pre-wrap text-xs text-muted-foreground">{row.notes ?? "—"}</TableCell>
                  <TableCell>{row.deliveryMethod ?? "—"}</TableCell>
                  <TableCell className="font-mono">{row.installmentNumber ?? "—"}</TableCell>
                  {canManage ? (
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <InstallmentFormDialog clanId={clanId} clients={clients} row={row} />
                        <DeleteInstallmentDialog clanId={clanId} row={row} />
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {visible.length === 0 && rows.length > 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Nenhum parcelamento corresponde à busca.
        </p>
      ) : null}
    </div>
  );
}
