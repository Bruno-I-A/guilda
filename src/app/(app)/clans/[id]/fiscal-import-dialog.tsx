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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import {
  applyFiscalImport,
  previewFiscalSpreadsheet,
  type FiscalImportApplyResult,
  type FiscalImportPreview,
} from "./fiscal-import-actions";

type Resolution = {
  clientId: string | null;
  ignored: boolean;
  responsibleUserId: string | null;
};

const COLUMN_LABELS: Record<string, string> = {
  companyName: "Empresas",
  movements: "Movimentos",
  incoming: "Entrada",
  outgoing: "Saída",
  guide: "Guia",
  delivery: "Entrega",
  nfs: "Notas fiscais",
  observations: "Observações",
};

function importedSummary(row: FiscalImportPreview["rows"][number]): string {
  const parts = [
    row.imported.movements ? `Mov.: ${APPLICABILITY_IMPORT_LABEL[row.imported.movements] ?? row.imported.movements}` : null,
    row.imported.incoming ? `Entrada: ${APPLICABILITY_IMPORT_LABEL[row.imported.incoming] ?? row.imported.incoming}` : null,
    row.imported.outgoing ? `Saída: ${APPLICABILITY_IMPORT_LABEL[row.imported.outgoing] ?? row.imported.outgoing}` : null,
    row.imported.guide ? `Guia: ${APPLICABILITY_IMPORT_LABEL[row.imported.guide] ?? row.imported.guide}` : null,
    row.imported.deliveryApplicability
      ? `Envio: ${APPLICABILITY_IMPORT_LABEL[row.imported.deliveryApplicability] ?? row.imported.deliveryApplicability}${row.imported.delivery ? ` (${row.imported.delivery})` : ""}`
      : null,
    row.imported.nfs ? `Notas: ${APPLICABILITY_IMPORT_LABEL[row.imported.nfs] ?? row.imported.nfs}` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

const APPLICABILITY_IMPORT_LABEL: Record<string, string> = {
  yes: "Sim",
  no: "Não",
  not_applicable: "Não se aplica",
  required: "Sim",
  not_required: "Não",
  unknown: "Não informado",
};

const ISSUE_FIELD_LABELS: Record<string, string> = {
  companyName: "Empresa",
  movements: "Movimentos",
  incoming: "Entrada",
  outgoing: "Saída",
  guide: "Guia",
  delivery: "Entrega",
  nfs: "Notas fiscais",
  observations: "Observações",
};

function profileDiffs(
  row: FiscalImportPreview["rows"][number],
  client: FiscalImportPreview["clients"][number] | undefined,
): { field: string; before: string; after: string }[] {
  if (!client) return [];
  const current = client.profile;
  const definitions = [
    ["Movimentos", current?.movements, row.imported.movements],
    ["Entrada", current?.incoming, row.imported.incoming],
    ["Saída", current?.outgoing, row.imported.outgoing],
    ["Guia", current?.guide, row.imported.guide],
    ["Notas fiscais", current?.nfs, row.imported.nfs],
    ["Envio da guia", current?.deliveryApplicability, row.imported.deliveryApplicability],
  ] as const;
  const changes: { field: string; before: string; after: string }[] =
    definitions.flatMap(([field, before, after]) => {
    if (!after) return [];
    const beforeLabel = APPLICABILITY_IMPORT_LABEL[before ?? "unknown"] ?? String(before);
    const afterLabel = APPLICABILITY_IMPORT_LABEL[after] ?? after;
    return beforeLabel === afterLabel
      ? []
      : [{ field, before: beforeLabel, after: afterLabel }];
    });
  if (row.imported.deliveryApplicability && row.imported.delivery !== (current?.delivery ?? null)) {
    changes.push({
      field: "Canal de envio",
      before: current?.delivery ?? "Não informada",
      after: row.imported.delivery ?? "Não informado",
    });
  }
  if (
    row.imported.observations &&
    row.imported.observations !== (current?.observations ?? "")
  ) {
    changes.push({
      field: "Observações",
      before: current?.observations ?? "Sem observações",
      after: row.imported.observations,
    });
  }
  return changes;
}

export function FiscalImportDialog({ clanId }: { clanId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<FiscalImportPreview | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({});
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [clientSearch, setClientSearch] = useState("");
  const [bulkResponsible, setBulkResponsible] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [summary, setSummary] = useState<FiscalImportApplyResult | null>(null);

  const clientNameById = useMemo(
    () => new Map(preview?.clients.map((client) => [client.id, client.name]) ?? []),
    [preview],
  );
  const editingRow = preview?.rows.find((row) => row.id === editingRowId) ?? null;
  const filteredClients = useMemo(() => {
    const query = clientSearch.trim().toLocaleLowerCase("pt-BR");
    if (!query) return preview?.clients ?? [];
    return (preview?.clients ?? []).filter((client) =>
      client.name.toLocaleLowerCase("pt-BR").includes(query),
    );
  }, [clientSearch, preview]);
  const unresolved = preview
    ? preview.rows.filter((row) => {
        const resolution = resolutions[row.id];
        return !resolution?.ignored && !resolution?.clientId;
      }).length
    : 0;
  const selectedCounts = new Map<string, number>();
  for (const resolution of Object.values(resolutions)) {
    if (resolution.ignored || !resolution.clientId) continue;
    selectedCounts.set(resolution.clientId, (selectedCounts.get(resolution.clientId) ?? 0) + 1);
  }
  const duplicatedTargets = new Set(
    [...selectedCounts].filter(([, count]) => count > 1).map(([clientId]) => clientId),
  );

  function buildInitialResolutions(data: FiscalImportPreview) {
    return Object.fromEntries(
      data.rows.map((row) => [
        row.id,
        {
          clientId: row.status === "matched" ? row.suggestedClientId : null,
          ignored: false,
          responsibleUserId: null,
        },
      ]),
    );
  }

  function previewFile(formData: FormData) {
    formData.set("clanId", clanId);
    startTransition(async () => {
      const result = await previewFiscalSpreadsheet(formData);
      if (!result.ok || !result.data) {
        toast.error(result.ok ? "Prévia vazia." : result.error);
        return;
      }
      setPreview(result.data);
      setResolutions(buildInitialResolutions(result.data));
      setSummary(null);
      setConfirmed(false);
      setBulkResponsible("");
      toast.success("Planilha lida. Revise a conciliação antes de aplicar.");
    });
  }

  function setRow(rowId: string, next: Partial<Resolution>) {
    setResolutions((current) => {
      const previous = current[rowId] ?? {
        clientId: null,
        ignored: false,
        responsibleUserId: null,
      };
      return { ...current, [rowId]: { ...previous, ...next } };
    });
    setConfirmed(false);
  }

  function reconcileRow(rowId: string, clientId: string) {
    const previous = resolutions[rowId];
    setRow(rowId, {
      clientId,
      ignored: false,
      responsibleUserId: previous?.clientId === clientId
        ? previous.responsibleUserId
        : null,
    });
    setEditingRowId(null);
  }

  function assignToReconciledRows() {
    if (!preview || !bulkResponsible) return;
    const eligible = new Set(preview.clients.filter((client) =>
      client.active && !client.pendingFiscalAssignment,
    ).map((client) => client.id));
    const count = preview.rows.filter((row) => {
      const resolution = resolutions[row.id];
      return resolution?.clientId && !resolution.ignored && eligible.has(resolution.clientId);
    }).length;
    setResolutions((current) => Object.fromEntries(
      Object.entries(current).map(([rowId, resolution]) => [
        rowId,
        resolution.clientId && !resolution.ignored && eligible.has(resolution.clientId)
          ? { ...resolution, responsibleUserId: bulkResponsible }
          : resolution,
      ]),
    ));
    setConfirmed(false);
    setBulkResponsible("");
    toast.success(`Responsável selecionado para ${count} linha(s).`);
  }

  function apply() {
    if (!preview || unresolved > 0 || duplicatedTargets.size > 0 || !confirmed) return;
    startTransition(async () => {
      const result = await applyFiscalImport({
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
                expectedProfileVersion:
                  preview.clients.find(
                    (client) => client.id === resolution.clientId,
                  )?.profile?.version ?? null,
                responsibleUserId: resolution.responsibleUserId,
                expectedHolderId: preview.clients.find(
                  (client) => client.id === resolution.clientId,
                )?.holderId ?? null,
              };
        }),
      });
      if (!result.ok || !result.data) {
        toast.error(result.ok ? "Importação sem resumo." : result.error);
        return;
      }
      setSummary(result.data);
      toast.success(`${result.data.imported} ficha(s) atualizada(s).`);
      router.refresh();
    });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => {
        setOpen(next);
        if (!next) setEditingRowId(null);
      }}>
        <DialogTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            <FileSpreadsheet aria-hidden /> Importar planilha fiscal
          </Button>
        </DialogTrigger>
        <DialogContent className={cn("max-h-[92vh] overflow-y-auto", editingRow ? "sm:max-w-lg" : "sm:max-w-5xl")}>
          <DialogHeader>
            <DialogTitle>{editingRow ? `Conciliar “${editingRow.sourceName}”` : "Importar e conciliar planilha fiscal"}</DialogTitle>
            <DialogDescription>
              {editingRow
                ? "Escolha uma empresa já cadastrada. Esta decisão será memorizada como alias."
                : "O Excel não precisa ter CNPJ. Confira cada empresa, sua ficha e o responsável antes de aplicar. A importação não cria empresas novas."}
            </DialogDescription>
          </DialogHeader>

          {editingRow ? (
            <div className="grid gap-3">
              {editingRow.suggestions.length > 0 ? (
                <div className="grid gap-1.5">
                  <span className="text-xs font-medium">Sugestões</span>
                  {editingRow.suggestions.map((suggestion) => (
                    <button key={suggestion.clientId} type="button" className="rounded-lg border p-2 text-left text-sm hover:bg-muted/50" onClick={() => reconcileRow(editingRow.id, suggestion.clientId)}>
                      <span className="flex items-center justify-between gap-2"><strong>{suggestion.clientName}</strong><Badge variant="outline">{Math.round(suggestion.score * 100)}%</Badge></span>
                      <span className="text-[11px] text-muted-foreground">{suggestion.reasons[0]}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="grid gap-1.5">
                <Label htmlFor="fiscal-import-client-search">Outra empresa cadastrada</Label>
                <Input
                  id="fiscal-import-client-search"
                  value={clientSearch}
                  placeholder="Digite parte do nome da empresa…"
                  autoFocus
                  onChange={(event) => setClientSearch(event.target.value)}
                />
                <div className="max-h-52 overflow-y-auto rounded-lg border p-1">
                  {filteredClients.length > 0 ? (
                    filteredClients.map((client) => (
                      <button
                        key={client.id}
                        type="button"
                        className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted/60"
                        onClick={() => reconcileRow(editingRow.id, client.id)}
                      >
                        <span>{client.name}</span>
                        {!client.active ? <Badge variant="outline">inativa</Badge> : null}
                      </button>
                    ))
                  ) : (
                    <p className="px-2.5 py-3 text-xs text-muted-foreground">
                      Nenhuma empresa encontrada.
                    </p>
                  )}
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditingRowId(null)}>
                  Voltar à prévia
                </Button>
              </DialogFooter>
            </div>
          ) : !preview ? (
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                previewFile(new FormData(event.currentTarget));
              }}
            >
              <div className="grid gap-1.5">
                <Label htmlFor="fiscal-import-file">Planilha do controle Fiscal</Label>
                <Input id="fiscal-import-file" name="file" type="file" accept=".xlsx" required />
                <p className="text-xs text-muted-foreground">
                  Até 5 MB. Cabeçalhos esperados: Empresas, Movimentos,
                  Entrada, Saída, Guia, Entrega, NFE/NFS e Observações.
                </p>
                <p className="text-xs text-muted-foreground">
                  X, SM e Sim = precisa fazer; célula vazia e Não = não precisa.
                  Em Entrega, Onvio é o canal de envio da guia. SM exige envio,
                  mas deixa o canal pendente para revisão na ficha.
                </p>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={pending}>
                  {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <FileSearch aria-hidden />}
                  Gerar prévia
                </Button>
              </DialogFooter>
            </form>
          ) : summary ? (
            <div className="grid gap-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <div className="rounded-lg bg-success/10 p-3 text-center"><strong className="block font-mono text-xl text-success">{summary.createdProfiles}</strong><span className="text-xs">fichas criadas</span></div>
                <div className="rounded-lg bg-primary/10 p-3 text-center"><strong className="block font-mono text-xl text-primary">{summary.updatedProfiles}</strong><span className="text-xs">atualizadas</span></div>
                <div className="rounded-lg bg-muted/40 p-3 text-center"><strong className="block font-mono text-xl">{summary.unchangedProfiles}</strong><span className="text-xs">sem mudança</span></div>
                <div className="rounded-lg bg-primary/10 p-3 text-center"><strong className="block font-mono text-xl text-primary">{summary.assignedPortfolios}</strong><span className="text-xs">carteiras atribuídas</span></div>
                <div className="rounded-lg bg-muted/40 p-3 text-center"><strong className="block font-mono text-xl">{summary.ignored}</strong><span className="text-xs">ignoradas</span></div>
                <div className="rounded-lg bg-destructive/10 p-3 text-center"><strong className="block font-mono text-xl text-destructive">{summary.errors}</strong><span className="text-xs">rejeitadas/erros</span></div>
                <div className="rounded-lg bg-muted/40 p-3 text-center"><strong className="block font-mono text-xl">{summary.imported}</strong><span className="text-xs">linhas aplicadas</span></div>
              </div>
              <p className="text-sm text-muted-foreground">Os nomes confirmados foram memorizados como aliases para as próximas importações.</p>
              <DialogFooter><Button type="button" onClick={() => setOpen(false)}>Concluir</Button></DialogFooter>
            </div>
          ) : (
            <div className="grid gap-4">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="outline">{preview.fileName}</Badge>
                <span>{preview.rows.length} linha(s)</span>
                <span>{preview.rejected} rejeitada(s)</span>
                <span>{preview.skipped} ignorada(s)</span>
                {preview.missingColumns.length > 0 ? (
                  <Badge variant="outline" className="border-warning/40 text-warning">
                    Sem {preview.missingColumns.map((column) => COLUMN_LABELS[column] ?? column).join(", ")}
                  </Badge>
                ) : null}
              </div>

              {preview.rejectedRows.length > 0 ? (
                <div className="rounded-lg border border-destructive/35 bg-destructive/5 p-3 text-xs">
                  <strong className="text-destructive">Linhas rejeitadas</strong>
                  <ul className="mt-1 grid gap-1 text-muted-foreground">
                    {preview.rejectedRows.map((row) => (
                      <li key={`${row.rowNumber}-${row.message}`}>
                        Linha {row.rowNumber}: {row.message}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/25 p-3">
                <div className="min-w-48 flex-1 space-y-1.5">
                  <Label htmlFor="fiscal-import-bulk-owner">Responsável para linhas conciliadas</Label>
                  <Select value={bulkResponsible} onValueChange={setBulkResponsible}>
                    <SelectTrigger id="fiscal-import-bulk-owner" className="w-full">
                      <SelectValue placeholder="Escolha um integrante do Fiscal" />
                    </SelectTrigger>
                    <SelectContent>
                      {preview.members.map((member) => (
                        <SelectItem key={member.userId} value={member.userId}>{member.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button type="button" variant="outline" disabled={!bulkResponsible} onClick={assignToReconciledRows}>
                  Atribuir às conciliadas
                </Button>
                <p className="w-full text-xs text-muted-foreground">
                  Aplica às linhas já conciliadas e aptas. Você pode ajustar cada responsável abaixo; deixar sem escolha preserva a carteira atual.
                </p>
              </div>

              <div className="grid max-h-[48vh] gap-2 overflow-y-auto pr-1">
                {preview.rows.map((row) => {
                  const resolution = resolutions[row.id];
                  const selectedName = resolution?.clientId ? clientNameById.get(resolution.clientId) : null;
                  const selectedClient = preview.clients.find(
                    (client) => client.id === resolution?.clientId,
                  );
                  const diffs = profileDiffs(row, selectedClient);
                  return (
                    <article key={row.id} className="grid gap-2 rounded-lg border bg-card/50 p-3 sm:grid-cols-[minmax(12rem,1fr)_minmax(14rem,1fr)_auto] sm:items-center">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5"><span className="font-mono text-xs text-muted-foreground">#{row.rowNumber}</span><strong className="truncate">{row.sourceName}</strong></div>
                        <p className="truncate text-[11px] text-muted-foreground">{importedSummary(row) || "Somente observações"}</p>
                        {row.imported.observations ? <p className="line-clamp-2 text-[11px] text-muted-foreground">{row.imported.observations}</p> : null}
                      </div>
                      <div className="min-w-0">
                        {resolution?.ignored ? (
                          <Badge variant="outline">Linha ignorada</Badge>
                        ) : selectedName ? (
                          <p className="flex items-center gap-1.5 text-sm"><Check className="size-4 text-success" aria-hidden /><span className="truncate">{selectedName}</span>{duplicatedTargets.has(resolution.clientId!) ? <Badge variant="outline" className="border-warning/40 text-warning">duplicada</Badge> : null}{selectedClient && !selectedClient.active ? <Badge variant="outline">inativa</Badge> : null}{row.status !== "matched" ? <Badge variant="outline">confirmada manualmente</Badge> : null}</p>
                        ) : (
                          <p className="flex items-center gap-1.5 text-sm text-destructive"><AlertTriangle className="size-4" aria-hidden /> Sem conciliação</p>
                        )}
                        <p className="line-clamp-2 text-[11px] text-muted-foreground">{row.explanation}</p>
                        {row.issues.length > 0 ? (
                          <p className="text-[11px] text-warning">
                            {row.issues
                              .map((issue) =>
                                `${ISSUE_FIELD_LABELS[issue.field] ?? issue.field}: ${issue.message}${issue.raw ? ` (“${issue.raw}”)` : ""}`,
                              )
                              .join(" ")}
                          </p>
                        ) : null}
                        {selectedClient ? (
                          <details className="mt-1 text-[11px]">
                            <summary className="cursor-pointer text-muted-foreground">
                              {diffs.length > 0
                                ? `${diffs.length} alteração(ões) na ficha`
                                : "Nenhuma alteração na ficha"}
                            </summary>
                            {diffs.length > 0 ? (
                              <ul className="mt-1 grid gap-1 rounded border bg-muted/30 p-2">
                                {diffs.map((diff) => (
                                  <li key={diff.field}>
                                    <strong>{diff.field}:</strong>{" "}
                                    <span className="line-clamp-2 text-muted-foreground">{diff.before}</span>
                                    <span aria-hidden> → </span>
                                    <span className="line-clamp-2">{diff.after}</span>
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </details>
                        ) : null}
                        {selectedClient ? (
                          <div className="mt-2 grid gap-1">
                            <span className="text-xs text-muted-foreground">
                              Atual: {selectedClient.holderName ?? "sem responsável"}
                            </span>
                            <Select
                              value={resolution?.responsibleUserId ?? "__keep__"}
                              onValueChange={(userId) => setRow(row.id, {
                                responsibleUserId: userId === "__keep__" ? null : userId,
                              })}
                              disabled={resolution?.ignored || !selectedClient.active || selectedClient.pendingFiscalAssignment}
                            >
                              <SelectTrigger className="w-full" aria-label={`Responsável fiscal de ${row.sourceName}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__keep__">Manter responsável atual</SelectItem>
                                {preview.members.map((member) => (
                                  <SelectItem key={member.userId} value={member.userId}>{member.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {selectedClient.pendingFiscalAssignment ? (
                              <span className="text-xs text-warning">Empresa nova: confirme a entrada na carteira separadamente.</span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      <div className="flex gap-1">
                        <Button type="button" variant="outline" size="sm" onClick={() => { setClientSearch(""); setEditingRowId(row.id); }}><Pencil aria-hidden /> Conciliar</Button>
                        <Button type="button" variant="ghost" size="icon-sm" aria-label="Ignorar linha" onClick={() => setRow(row.id, { clientId: null, ignored: !resolution?.ignored })}>{resolution?.ignored ? <Upload aria-hidden /> : <X aria-hidden />}</Button>
                      </div>
                    </article>
                  );
                })}
              </div>

              <label className="flex items-start gap-2 rounded-lg border bg-muted/25 p-3 text-xs">
                <input type="checkbox" className="mt-0.5 accent-primary" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
                <span>Revisei as conciliações e os responsáveis. Autorizo atualizar as Fichas Fiscais e atribuir as carteiras selecionadas. Células vazias nas colunas presentes significam “não precisa fazer”; colunas ausentes serão preservadas. Sem escolha de responsável, a carteira atual permanece.</span>
              </label>
              {unresolved > 0 ? <p className="text-xs text-destructive">Concilie ou ignore {unresolved} linha(s) antes de aplicar.</p> : null}
              {duplicatedTargets.size > 0 ? <p className="text-xs text-warning">Há linhas apontando para a mesma empresa. Concilie com empresas diferentes ou ignore a linha duplicada antes de aplicar.</p> : null}
              <DialogFooter>
                <Button type="button" variant="outline" disabled={pending} onClick={() => { setPreview(null); setResolutions({}); }}>Escolher outro arquivo</Button>
                <Button type="button" disabled={pending || unresolved > 0 || duplicatedTargets.size > 0 || !confirmed} onClick={apply}>{pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Upload aria-hidden />} Aplicar importação</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

    </>
  );
}
