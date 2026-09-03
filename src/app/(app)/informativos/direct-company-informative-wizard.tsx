"use client";

import { ArrowLeft, ListChecks, Search, X } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatCnpj } from "@/domain/cnpj";
import { TAX_REGIME_LABELS, type TaxRegime } from "@/lib/clients-ui";
import { DIRECT_CLOSURE_MISSION_PRESETS } from "@/lib/informatives/mission-presets";

import { prepareStructuredInformative } from "./actions";
import {
  ClanMissionEditor,
  clanMissionGroupsAreValid,
  clanMissionGroupsFromPresets,
  flattenClanMissionGroups,
  type ClanMissionEditorClan,
  type ClanMissionGroupDraft,
} from "./clan-mission-editor";

type DirectInformativeKind = "amendment" | "closure";

type ClientOption = {
  id: string;
  name: string;
  cnpj: string | null;
  taxRegime: TaxRegime;
};

export function DirectCompanyInformativeWizard({
  kind,
  clans,
  clients,
  onDone,
}: {
  kind: DirectInformativeKind;
  clans: readonly ClanMissionEditorClan[];
  clients: readonly ClientOption[];
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [details, setDetails] = useState("");
  const [missionGroups, setMissionGroups] = useState<ClanMissionGroupDraft[]>(
    () => kind === "closure"
      ? clanMissionGroupsFromPresets(
          clans,
          DIRECT_CLOSURE_MISSION_PRESETS,
          "baixa-direta",
        )
      : [],
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
  const missionsValid =
    (amendment && missionGroups.length === 0) ||
    clanMissionGroupsAreValid(missionGroups);

  function analyze() {
    if (!selected || (amendment && !details.trim()) || !missionsValid) return;
    startTransition(async () => {
      const result = await prepareStructuredInformative({
        missions: flattenClanMissionGroups(missionGroups),
        directCompany: {
          type: "company",
          clientId: selected.id,
          kind,
          details,
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

      <ClanMissionEditor
        clans={clans}
        groups={missionGroups}
        onChange={setMissionGroups}
        disabled={pending}
        description={
          amendment
            ? "Opcional: adicione somente os clãs que terão alguma providência após a alteração."
            : "As missões padrão já estão separadas por clã e podem ser editadas, removidas ou complementadas."
        }
      />

      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onDone} disabled={pending}>
          <ArrowLeft className="size-4" aria-hidden /> Voltar
        </Button>
        <Button
          onClick={analyze}
          disabled={
            pending ||
            !selected ||
            (amendment && !details.trim()) ||
            !missionsValid
          }
        >
          <ListChecks className="size-4" aria-hidden /> Gerar prévia
        </Button>
      </div>
    </div>
  );
}
