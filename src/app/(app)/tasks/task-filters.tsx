"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TASK_STATUSES, type TaskStatus } from "@/domain/task-state";
import { STATUS_LABELS } from "@/lib/task-ui";

export type TaskScope =
  | "mine"
  | "my_clans"
  | "clan"
  | "person"
  | "created"
  | "all";

export function TaskFilters({
  scope,
  status,
  due,
  clans,
  members,
  clanId,
  personId,
}: {
  scope: TaskScope;
  status: TaskStatus | "all";
  due: "all" | "overdue" | "week";
  clans: { id: string; name: string }[];
  members: { userId: string; name: string }[];
  clanId?: string;
  personId?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function replace(mutator: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams);
    mutator(params);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  function setSimpleParam(key: "status" | "due", value: string) {
    replace((params) => {
      if (value === "all") params.delete(key);
      else params.set(key, value);
    });
  }

  function setScope(nextScope: TaskScope) {
    replace((params) => {
      if (nextScope === "mine") params.delete("scope");
      else params.set("scope", nextScope);
      if (nextScope !== "clan") params.delete("clan");
      else if (!clanId && clans[0]) params.set("clan", clans[0].id);
      if (nextScope !== "person") params.delete("person");
      else if (!personId && members[0]) params.set("person", members[0].userId);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/25 p-2">
      <Select value={scope} onValueChange={(value) => setScope(value as TaskScope)}>
        <SelectTrigger size="sm" aria-label="Filtrar por escopo" className="min-w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="mine">Minhas missões</SelectItem>
          <SelectItem value="my_clans">Meus clãs</SelectItem>
          <SelectItem value="clan" disabled={clans.length === 0}>
            Clã específico
          </SelectItem>
          <SelectItem value="person" disabled={members.length === 0}>
            Pessoa específica
          </SelectItem>
          <SelectItem value="created">Criadas por mim</SelectItem>
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

      <Select value={status} onValueChange={(value) => setSimpleParam("status", value)}>
        <SelectTrigger size="sm" aria-label="Filtrar por status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos os status</SelectItem>
          {TASK_STATUSES.map((taskStatus) => (
            <SelectItem key={taskStatus} value={taskStatus}>
              {STATUS_LABELS[taskStatus]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={due} onValueChange={(value) => setSimpleParam("due", value)}>
        <SelectTrigger size="sm" aria-label="Filtrar por prazo">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Qualquer prazo</SelectItem>
          <SelectItem value="overdue">Atrasadas</SelectItem>
          <SelectItem value="week">Próximos 7 dias</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
