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

export function TaskFilters({
  status,
  due,
}: {
  status: TaskStatus | "all";
  due: "all" | "overdue" | "week";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setParam(key: "status" | "due", value: string) {
    const params = new URLSearchParams(searchParams);
    if (value === "all") {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="flex items-center gap-2">
      <Select value={status} onValueChange={(v) => setParam("status", v)}>
        <SelectTrigger size="sm" aria-label="Filtrar por status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos os status</SelectItem>
          {TASK_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {STATUS_LABELS[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={due} onValueChange={(v) => setParam("due", v)}>
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
