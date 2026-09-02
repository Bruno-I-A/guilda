"use client";

import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface MissionDescriptionDraft {
  id: string;
  description: string;
}

export interface ClanMissionGroupDraft {
  id: string;
  clanId: string;
  missions: MissionDescriptionDraft[];
}

export function emptyClanMissionGroup(id = "clan-group-1"): ClanMissionGroupDraft {
  return {
    id,
    clanId: "",
    missions: [{ id: `${id}-mission-1`, description: "" }],
  };
}

function nextFieldId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function flattenClanMissionGroups(
  groups: readonly ClanMissionGroupDraft[],
): { clanId: string; description: string }[] {
  return groups.flatMap((group) =>
    group.missions.map((mission) => ({
      clanId: group.clanId,
      description: mission.description,
    })),
  );
}

export function clanMissionGroupsAreValid(
  groups: readonly ClanMissionGroupDraft[],
): boolean {
  return (
    groups.length > 0 &&
    groups.every(
      (group) =>
        Boolean(group.clanId) &&
        group.missions.length > 0 &&
        group.missions.every(
          (mission) => mission.description.trim().length >= 3,
        ),
    )
  );
}

export function ClanMissionEditor({
  clans,
  groups,
  onChange,
  disabled = false,
}: {
  clans: readonly { id: string; name: string }[];
  groups: readonly ClanMissionGroupDraft[];
  onChange: (groups: ClanMissionGroupDraft[]) => void;
  disabled?: boolean;
}) {
  function updateGroup(id: string, patch: Partial<ClanMissionGroupDraft>) {
    onChange(
      groups.map((group) => (group.id === id ? { ...group, ...patch } : group)),
    );
  }

  function updateDescription(
    group: ClanMissionGroupDraft,
    missionId: string,
    description: string,
  ) {
    updateGroup(group.id, {
      missions: group.missions.map((mission) =>
        mission.id === missionId ? { ...mission, description } : mission,
      ),
    });
  }

  const missionCount = flattenClanMissionGroups(groups).length;

  return (
    <section className="grid gap-3" aria-label="Missões por clã">
      <div>
        <h2>Missões</h2>
        <p className="max-w-prose text-sm text-muted-foreground">
          Escolha um clã e descreva todas as missões dele. Depois, adicione quantos clãs precisar.
        </p>
      </div>

      {groups.length === 0 ? (
        <p className="border border-dashed p-4 text-center text-sm text-muted-foreground">
          Nenhum clã adicionado.
        </p>
      ) : (
        <div className="grid gap-3">
          {groups.map((group, groupIndex) => {
            const clanInputId = `mission-clan-${group.id}`;
            return (
              <div key={group.id} className="panel-cut grid gap-3 border bg-card/40 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="grid min-w-0 flex-1 gap-2 sm:max-w-xs">
                    <Label htmlFor={clanInputId}>Clã responsável</Label>
                    <Select
                      value={group.clanId}
                      onValueChange={(clanId) => updateGroup(group.id, { clanId })}
                      disabled={disabled}
                    >
                      <SelectTrigger id={clanInputId} className="w-full">
                        <SelectValue placeholder="Selecione o clã" />
                      </SelectTrigger>
                      <SelectContent>
                        {clans.map((clan) => (
                          <SelectItem key={clan.id} value={clan.id}>
                            {clan.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="touch-target text-destructive"
                    disabled={disabled}
                    aria-label={`Remover clã ${groupIndex + 1}`}
                    onClick={() =>
                      onChange(groups.filter((item) => item.id !== group.id))
                    }
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>

                <div className="grid gap-3 border-t pt-3">
                  {group.missions.map((mission, missionIndex) => {
                    const descriptionInputId = `mission-description-${mission.id}`;
                    return (
                      <div key={mission.id} className="grid gap-2">
                        <div className="flex items-center justify-between gap-2">
                          <Label htmlFor={descriptionInputId}>
                            Missão {missionIndex + 1}
                          </Label>
                          {group.missions.length > 1 ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="touch-target text-destructive"
                              disabled={disabled}
                              aria-label={`Remover missão ${missionIndex + 1}`}
                              onClick={() =>
                                updateGroup(group.id, {
                                  missions: group.missions.filter(
                                    (item) => item.id !== mission.id,
                                  ),
                                })
                              }
                            >
                              <Trash2 aria-hidden />
                            </Button>
                          ) : null}
                        </div>
                        <Textarea
                          id={descriptionInputId}
                          value={mission.description}
                          onChange={(event) =>
                            updateDescription(group, mission.id, event.target.value)
                          }
                          disabled={disabled}
                          rows={3}
                          maxLength={5_000}
                          placeholder="Ex.: Parametrizar a empresa no Simples Nacional"
                        />
                      </div>
                    );
                  })}
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  disabled={disabled || missionCount >= 60}
                  onClick={() =>
                    updateGroup(group.id, {
                      missions: [
                        ...group.missions,
                        {
                          id: nextFieldId(`${group.id}-mission`),
                          description: "",
                        },
                      ],
                    })
                  }
                >
                  <Plus aria-hidden /> Adicionar missão neste clã
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        className="w-fit"
        disabled={disabled || missionCount >= 60}
        onClick={() =>
          onChange([
            ...groups,
            emptyClanMissionGroup(nextFieldId("clan-group")),
          ])
        }
      >
        <Plus aria-hidden /> Adicionar outro clã
      </Button>
    </section>
  );
}
