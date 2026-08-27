"use client";

import {
  AlertTriangle,
  Check,
  FileSearch,
  FileSpreadsheet,
  LoaderCircle,
  Pencil,
  Upload,
  X,
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
import { formatCnpj } from "@/domain/cnpj";
import type { OfficeFeeBillingMethod } from "@/domain/office-fee-control";

import {
  applyOfficeFeeImport,
  previewOfficeFeeSpreadsheet,
  type OfficeFeeImportApplyResult,
  type OfficeFeeImportPreview,
} from "./office-fee-import-actions";
import { OFFICE_FEE_BILLING_LABELS } from "./office-fee-profile-dialog";

type Resolution = { clientId: string | null; ignored: boolean };

const COLUMN_LABELS: Record<string, string> = {
  companyName: "Clientes",
  cnpj: "CNPJ",
  billingMethod: "Cobrança",
  additionalInstallment: "Parcela adicional",
  monthlyFee: "Honorário",
  observations: "Observações",
};

function money(value: string | null): string {
  if (!value) return "não informado";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value));
}

function importSummary(row: OfficeFeeImportPreview["rows"][number]): string {
  const method = row.imported.billingMethod as OfficeFeeBillingMethod | null;
  return [
    method ? OFFICE_FEE_BILLING_LABELS[method] ?? method : null,
    row.imported.chargesAdditionalInstallment === null ? null : row.imported.chargesAdditionalInstallment ? "com parcela adicional" : "sem parcela adicional",
    money(row.imported.monthlyFee),
  ].filter(Boolean).join(" · ");
}

function diffs(
  row: OfficeFeeImportPreview["rows"][number],
  client: OfficeFeeImportPreview["clients"][number] | undefined,
): { field: string; before: string; after: string }[] {
  if (!client) return [];
  const current = client.profile;
  const method = row.imported.billingMethod as OfficeFeeBillingMethod | null;
  const values = [
    ["Cobrança", current?.billingMethod ? OFFICE_FEE_BILLING_LABELS[current.billingMethod as OfficeFeeBillingMethod] : "Não cadastrada", method ? OFFICE_FEE_BILLING_LABELS[method] : null],
    ["Parcela adicional", current?.chargesAdditionalInstallment ? "Sim" : "Não", row.imported.chargesAdditionalInstallment === null ? null : row.imported.chargesAdditionalInstallment ? "Sim" : "Não"],
    ["Honorário mensal", current ? money(current.monthlyFee) : "Não cadastrado", row.imported.monthlyFee ? money(row.imported.monthlyFee) : null],
    ["Observações", current?.observations ?? "Sem observações", row.imported.observations],
  ] as const;
  return values.flatMap(([field, before, after]) => after !== null && before !== after ? [{ field, before, after }] : []);
}

export function OfficeFeeImportDialog({ clanId }: { clanId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<OfficeFeeImportPreview | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({});
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [clientSearch, setClientSearch] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [summary, setSummary] = useState<OfficeFeeImportApplyResult | null>(null);
  const clientNameById = useMemo(
    () => new Map(preview?.clients.map((client) => [client.id, client.name]) ?? []),
    [preview],
  );
  const editingRow = preview?.rows.find((row) => row.id === editingRowId) ?? null;
  const filteredClients = useMemo(() => {
    const query = clientSearch.trim().toLocaleLowerCase("pt-BR");
    if (!query) return preview?.clients ?? [];
    return (preview?.clients ?? []).filter((client) =>
      `${client.name} ${client.cnpj ?? ""}`.toLocaleLowerCase("pt-BR").includes(query),
    );
  }, [clientSearch, preview]);
  const unresolved = preview?.rows.filter((row) => {
    const resolution = resolutions[row.id];
    return !resolution?.ignored && !resolution?.clientId;
  }).length ?? 0;

  function setRow(rowId: string, resolution: Resolution) {
    setResolutions((current) => ({ ...current, [rowId]: resolution }));
    setConfirmed(false);
  }

  function previewFile(formData: FormData) {
    formData.set("clanId", clanId);
    startTransition(async () => {
      const result = await previewOfficeFeeSpreadsheet(formData);
      if (!result.ok || !result.data) {
        toast.error(result.ok ? "Prévia vazia." : result.error);
        return;
      }
      setPreview(result.data);
      setResolutions(Object.fromEntries(result.data.rows.map((row) => [
        row.id,
        { clientId: row.status === "matched" ? row.suggestedClientId : null, ignored: false },
      ])));
      setConfirmed(false);
      setSummary(null);
      toast.success("Planilha lida. Revise cada conciliação antes de aplicar.");
    });
  }

  function apply() {
    if (!preview || unresolved > 0 || !confirmed) return;
    startTransition(async () => {
      const result = await applyOfficeFeeImport({
        clanId,
        batchId: preview.batchId,
        resolutions: preview.rows.map((row) => {
          const resolution = resolutions[row.id]!;
          return resolution.ignored
            ? { rowId: row.id, action: "ignore" as const }
            : {
                rowId: row.id,
                action: "apply" as const,
                clientId: resolution.clientId!,
                expectedProfileVersion: preview.clients.find((client) => client.id === resolution.clientId)?.profile?.version ?? null,
              };
        }),
      });
      if (!result.ok || !result.data) {
        toast.error(result.ok ? "Importação sem resumo." : result.error);
        return;
      }
      setSummary(result.data);
      toast.success(`${result.data.imported} honorário(s) aplicado(s).`);
      router.refresh();
    });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button type="button" variant="outline" size="sm"><FileSpreadsheet aria-hidden /> Importar planilha</Button>
        </DialogTrigger>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Importar controle de honorários</DialogTitle>
            <DialogDescription>
              Lê Clientes, CNPJ, Cobrança, parcela adicional, Honorário e Observações. O CNPJ é usado primeiro quando existir; diferenças de nome precisam de confirmação humana.
            </DialogDescription>
          </DialogHeader>
          {!preview ? (
            <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); previewFile(new FormData(event.currentTarget)); }}>
              <div className="grid gap-1.5">
                <Label htmlFor="office-fee-import-file">Planilha de controle de notas</Label>
                <Input id="office-fee-import-file" name="file" type="file" accept=".xlsx" required />
                <p className="text-xs text-muted-foreground">Até 5 MB. Nenhuma empresa é criada automaticamente.</p>
              </div>
              <DialogFooter><Button type="submit" disabled={pending}>{pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <FileSearch aria-hidden />} Gerar prévia</Button></DialogFooter>
            </form>
          ) : summary ? (
            <div className="grid gap-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-lg bg-success/10 p-3 text-center"><strong className="block font-mono text-xl text-success">{summary.createdProfiles}</strong><span className="text-xs">cadastros criados</span></div>
                <div className="rounded-lg bg-primary/10 p-3 text-center"><strong className="block font-mono text-xl text-primary">{summary.updatedProfiles}</strong><span className="text-xs">atualizados</span></div>
                <div className="rounded-lg bg-muted/40 p-3 text-center"><strong className="block font-mono text-xl">{summary.unchangedProfiles}</strong><span className="text-xs">sem mudança</span></div>
                <div className="rounded-lg bg-muted/40 p-3 text-center"><strong className="block font-mono text-xl">{summary.cnpjsAdded}</strong><span className="text-xs">CNPJ(s) incluído(s)</span></div>
              </div>
              <p className="text-sm text-muted-foreground">Os nomes conciliados foram memorizados para as próximas importações.</p>
              <DialogFooter><Button type="button" onClick={() => setOpen(false)}>Concluir</Button></DialogFooter>
            </div>
          ) : (
            <div className="grid gap-4">
              <div className="flex flex-wrap items-center gap-2 text-xs"><Badge variant="outline">{preview.fileName}</Badge><span>{preview.rows.length} linha(s)</span><span>{preview.rejected} rejeitada(s)</span><span>{preview.skipped} ignorada(s)</span>{preview.missingColumns.length > 0 ? <Badge variant="outline" className="border-warning/40 text-warning">Sem {preview.missingColumns.map((column) => COLUMN_LABELS[column] ?? column).join(", ")}</Badge> : null}</div>
              {preview.rejectedRows.length > 0 ? <div className="rounded-lg border border-destructive/35 bg-destructive/5 p-3 text-xs"><strong className="text-destructive">Linhas rejeitadas</strong><ul className="mt-1 grid gap-1 text-muted-foreground">{preview.rejectedRows.map((row) => <li key={`${row.rowNumber}-${row.message}`}>Linha {row.rowNumber}: {row.message}</li>)}</ul></div> : null}
              <div className="grid max-h-[48vh] gap-2 overflow-y-auto pr-1">
                {preview.rows.map((row) => {
                  const resolution = resolutions[row.id];
                  const selectedName = resolution?.clientId ? clientNameById.get(resolution.clientId) : null;
                  const selectedClient = preview.clients.find((client) => client.id === resolution?.clientId);
                  const changes = diffs(row, selectedClient);
                  return <article key={row.id} className="grid gap-2 rounded-lg border bg-card/50 p-3 sm:grid-cols-[minmax(12rem,1fr)_minmax(14rem,1fr)_auto] sm:items-center">
                    <div className="min-w-0"><div className="flex items-center gap-1.5"><span className="font-mono text-xs text-muted-foreground">#{row.rowNumber}</span><strong className="truncate">{row.sourceName}</strong></div><p className="truncate text-[11px] text-muted-foreground">{importSummary(row)}</p>{row.imported.cnpj ? <p className="text-[11px] text-muted-foreground">{formatCnpj(row.imported.cnpj)}</p> : null}{row.imported.observations ? <p className="line-clamp-2 text-[11px] text-muted-foreground">{row.imported.observations}</p> : null}</div>
                    <div className="min-w-0">{resolution?.ignored ? <Badge variant="outline">Linha ignorada</Badge> : selectedName ? <p className="flex items-center gap-1.5 text-sm"><Check className="size-4 text-success" aria-hidden /><span className="truncate">{selectedName}</span>{selectedClient && !selectedClient.active ? <Badge variant="outline">inativa</Badge> : null}{row.status !== "matched" ? <Badge variant="outline">confirmada manualmente</Badge> : null}</p> : <p className="flex items-center gap-1.5 text-sm text-destructive"><AlertTriangle className="size-4" aria-hidden /> Sem conciliação</p>}<p className="line-clamp-2 text-[11px] text-muted-foreground">{row.explanation}</p>{row.issues.length > 0 ? <p className="text-[11px] text-warning">{row.issues.map((issue) => `${COLUMN_LABELS[issue.field] ?? issue.field}: ${issue.message}`).join(" ")}</p> : null}{selectedClient ? <details className="mt-1 text-[11px]"><summary className="cursor-pointer text-muted-foreground">{changes.length > 0 ? `${changes.length} alteração(ões) no cadastro` : "Nenhuma alteração no cadastro"}</summary>{changes.length > 0 ? <ul className="mt-1 grid gap-1 rounded border bg-muted/30 p-2">{changes.map((change) => <li key={change.field}><strong>{change.field}:</strong> <span className="text-muted-foreground">{change.before}</span><span aria-hidden> → </span>{change.after}</li>)}</ul> : null}</details> : null}</div>
                    <div className="flex gap-1"><Button type="button" variant="outline" size="sm" onClick={() => { setClientSearch(""); setEditingRowId(row.id); }}><Pencil aria-hidden /> Conciliar</Button><Button type="button" variant="ghost" size="icon-sm" aria-label="Ignorar linha" onClick={() => setRow(row.id, { clientId: null, ignored: !resolution?.ignored })}>{resolution?.ignored ? <Upload aria-hidden /> : <X aria-hidden />}</Button></div>
                  </article>;
                })}
              </div>
              <label className="flex items-start gap-2 rounded-lg border bg-muted/25 p-3 text-xs"><input type="checkbox" className="mt-0.5 accent-primary" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>Revisei as conciliações e autorizo atualizar os honorários do escritório. A planilha não substitui uma ficha que mudou depois desta prévia.</span></label>
              {unresolved > 0 ? <p className="text-xs text-destructive">Concilie ou ignore {unresolved} linha(s) antes de aplicar.</p> : null}
              <DialogFooter><Button type="button" variant="outline" disabled={pending} onClick={() => { setPreview(null); setResolutions({}); }}>Escolher outro arquivo</Button><Button type="button" disabled={pending || unresolved > 0 || !confirmed} onClick={apply}>{pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Upload aria-hidden />} Aplicar importação</Button></DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(editingRow)} onOpenChange={(next) => !next && setEditingRowId(null)}>
        <DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Conciliar “{editingRow?.sourceName}”</DialogTitle><DialogDescription>Escolha uma empresa já cadastrada. A escolha fica memorizada como alias.</DialogDescription></DialogHeader>{editingRow ? <div className="grid gap-3">{editingRow.suggestions.length > 0 ? <div className="grid gap-1.5"><span className="text-xs font-medium">Sugestões</span>{editingRow.suggestions.map((suggestion) => <button key={suggestion.clientId} type="button" className="rounded-lg border p-2 text-left text-sm hover:bg-muted/50" onClick={() => { setRow(editingRow.id, { clientId: suggestion.clientId, ignored: false }); setEditingRowId(null); }}><span className="flex items-center justify-between gap-2"><strong>{suggestion.clientName}</strong><Badge variant="outline">{Math.round(suggestion.score * 100)}%</Badge></span><span className="text-[11px] text-muted-foreground">{suggestion.reasons[0]}</span></button>)}</div> : null}<div className="grid gap-1.5"><Label>Outra empresa cadastrada</Label><Input value={clientSearch} placeholder="Digite parte do nome ou CNPJ…" autoFocus onChange={(event) => setClientSearch(event.target.value)} /><div className="max-h-52 overflow-y-auto rounded-lg border p-1">{filteredClients.length > 0 ? filteredClients.map((client) => <button key={client.id} type="button" className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted/60" onClick={() => { setRow(editingRow.id, { clientId: client.id, ignored: false }); setEditingRowId(null); }}><span className="truncate">{client.name}</span>{client.cnpj ? <span className="font-mono text-[10px] text-muted-foreground">{formatCnpj(client.cnpj)}</span> : null}</button>) : <p className="p-3 text-sm text-muted-foreground">Nenhuma empresa encontrada.</p>}</div></div></div> : null}</DialogContent>
      </Dialog>
    </>
  );
}
