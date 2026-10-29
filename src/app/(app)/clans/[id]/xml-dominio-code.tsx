"use client";

import { FileSpreadsheet, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatCnpj } from "@/domain/cnpj";
import type { XmlCompanyView } from "@/lib/nfse/xml-requests";
import { cn } from "@/lib/utils";

import { importDominioCodes, setClientDominioCode, type DominioCodeImportResult } from "./nfse-xml-actions";

/**
 * O código da empresa na Domínio, na própria linha: é ele que dá à pasta do
 * .zip o nome "<código>-<razão social>" que a importação de lá exige.
 */
export function DominioCodeField({ clanId, company, canManage }: { clanId: string; company: XmlCompanyView; canManage: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(company.dominioCode ?? "");
  const [pending, startTransition] = useTransition();

  function save() {
    if (value.trim() === (company.dominioCode ?? "")) {
      setEditing(false);
      return;
    }
    startTransition(async () => {
      const result = await setClientDominioCode({ clanId, clientId: company.clientId, code: value });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const code = result.data?.code ?? null;
      toast.success(code ? `Código ${code} salvo em ${company.name}.` : `Código da Domínio tirado de ${company.name}.`);
      setEditing(false);
      router.refresh();
    });
  }

  if (editing) {
    return (
      <form
        className="flex flex-wrap items-center gap-1.5 text-xs"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <label htmlFor={`dominio-${company.clientId}`} className="text-muted-foreground">Código na Domínio</label>
        <Input
          id={`dominio-${company.clientId}`}
          autoFocus
          inputMode="numeric"
          maxLength={10}
          autoComplete="off"
          className="h-8 w-24 font-mono"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setValue(company.dominioCode ?? "");
              setEditing(false);
            }
          }}
        />
        <Button type="submit" size="sm" disabled={pending}>Salvar</Button>
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => { setValue(company.dominioCode ?? ""); setEditing(false); }}>
          Cancelar
        </Button>
      </form>
    );
  }

  const missing = !company.dominioCode;
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">Domínio:</span>
      {missing ? (
        <span className={cn(company.service.issues ? "text-warning" : "text-muted-foreground")}>sem código</span>
      ) : (
        <span className="font-mono">{company.dominioCode}</span>
      )}
      {canManage ? (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="touch-target inline-flex min-h-8 items-center gap-1 px-1.5 text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={missing ? `Informar o código da Domínio de ${company.name}` : `Trocar o código da Domínio de ${company.name}`}
        >
          <Pencil className="size-3" aria-hidden /> {missing ? "Informar" : "Trocar"}
        </button>
      ) : null}
    </span>
  );
}

function Summary({ result }: { result: DominioCodeImportResult }) {
  const lists: { title: string; tone: string; items: string[] }[] = [
    {
      title: result.saved ? `Gravados (${result.updates.length})` : `A gravar (${result.updates.length})`,
      tone: "text-success",
      items: result.updates.map((update) => `${update.name}: ${update.from ? `${update.from} → ` : ""}${update.to}`),
    },
    {
      title: `Conflitos, não gravados (${result.conflicts.length})`,
      tone: "text-destructive",
      items: result.conflicts.map((conflict) => `Linha ${conflict.rowNumber} · ${conflict.name} · código ${conflict.code}: ${conflict.message}`),
    },
    {
      title: `CNPJ que não está na Guilda (${result.notFound.length})`,
      tone: "text-warning",
      items: result.notFound.map((row) => `Linha ${row.rowNumber} · ${formatCnpj(row.cnpj)} · código ${row.code}`),
    },
    {
      title: `Linhas ignoradas (${result.rejected.length})`,
      tone: "text-muted-foreground",
      items: result.rejected.map((row) => `Linha ${row.rowNumber}: ${row.message}`),
    },
  ];
  return (
    <div className="grid gap-3 text-sm" aria-live="polite">
      {result.unchanged > 0 ? <p className="text-muted-foreground">{result.unchanged} empresa(s) já estavam com o mesmo código.</p> : null}
      {lists
        .filter((list) => list.items.length > 0)
        .map((list) => (
          <section key={list.title} className="grid gap-1">
            <h3 className={list.tone}>{list.title}</h3>
            <ul className="max-h-40 overflow-y-auto rounded-md border border-border/70 bg-card/60 px-3 py-2 font-mono text-xs leading-relaxed">
              {list.items.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </section>
        ))}
    </div>
  );
}

/** Códigos de todas as empresas de uma vez, pela lista exportada da Domínio. */
export function ImportDominioCodesDialog({ clanId }: { clanId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<DominioCodeImportResult | null>(null);
  const [pending, startTransition] = useTransition();

  function send(confirm: boolean) {
    if (!file) return;
    const form = new FormData();
    form.set("clanId", clanId);
    form.set("confirm", confirm ? "1" : "0");
    form.set("file", file);
    startTransition(async () => {
      const response = await importDominioCodes(form);
      if (!response.ok || !response.data) {
        toast.error(response.ok ? "Resposta vazia." : response.error);
        return;
      }
      setResult(response.data);
      if (confirm) {
        toast.success(`${response.data.updates.length} código(s) da Domínio gravado(s).`);
        router.refresh();
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setFile(null);
          setResult(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline">
          <FileSpreadsheet aria-hidden /> Importar códigos da Domínio
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto break-words sm:max-w-lg" aria-busy={pending}>
        <DialogHeader>
          <DialogTitle>Códigos da Domínio</DialogTitle>
          <DialogDescription>
            Exporte da Domínio a lista de empresas com as colunas Código e CNPJ, salve em .xlsx ou .csv e envie aqui. A Guilda
            casa pelo CNPJ e mostra o que muda antes de gravar.
          </DialogDescription>
        </DialogHeader>
        <Input
          type="file"
          accept=".xlsx,.csv"
          aria-label="Planilha com os códigos da Domínio"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setResult(null);
          }}
        />
        {result ? <Summary result={result} /> : null}
        <DialogFooter>
          {result?.saved ? (
            <Button type="button" onClick={() => setOpen(false)}>Fechar</Button>
          ) : result ? (
            <Button type="button" disabled={pending || result.updates.length === 0} onClick={() => send(true)}>
              {result.updates.length === 0 ? "Nada a gravar" : `Gravar ${result.updates.length} código(s)`}
            </Button>
          ) : (
            <Button type="button" disabled={pending || !file} onClick={() => send(false)}>
              Conferir a planilha
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
