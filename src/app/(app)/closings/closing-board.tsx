"use client";

import { Check, Circle, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CLOSING_CADENCES,
  CLOSING_CADENCE_LABELS,
  CLOSING_PERIOD_LABELS,
  periodsForCadence,
  type ClosingCadence,
  type ClosingPeriod,
} from "@/lib/closings-ui";
import {
  TAX_REGIME_BADGE_CLASSES,
  TAX_REGIME_LABELS,
  type TaxRegime,
} from "@/lib/clients-ui";
import { cn } from "@/lib/utils";

import { setClientClosingCadence, setClosingCompletion } from "./actions";

export interface ClosingClientView {
  id: string;
  name: string;
  taxRegime: TaxRegime;
  closingCadence: ClosingCadence;
  completions: Partial<
    Record<
      ClosingPeriod,
      {
        completedAt: string;
        completedBy: string;
      }
    >
  >;
}

function completionTitle(
  completion: ClosingClientView["completions"][ClosingPeriod],
): string {
  if (!completion) return "Pendente — clique para concluir";
  const date = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(completion.completedAt));
  return `Concluído por ${completion.completedBy} em ${date}. Clique para reabrir.`;
}

function PeriodButton({
  period,
  completion,
  pending,
  onToggle,
  className,
}: {
  period: ClosingPeriod;
  completion: ClosingClientView["completions"][ClosingPeriod];
  pending: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const complete = Boolean(completion);

  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      aria-pressed={complete}
      aria-label={`${CLOSING_PERIOD_LABELS[period]}: ${complete ? "concluído" : "pendente"}`}
      title={completionTitle(completion)}
      onClick={onToggle}
      className={cn(
        "h-9 min-w-0 justify-start gap-2 px-2.5 md:size-9 md:justify-center md:px-0",
        complete
          ? "border-primary/50 bg-primary/15 text-primary hover:bg-primary/20"
          : "text-muted-foreground",
        period === "annual" &&
          "w-full md:h-9 md:w-auto md:justify-start md:px-3",
        className,
      )}
    >
      {pending ? (
        <LoaderCircle className="animate-spin" aria-hidden />
      ) : complete ? (
        <Check aria-hidden />
      ) : (
        <Circle aria-hidden />
      )}
      <span className="md:hidden">{CLOSING_PERIOD_LABELS[period]}</span>
      {period === "annual" ? (
        <span className="hidden md:inline">Fechamento anual</span>
      ) : null}
    </Button>
  );
}

function ClosingRow({ client, year }: { client: ClosingClientView; year: number }) {
  const router = useRouter();
  const [pendingKey, setPendingKey] = useState<ClosingPeriod | "cadence" | null>(
    null,
  );
  const [, startTransition] = useTransition();
  const periods = periodsForCadence(client.closingCadence);

  function toggle(period: ClosingPeriod) {
    const completion = client.completions[period];
    setPendingKey(period);
    startTransition(async () => {
      const result = await setClosingCompletion({
        clientId: client.id,
        year,
        period,
        completed: !completion,
      });
      if (!result.ok) {
        toast.error(result.error);
      }
      setPendingKey(null);
      router.refresh();
    });
  }

  function changeCadence(cadence: ClosingCadence) {
    if (cadence === client.closingCadence) return;
    setPendingKey("cadence");
    startTransition(async () => {
      const result = await setClientClosingCadence({
        clientId: client.id,
        cadence,
      });
      if (!result.ok) {
        toast.error(result.error);
      } else {
        toast.success(
          `${client.name}: fechamento ${CLOSING_CADENCE_LABELS[cadence].toLowerCase()}.`,
        );
      }
      setPendingKey(null);
      router.refresh();
    });
  }

  return (
    <li className="panel-cut panel-cut-sm grid gap-3 p-3 md:grid-cols-[minmax(13rem,1fr)_8.75rem_repeat(4,2.25rem)] md:items-center md:gap-2 md:px-4">
      <div className="min-w-0">
        <p className="truncate font-medium leading-snug">{client.name}</p>
        <Badge
          className={cn(
            "mt-1 h-4 px-1.5 md:hidden",
            TAX_REGIME_BADGE_CLASSES[client.taxRegime],
          )}
        >
          {TAX_REGIME_LABELS[client.taxRegime]}
        </Badge>
      </div>

      <Select
        value={client.closingCadence}
        disabled={pendingKey !== null}
        onValueChange={(value) => changeCadence(value as ClosingCadence)}
      >
        <SelectTrigger
          size="sm"
          className="w-full md:w-[8.75rem]"
          aria-label={`Periodicidade de ${client.name}`}
        >
          <SelectValue>
            {CLOSING_CADENCE_LABELS[client.closingCadence]}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {CLOSING_CADENCES.map((cadence) => (
            <SelectItem key={cadence} value={cadence}>
              {CLOSING_CADENCE_LABELS[cadence]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {client.closingCadence === "quarterly" ? (
        <div className="grid grid-cols-2 gap-2 md:contents">
          {periods.map((period) => (
            <PeriodButton
              key={period}
              period={period}
              completion={client.completions[period]}
              pending={pendingKey !== null}
              onToggle={() => toggle(period)}
            />
          ))}
        </div>
      ) : (
        <div className="md:col-span-4">
          <PeriodButton
            period="annual"
            completion={client.completions.annual}
            pending={pendingKey !== null}
            onToggle={() => toggle("annual")}
          />
        </div>
      )}
    </li>
  );
}

export function ClosingBoard({
  clients,
  year,
}: {
  clients: ClosingClientView[];
  year: number;
}) {
  return (
    <div className="grid gap-2">
      <div className="hidden grid-cols-[minmax(13rem,1fr)_8.75rem_repeat(4,2.25rem)] items-end gap-2 px-4 md:grid">
        <span className="hud-label">Empresa</span>
        <span className="hud-label">Periodicidade</span>
        {(["q1", "q2", "q3", "q4"] as const).map((period) => (
          <span key={period} className="text-center font-mono text-[10px] text-muted-foreground">
            {CLOSING_PERIOD_LABELS[period]}
          </span>
        ))}
      </div>
      <ul className="grid gap-1.5">
        {clients.map((client) => (
          <ClosingRow key={client.id} client={client} year={year} />
        ))}
      </ul>
    </div>
  );
}
