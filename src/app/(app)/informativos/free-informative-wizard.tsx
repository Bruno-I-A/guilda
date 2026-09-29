"use client";

import { ArrowLeft, ListChecks, X } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { prepareStructuredInformative } from "./actions";
import { ClientPicker, type InformativeClientOption } from "./client-picker";
import {
  ClanMissionEditor,
  clanMissionGroupsAreValid,
  flattenClanMissionGroups,
  type ClanMissionEditorClan,
  type ClanMissionGroupDraft,
} from "./clan-mission-editor";

export function FreeInformativeWizard({
  clans,
  clients,
  onDone,
}: {
  clans: readonly ClanMissionEditorClan[];
  clients: readonly InformativeClientOption[];
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [clientId, setClientId] = useState("");
  const [unresolvedClient, setUnresolvedClient] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [missionGroups, setMissionGroups] = useState<ClanMissionGroupDraft[]>([]);
  const selectedClient = clients.find((client) => client.id === clientId);
  const valid = title.trim().length >= 3 && body.trim().length >= 3 &&
    title.trim().length <= 160 && body.trim().length <= 5_000 &&
    !unresolvedClient &&
    (missionGroups.length === 0 || clanMissionGroupsAreValid(missionGroups));

  function prepare() {
    if (!valid) return;
    startTransition(async () => {
      const result = await prepareStructuredInformative({
        missions: flattenClanMissionGroups(missionGroups),
        freeNotice: { clientId: clientId || null, title, body },
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Prévia gerada. Revise o aviso antes de publicar.");
      onDone();
    });
  }

  return (
    <div className="panel-cut grid gap-4 rounded-lg border bg-card/50 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2>Informativo livre</h2>
          <p className="text-sm text-muted-foreground">
            Escreva um aviso para o Mural. Vincule uma empresa e adicione missões somente se necessário.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onDone} disabled={pending}>
          <X className="size-4" aria-hidden /> Fechar
        </Button>
      </div>

      <ClientPicker
        clients={clients}
        selectedId={clientId}
        onSelect={setClientId}
        onUnresolvedChange={setUnresolvedClient}
        optional
      />
      <div className="grid gap-1.5">
        <Label htmlFor="free-informative-title">Assunto *</Label>
        <Input
          id="free-informative-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={160}
          placeholder="Ex.: Inatividade do cliente"
        />
        {selectedClient ? (
          <p className="text-xs text-muted-foreground">
            O título no Mural começará com “{selectedClient.name} — {title.trim() || "Assunto"}”.
          </p>
        ) : null}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="free-informative-body">Texto do informativo *</Label>
        <Textarea
          id="free-informative-body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          maxLength={5_000}
          rows={7}
          placeholder="Explique a situação, a data e as providências necessárias."
        />
      </div>

      <ClanMissionEditor
        clans={clans}
        groups={missionGroups}
        onChange={setMissionGroups}
        disabled={pending}
        description="Opcional: se alguém precisar executar uma tarefa, adicione a missão ao clã correspondente."
      />
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onDone} disabled={pending}>
          <ArrowLeft className="size-4" aria-hidden /> Voltar
        </Button>
        <Button onClick={prepare} disabled={pending || !valid}>
          <ListChecks className="size-4" aria-hidden /> Gerar prévia
        </Button>
      </div>
    </div>
  );
}
