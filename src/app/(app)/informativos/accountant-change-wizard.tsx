"use client";

import { ArrowLeft, ScanText, Search, X } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { accountantChangeInformativeText } from "@/domain/company-flow";
import { formatCnpj } from "@/domain/cnpj";
import { TAX_REGIME_LABELS, type TaxRegime } from "@/lib/clients-ui";

import { analyzeInformative } from "./actions";

type ClientOption = {
  id: string;
  name: string;
  cnpj: string | null;
  taxRegime: TaxRegime;
};

/**
 * Desligamento não exige processamento societário. Este formulário prepara o
 * texto padrão diretamente em Informativos e segue para a mesma prévia de
 * missões usada pelos demais avisos.
 */
export function AccountantChangeWizard({
  clients,
  onDone,
}: {
  clients: readonly ClientOption[];
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [responsibilityUntil, setResponsibilityUntil] = useState("");
  const [address, setAddress] = useState("");
  const [observations, setObservations] = useState("");
  const [additionalActions, setAdditionalActions] = useState("");
  const selected = clients.find((client) => client.id === selectedId) ?? null;
  const matches = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("pt-BR");
    return clients
      .filter((client) => !query || client.name.toLocaleLowerCase("pt-BR").includes(query))
      .slice(0, 12);
  }, [clients, search]);

  function analyze() {
    if (!selected || !responsibilityUntil) return;
    startTransition(async () => {
      const result = await analyzeInformative({
        sourceText: accountantChangeInformativeText({
          companyName: selected.name,
          cnpj: selected.cnpj,
          taxRegime: selected.taxRegime,
          address,
          responsibilityUntil,
          observations,
          additionalActions,
        }),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Prévia de desligamento gerada. Confira as missões.");
      onDone();
    });
  }

  return (
    <div className="panel-cut grid gap-4 rounded-lg border bg-card/50 p-4">
      <div className="flex items-center justify-between gap-2">
        <div><p className="hud-label">Baixa por desligamento</p><p className="text-sm text-muted-foreground">Este informativo é criado direto, sem passar pelo Societário.</p></div>
        <Button variant="ghost" size="sm" onClick={onDone} disabled={pending}><X className="size-4" aria-hidden /> Fechar</Button>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="accountant-change-company">Empresa</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input id="accountant-change-company" className="pl-9" value={search} onChange={(event) => { setSearch(event.target.value); setSelectedId(""); setPickerOpen(true); }} onFocus={() => setPickerOpen(true)} placeholder="Pesquise pelo nome da empresa" />
          {pickerOpen ? <div className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md">{matches.length > 0 ? matches.map((client) => <button key={client.id} type="button" className="flex w-full flex-col rounded-sm px-2 py-2 text-left text-sm hover:bg-accent" onClick={() => { setSelectedId(client.id); setSearch(client.name); setPickerOpen(false); }}><span>{client.name}</span><span className="text-xs text-muted-foreground">{client.cnpj ? formatCnpj(client.cnpj) : "CNPJ não informado"} · {TAX_REGIME_LABELS[client.taxRegime]}</span></button>) : <p className="px-2 py-2 text-sm text-muted-foreground">Nenhuma empresa encontrada.</p>}</div> : null}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5"><Label htmlFor="accountant-change-responsibility">Responsabilidade do escritório até *</Label><Input id="accountant-change-responsibility" type="date" value={responsibilityUntil} onChange={(event) => setResponsibilityUntil(event.target.value)} /></div>
        <div className="grid gap-1.5"><Label htmlFor="accountant-change-address">Endereço</Label><Input id="accountant-change-address" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Ex.: Getúlio Vargas" /></div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="accountant-change-actions">Missões adicionais</Label>
        <Textarea
          id="accountant-change-actions"
          value={additionalActions}
          onChange={(event) => setAdditionalActions(event.target.value)}
          rows={4}
          placeholder={"Uma missão por linha, no formato:\nFiscal – Entregar a obrigação pendente\nSucesso do Cliente – Confirmar o recebimento dos documentos"}
        />
        <p className="text-xs text-muted-foreground">
          As quatro missões de desligamento são apenas sugestões. Inclua aqui
          qualquer providência extra; você confere os destinos na prévia.
        </p>
      </div>
      <div className="grid gap-1.5"><Label htmlFor="accountant-change-observations">Motivo e observações</Label><Textarea id="accountant-change-observations" value={observations} onChange={(event) => setObservations(event.target.value)} rows={5} placeholder="Aviso prévio, cobrança, transferência de dados e demais observações" /></div>
      <div className="flex items-center justify-between gap-2"><Button variant="ghost" size="sm" onClick={onDone} disabled={pending}><ArrowLeft className="size-4" aria-hidden /> Voltar</Button><Button onClick={analyze} disabled={pending || !selected || !responsibilityUntil}><ScanText className="size-4" aria-hidden /> Gerar prévia</Button></div>
    </div>
  );
}
