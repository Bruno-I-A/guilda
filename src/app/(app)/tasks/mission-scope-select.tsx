"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { MissionScope } from "@/domain/mission-triage";

/**
 * O único filtro que sobrou na lista de missões: DE QUEM é o trabalho.
 *
 * Origem virou a navegação da página (Avulsas / Informativos); status e
 * prazo viraram estrutura (seções por papel, atrasadas no topo). O que não
 * dá para virar estrutura é o ponto de vista — a pessoa, os clãs dela, um
 * clã, alguém, a Guilda inteira — e isso continua sendo uma escolha.
 */
export function MissionScopeSelect({
  scope,
  clans,
  members,
  clanId,
  personId,
}: {
  scope: MissionScope;
  clans: { id: string; name: string }[];
  members: { userId: string; name: string }[];
  clanId?: string;
  personId?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function replace(mutator: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams);
    mutator(params);
    // Filtros da lista antiga: não fazem mais nada, não ficam na URL.
    params.delete("status");
    params.delete("due");
    params.delete("origin");
    const query = params.toString();
    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname);
    });
  }

  function setScope(nextScope: MissionScope) {
    replace((params) => {
      params.set("scope", nextScope);
      if (nextScope !== "clan") params.delete("clan");
      else if (!clanId && clans[0]) params.set("clan", clans[0].id);
      if (nextScope !== "person") params.delete("person");
      else if (!personId && members[0]) params.set("person", members[0].userId);
    });
  }

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      aria-busy={pending || undefined}
    >
      <span className="hud-label">Mostrar</span>
      <Select value={scope} onValueChange={(value) => setScope(value as MissionScope)}>
        <SelectTrigger size="sm" aria-label="Escolher de quem são as missões" className="min-w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="mine">Minhas missões</SelectItem>
          <SelectItem value="my_clans">Meus clãs</SelectItem>
          <SelectItem value="clan" disabled={clans.length === 0}>
            Um clã…
          </SelectItem>
          <SelectItem value="person" disabled={members.length === 0}>
            Uma pessoa…
          </SelectItem>
          <SelectItem value="all">Toda a Guilda</SelectItem>
        </SelectContent>
      </Select>

      {scope === "clan" ? (
        <Select
          value={clanId}
          onValueChange={(value) =>
            replace((params) => {
              params.set("scope", "clan");
              params.set("clan", value);
            })
          }
        >
          <SelectTrigger size="sm" aria-label="Escolher clã" className="min-w-40">
            <SelectValue placeholder="Escolha o clã" />
          </SelectTrigger>
          <SelectContent>
            {clans.map((clan) => (
              <SelectItem key={clan.id} value={clan.id}>
                {clan.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      {scope === "person" ? (
        <Select
          value={personId}
          onValueChange={(value) =>
            replace((params) => {
              params.set("scope", "person");
              params.set("person", value);
            })
          }
        >
          <SelectTrigger size="sm" aria-label="Escolher pessoa" className="min-w-44">
            <SelectValue placeholder="Escolha a pessoa" />
          </SelectTrigger>
          <SelectContent>
            {members.map((member) => (
              <SelectItem key={member.userId} value={member.userId}>
                {member.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </div>
  );
}
