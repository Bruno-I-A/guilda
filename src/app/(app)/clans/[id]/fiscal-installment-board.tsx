"use client";

import {
  CalendarCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  FilePenLine,
  FileSpreadsheet,
  Minus,
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
import { Progress } from "@/components/ui/progress";
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
  changeFiscalInstallmentPaid,
  deleteFiscalInstallment,
  previewInstallmentImport,
  saveFiscalInstallment,
  setFiscalInstallmentGenerated,
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
  paidInstallments: number;
  totalInstallments: number | null;
  generatedThisMonth: boolean;
  generatedAt: string | null;
  updatedAt: string;
}

type ClientOption = { id: string; name: string };

const MONTH_NAMES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
] as const;

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
  const [paidInstallments, setPaidInstallments] = useState(String(row?.paidInstallments ?? 0));
  const [totalInstallments, setTotalInstallments] = useState(
    row?.totalInstallments === null || row?.totalInstallments === undefined
      ? ""
      : String(row.totalInstallments),
  );

  function reset() {
    setClientId(row?.clientId ?? "");
    setInstallmentType(row?.installmentType ?? "");
    setNotes(row?.notes ?? "");
    setDeliveryMethod(row?.deliveryMethod ?? "");
    setPaidInstallments(String(row?.paidInstallments ?? 0));
    setTotalInstallments(
      row?.totalInstallments === null || row?.totalInstallments === undefined
        ? ""
        : String(row.totalInstallments),
    );
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
        installmentNumber: row?.installmentNumber ?? "",
        paidInstallments: Number(paidInstallments),
        totalInstallments: totalInstallments ? Number(totalInstallments) : null,
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
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
              <Label htmlFor={`${row?.id ?? "new"}-paid-installments`}>Pagas</Label>
              <Input
                id={`${row?.id ?? "new"}-paid-installments`}
                type="number"
                min={0}
                value={paidInstallments}
                onChange={(event) => setPaidInstallments(event.target.value)}
              />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`${row?.id ?? "new"}-total-installments`}>Total</Label>
                <Input
                  id={`${row?.id ?? "new"}-total-installments`}
                  type="number"
                  min={1}
                  value={totalInstallments}
                  placeholder="Ex.: 13"
                  onChange={(event) => setTotalInstallments(event.target.value)}
                />
              </div>
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
            disabled={
              pending ||
              !clientId ||
              installmentType.trim().length < 2 ||
              !Number.isInteger(Number(paidInstallments)) ||
              Number(paidInstallments) < 0 ||
              (totalInstallments !== "" &&
                (!Number.isInteger(Number(totalInstallments)) ||
                  Number(totalInstallments) < 1 ||
                  Number(paidInstallments) > Number(totalInstallments)))
            }
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
          paidInstallments: row.paidInstallments,
          totalInstallments: row.totalInstallments,
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
              <div className="rounded-md border border-warning/30 bg-warning/5 p-3 text-xs">
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

function InstallmentCard({
  clanId,
  canManage,
  clients,
  row,
  periodYear,
  periodMonth,
}: {
  clanId: string;
  canManage: boolean;
  clients: readonly ClientOption[];
  row: FiscalInstallmentRowView;
  periodYear: number;
  periodMonth: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const periodLabel = `${String(periodMonth).padStart(2, "0")}/${periodYear}`;
  const progress = row.totalInstallments
    ? Math.round((row.paidInstallments / row.totalInstallments) * 100)
    : 0;

  function changePaid(direction: "increase" | "decrease") {
    startTransition(async () => {
      const result = await changeFiscalInstallmentPaid({
        clanId,
        installmentId: row.id,
        direction,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  function toggleGenerated() {
    startTransition(async () => {
      const result = await setFiscalInstallmentGenerated({
        clanId,
        installmentId: row.id,
        periodYear,
        periodMonth,
        generated: !row.generatedThisMonth,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        row.generatedThisMonth
          ? `Geração de ${periodLabel} desmarcada; avanço automático desfeito quando aplicável.`
          : `Parcela de ${periodLabel} gerada e progresso atualizado.`,
      );
      router.refresh();
    });
  }

  return (
    <article
      className={cn(
        "grid gap-4 rounded-lg border bg-card/35 p-4 transition-colors",
        row.generatedThisMonth && "border-success/30 bg-success/[0.035]",
        !row.clientActive && "opacity-60",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-heading text-base font-medium">{row.clientName}</h3>
            {!row.clientActive ? <Badge variant="outline">Inativa</Badge> : null}
            {row.generatedThisMonth ? (
              <Badge className="border-success/30 bg-success/10 text-success">
                <Check aria-hidden /> Gerada em {periodLabel}
              </Badge>
            ) : (
              <Badge variant="outline">Pendente em {periodLabel}</Badge>
            )}
          </div>
          <p className="mt-1 text-sm font-medium text-primary">{row.installmentType}</p>
        </div>
        {canManage ? (
          <div className="flex items-center gap-1">
            <InstallmentFormDialog clanId={clanId} clients={clients} row={row} />
            <DeleteInstallmentDialog clanId={clanId} row={row} />
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <div className="min-w-0 rounded-md bg-muted/25 p-3">
            <span className="hud-label">Caminho / observações</span>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">
              {row.notes ?? "Nenhuma observação cadastrada."}
            </p>
          </div>
          <div className="min-w-0 rounded-md bg-muted/25 p-3">
            <span className="hud-label">Forma de entrega</span>
            <p className="mt-1 break-words text-sm">
              {row.deliveryMethod ?? "Não informada"}
            </p>
          </div>
        </div>

        <div className="grid gap-3 rounded-md border border-border/70 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="hud-label">Parcelas pagas</span>
              <p className="mt-1 font-mono text-lg font-semibold">
                {row.paidInstallments}
                <span className="text-sm font-normal text-muted-foreground">
                  {row.totalInstallments ? ` de ${row.totalInstallments}` : " pagas"}
                </span>
              </p>
            </div>
            {canManage ? (
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  disabled={pending || row.paidInstallments === 0}
                  aria-label="Diminuir uma parcela paga"
                  onClick={() => changePaid("decrease")}
                >
                  <Minus aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  disabled={
                    pending ||
                    (row.totalInstallments !== null &&
                      row.paidInstallments >= row.totalInstallments)
                  }
                  aria-label="Adicionar uma parcela paga"
                  onClick={() => changePaid("increase")}
                >
                  <Plus aria-hidden />
                </Button>
              </div>
            ) : null}
          </div>
          {row.totalInstallments ? <Progress value={progress} /> : null}
          {canManage ? (
            <Button
              type="button"
              variant={row.generatedThisMonth ? "outline" : "default"}
              size="sm"
              disabled={pending}
              onClick={toggleGenerated}
            >
              <CalendarCheck aria-hidden />
              {row.generatedThisMonth
                ? `Desmarcar geração de ${periodLabel}`
                : `Confirmar geração de ${periodLabel}`}
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function FiscalInstallmentBoard({
  clanId,
  canManage,
  rows,
  clients,
  periodYear,
  periodMonth,
  currentYear,
  currentMonth,
}: {
  clanId: string;
  canManage: boolean;
  rows: readonly FiscalInstallmentRowView[];
  clients: readonly ClientOption[];
  periodYear: number;
  periodMonth: number;
  currentYear: number;
  currentMonth: number;
}) {
  const router = useRouter();
  const [periodPending, startPeriodTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [generationFilter, setGenerationFilter] = useState("all");
  const needle = normalize(query.trim());
  const visible = useMemo(
    () => rows.filter((row) => {
      if (generationFilter === "generated" && !row.generatedThisMonth) return false;
      if (generationFilter === "pending" && row.generatedThisMonth) return false;
      return !needle || normalize(
        `${row.clientName} ${row.installmentType} ${row.notes ?? ""} ${row.deliveryMethod ?? ""} ${row.paidInstallments} ${row.totalInstallments ?? ""}`,
      ).includes(needle);
    }),
    [generationFilter, needle, rows],
  );
  const companyCount = new Set(rows.map((row) => row.clientId)).size;
  const generatedCount = rows.filter((row) => row.generatedThisMonth).length;
  const periodLabel = `${String(periodMonth).padStart(2, "0")}/${periodYear}`;
  const years = Array.from(
    new Set([
      ...Array.from({ length: 9 }, (_, index) => currentYear - 5 + index),
      periodYear,
    ]),
  ).sort((left, right) => left - right);

  function navigateToPeriod(year: number, month: number) {
    startPeriodTransition(() => {
      router.push(
        `/clans/${clanId}?tab=installments&fiscalYear=${year}&fiscalMonth=${month}`,
        { scroll: false },
      );
    });
  }

  function movePeriod(offset: number) {
    const date = new Date(Date.UTC(periodYear, periodMonth - 1 + offset, 1));
    navigateToPeriod(date.getUTCFullYear(), date.getUTCMonth() + 1);
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-medium">Controle de parcelamentos</h2>
          <p className="text-sm text-muted-foreground">
            Acompanhe o progresso das parcelas e o que já foi gerado em cada mês.
          </p>
          <p className="mt-1 text-xs text-primary/80">
            Confirmar a geração acrescenta automaticamente uma parcela paga.
          </p>
          <p className="mt-1 text-xs text-warning/80">
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
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card/25 p-3">
        <div>
          <span className="hud-label">Competência consultada</span>
          <p className="mt-1 font-heading text-lg font-medium">
            {MONTH_NAMES[periodMonth - 1]} de {periodYear}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            disabled={periodPending}
            aria-label="Competência anterior"
            onClick={() => movePeriod(-1)}
          >
            <ChevronLeft aria-hidden />
          </Button>
          <Select
            value={String(periodMonth)}
            disabled={periodPending}
            onValueChange={(value) => navigateToPeriod(periodYear, Number(value))}
          >
            <SelectTrigger className="w-36" aria-label="Mês da competência">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTH_NAMES.map((month, index) => (
                <SelectItem key={month} value={String(index + 1)}>{month}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={String(periodYear)}
            disabled={periodPending}
            onValueChange={(value) => navigateToPeriod(Number(value), periodMonth)}
          >
            <SelectTrigger className="w-24" aria-label="Ano da competência">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((year) => (
                <SelectItem key={year} value={String(year)}>{year}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            disabled={periodPending}
            aria-label="Próxima competência"
            onClick={() => movePeriod(1)}
          >
            <ChevronRight aria-hidden />
          </Button>
          {periodYear !== currentYear || periodMonth !== currentMonth ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={periodPending}
              onClick={() => navigateToPeriod(currentYear, currentMonth)}
            >
              Mês atual
            </Button>
          ) : null}
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg bg-muted/40 p-3">
          <span className="text-xs text-muted-foreground">Parcelamentos</span>
          <strong className="block font-mono text-lg">{rows.length}</strong>
        </div>
        <div className="rounded-lg bg-muted/40 p-3">
          <span className="text-xs text-muted-foreground">Empresas</span>
          <strong className="block font-mono text-lg">{companyCount}</strong>
        </div>
        <div className="rounded-lg bg-success/5 p-3">
          <span className="text-xs text-muted-foreground">Geradas em {periodLabel}</span>
          <strong className="block font-mono text-lg text-success">{generatedCount}</strong>
        </div>
        <div className="rounded-lg bg-warning/5 p-3">
          <span className="text-xs text-muted-foreground">Pendentes em {periodLabel}</span>
          <strong className="block font-mono text-lg text-warning">{rows.length - generatedCount}</strong>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_13rem]">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar empresa, parcelamento, entrega ou observação"
            className="pl-9"
          />
        </div>
        <Select value={generationFilter} onValueChange={setGenerationFilter}>
          <SelectTrigger className="w-full" aria-label="Filtrar geração do mês">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas em {periodLabel}</SelectItem>
            <SelectItem value="pending">Pendentes no mês</SelectItem>
            <SelectItem value="generated">Já geradas no mês</SelectItem>
          </SelectContent>
        </Select>
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
        <div className="grid gap-3">
          {visible.map((row) => (
            <InstallmentCard
              key={row.id}
              clanId={clanId}
              canManage={canManage}
              clients={clients}
              row={row}
              periodYear={periodYear}
              periodMonth={periodMonth}
            />
          ))}
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
