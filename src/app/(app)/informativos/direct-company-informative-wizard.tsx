"use client";

import { ArrowLeft, ScanText, Search, X } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { directCompanyInformativeText } from "@/domain/company-flow";
import { formatCnpj } from "@/domain/cnpj";
import { TAX_REGIME_LABELS, type TaxRegime } from "@/lib/clients-ui";

import { analyzeInformative } from "./actions";

type DirectInformativeKind = "amendment" | "closure";

type ClientOption = {
  id: string;
  name: string;
  cnpj: string | null;
  taxRegime: TaxRegime;
};

const DEFAULT_CLOSURE_ACTIONS = [
  "SOCIETÁRIO – Baixar o Alvará.",
  "CONTABILIDADE – Finalizar lançamentos até a data da baixa.",
  "FISCAL – Finalizar todos os informativos da empresa até a data da baixa.",
  "RH – Baixar folha e pró-labore ou confirmar que já foram baixados.",
  "SUCESSO DO CLIENTE – Separar a documentação, confeccionar o Protocolo de entrega, combinar a entrega e cobrar a baixa.",
  "SUCESSO DO CLIENTE – Retirar empresa do E-Auditoria.",
  "SUCESSO DO CLIENTE – Retirar empresa do Onvio.",
].join("\n");

export function DirectCompanyInformativeWizard({
  kind,
  clients,
  onDone,
}: {
  kind: DirectInformativeKind;
  clients: readonly ClientOption[];
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [details, setDetails] = useState("");
  const [actions, setActions] = useState(
    kind === "closure" ? DEFAULT_CLOSURE_ACTIONS : "",
  );
  const selected = clients.find((client) => client.id === selectedId) ?? null;
  const matches = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("pt-BR");
    return clients
      .filter((client) =>
        !query || client.name.toLocaleLowerCase("pt-BR").includes(query),
      )
      .slice(0, 12);
  }, [clients, search]);
  const amendment = kind === "amendment";

  function analyze() {
    if (!selected || (amendment && !details.trim())) return;
    startTransition(async () => {
      const result = await analyzeInformative({
        sourceText: directCompanyInformativeText({
          kind,
          companyName: selected.name,
          cnpj: selected.cnpj,
          taxRegime: selected.taxRegime,
          details,
          actions,
        }),
        directCompany: {
          clientId: selected.id,
          kind,
        },
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        amendment
          ? "Prévia de alteração gerada. Confira antes de confirmar."
          : "Prévia de baixa gerada. Confira as missões.",
      );
      onDone();
    });
  }

  return (
    <div className="panel-cut grid gap-4 rounded-lg border bg-card/50 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="hud-label">
            {amendment ? "Informativo de alteração" : "Informativo de baixa"}
          </p>
          <p className="text-sm text-muted-foreground">
            Criação direta em Informativos, sem abrir Fluxo para o Societário.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onDone} disabled={pending}>
          <X className="size-4" aria-hidden /> Fechar
        </Button>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={`direct-${kind}-company`}>Empresa</Label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            id={`direct-${kind}-company`}
            className="pl-9"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setSelectedId("");
              setPickerOpen(true);
            }}
            onFocus={() => setPickerOpen(true)}
            placeholder="Pesquise pelo nome da empresa"
          />
          {pickerOpen ? (
            <div className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
              {matches.length > 0 ? (
                matches.map((client) => (
                  <button
                    key={client.id}
                    type="button"
                    className="flex w-full flex-col rounded-sm px-2 py-2 text-left text-sm hover:bg-accent"
                    onClick={() => {
                      setSelectedId(client.id);
                      setSearch(client.name);
                      setPickerOpen(false);
                    }}
                  >
                    <span>{client.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {client.cnpj ? formatCnpj(client.cnpj) : "CNPJ não informado"}
                      {" · "}
                      {TAX_REGIME_LABELS[client.taxRegime]}
                    </span>
                  </button>
                ))
              ) : (
                <p className="px-2 py-2 text-sm text-muted-foreground">
                  Nenhuma empresa encontrada.
                </p>
              )}
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={`direct-${kind}-details`}>
          {amendment ? "O que foi alterado *" : "Observações da baixa"}
        </Label>
        <Textarea
          id={`direct-${kind}-details`}
          value={details}
          onChange={(event) => setDetails(event.target.value)}
          rows={5}
          placeholder={
            amendment
              ? "Descreva claramente os dados anteriores e os novos dados."
              : "Data da baixa, cobrança e demais observações."
          }
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={`direct-${kind}-actions`}>Missões do Informativo</Label>
        <Textarea
          id={`direct-${kind}-actions`}
          value={actions}
          onChange={(event) => setActions(event.target.value)}
          rows={amendment ? 5 : 9}
          placeholder={
            "Uma missão por linha, no formato:\nFiscal – Atualizar cadastro da empresa"
          }
        />
        <p className="text-xs text-muted-foreground">
          {amendment
            ? "Pode ficar vazio quando a alteração servir somente como aviso no mural."
            : "As missões padrão podem ser editadas, removidas ou complementadas antes da prévia."}
        </p>
      </div>

      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onDone} disabled={pending}>
          <ArrowLeft className="size-4" aria-hidden /> Voltar
        </Button>
        <Button
          onClick={analyze}
          disabled={pending || !selected || (amendment && !details.trim())}
        >
          <ScanText className="size-4" aria-hidden /> Gerar prévia
        </Button>
      </div>
    </div>
  );
}
