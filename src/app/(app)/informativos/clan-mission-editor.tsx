"use client";

import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
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
import type { ClanMissionPreset } from "@/lib/informatives/mission-presets";
import { cn } from "@/lib/utils";

interface MissionDescriptionDraft {
  id: string;
  description: string;
}

export interface ClanMissionGroupDraft {
  id: string;
  clanId: string;
  missions: MissionDescriptionDraft[];
}

export interface ClanMissionEditorClan {
  id: string;
  name: string;
  slug?: string;
}

export function emptyClanMissionGroup(id = "clan-group-1"): ClanMissionGroupDraft {
  return {
    id,
    clanId: "",
    missions: [{ id: `${id}-mission-1`, description: "" }],
  };
}

export function clanMissionGroupsFromPresets(
  clans: readonly ClanMissionEditorClan[],
  presets: readonly ClanMissionPreset[],
  idPrefix = "preset",
): ClanMissionGroupDraft[] {
  return presets
    .filter((preset) => preset.descriptions.length > 0)
    .map((preset, groupIndex) => {
      const clan = clans.find((candidate) => candidate.slug === preset.clanSlug);
      const groupId = `${idPrefix}-${groupIndex + 1}`;
      return {
        id: groupId,
        clanId: clan?.id ?? "",
        missions: preset.descriptions.map((description, missionIndex) => ({
          id: `${groupId}-mission-${missionIndex + 1}`,
          description,
        })),
      };
    });
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
  description = "Escolha um clã e descreva todas as missões dele. Depois, adicione quantos clãs precisar.",
}: {
  clans: readonly ClanMissionEditorClan[];
  groups: readonly ClanMissionGroupDraft[];
  onChange: (groups: ClanMissionGroupDraft[]) => void;
  disabled?: boolean;
  description?: string;
}) {
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(
    () => new Set(groups.slice(0, 1).map((group) => group.id)),
  );

  function toggleGroup(id: string) {
    setExpandedGroupIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
  const allExpanded =
    groups.length > 0 && groups.every((group) => expandedGroupIds.has(group.id));

  return (
    <section className="grid gap-4" aria-label="Missões por clã">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h2>Missões</h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            {description}
          </p>
          <p className="font-mono text-xs text-muted-foreground" aria-live="polite">
            {groups.length} {groups.length === 1 ? "clã" : "clãs"} · {missionCount}{" "}
            {missionCount === 1 ? "missão" : "missões"}
          </p>
        </div>
        {groups.length > 1 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() =>
              setExpandedGroupIds(
                allExpanded ? new Set() : new Set(groups.map((group) => group.id)),
              )
            }
          >
            {allExpanded ? "Recolher todos" : "Expandir todos"}
          </Button>
        ) : null}
      </div>

      {groups.length === 0 ? (
        <p className="border border-dashed p-4 text-center text-sm text-muted-foreground">
          Nenhum clã adicionado.
        </p>
      ) : (
        <div className="grid gap-3">
          {groups.map((group, groupIndex) => {
            const clan = clans.find((candidate) => candidate.id === group.clanId);
            const groupName = clan?.name ?? "Clã não selecionado";
            const needsReview =
              !group.clanId ||
              group.missions.length === 0 ||
              group.missions.some((mission) => mission.description.trim().length < 3);
            const expanded = expandedGroupIds.has(group.id);
            const clanInputId = `mission-clan-${group.id}`;
            const groupPanelId = `mission-group-${group.id}`;
            const firstMissionTitle = group.missions[0]?.description
              .split(/\r?\n/, 1)[0]
              .trim() || "Missão sem descrição";
            return (
              <div
                key={group.id}
                data-clan={clan?.slug}
                className="clan-mission-group panel-cut overflow-hidden border border-border/70 bg-card/45"
              >
                <div className="clan-mission-heading flex items-stretch gap-1">
                  <button
                    type="button"
                    className="flex min-h-16 min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                    aria-expanded={expanded}
                    aria-controls={groupPanelId}
                    onClick={() => toggleGroup(group.id)}
                  >
                    <span className="clan-mission-index flex size-9 shrink-0 items-center justify-center rounded-sm font-mono text-xs tabular-nums">
                      {String(groupIndex + 1).padStart(2, "0")}
                    </span>
                    <span className="grid min-w-0 flex-1 gap-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className={cn("font-semibold", clan ? "clan-mission-accent" : "text-warning")}>
                          {groupName}
                        </span>
                        <Badge variant="outline" className="bg-background/40 font-mono tabular-nums">
                          {group.missions.length} {group.missions.length === 1 ? "missão" : "missões"}
                        </Badge>
                        {needsReview ? (
                          <Badge variant="outline" className="border-warning/40 bg-warning/10 text-warning">
                            Revisar
                          </Badge>
                        ) : null}
                      </span>
                      {!expanded ? (
                        <span className="truncate text-xs text-muted-foreground">
                          {firstMissionTitle}
                          {group.missions.length > 1
                            ? ` · +${group.missions.length - 1} outras`
                            : ""}
                        </span>
                      ) : null}
                    </span>
                    <ChevronDown
                      className={cn("size-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")}
                      aria-hidden
                    />
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="touch-target mr-2 self-center text-destructive"
                    disabled={disabled}
                    aria-label={`Remover clã ${groupName} e suas ${group.missions.length} missões`}
                    onClick={() =>
                      onChange(groups.filter((item) => item.id !== group.id))
                    }
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>

                <div id={groupPanelId} hidden={!expanded} className="border-t border-border/70 p-4">
                  <div className="grid gap-4">
                    <div className="grid gap-2 sm:max-w-xs">
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
                          {clans.map((option) => (
                            <SelectItem key={option.id} value={option.id}>
                              {option.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid gap-2">
                      {group.missions.map((mission, missionIndex) => {
                        const descriptionInputId = `mission-description-${mission.id}`;
                        return (
                          <div key={mission.id} className="grid gap-2 rounded-md border border-border/60 bg-background/35 p-3">
                            <div className="flex items-center justify-between gap-2">
                              <Label htmlFor={descriptionInputId} className="flex items-center gap-2">
                                <span className="clan-mission-accent font-mono tabular-nums">
                                  {String(missionIndex + 1).padStart(2, "0")}
                                </span>
                                Missão {missionIndex + 1}
                              </Label>
                              {group.missions.length > 1 ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  className="touch-target text-destructive"
                                  disabled={disabled}
                                  aria-label={`Remover missão ${missionIndex + 1} de ${groupName}`}
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
                </div>
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
        onClick={() => {
          const nextGroup = emptyClanMissionGroup(nextFieldId("clan-group"));
          setExpandedGroupIds((current) => new Set([...current, nextGroup.id]));
          onChange([...groups, nextGroup]);
        }}
      >
        <Plus aria-hidden /> Adicionar outro clã
      </Button>
    </section>
  );
}
