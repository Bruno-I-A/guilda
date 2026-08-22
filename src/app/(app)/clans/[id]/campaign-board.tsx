"use client";

import { CalendarRange, Check, ClipboardCheck, Plus, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import { createClanCampaign, setClanCampaignStatus } from "./campaign-actions";

export type CampaignStatus = "planned" | "active" | "completed" | "cancelled";

export interface CampaignView {
  id: string;
  name: string;
  periodYear: number;
  periodMonth: number;
  dueDate: string | null;
  status: CampaignStatus;
}

const MONTHS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
] as const;

const STATUS_META: Record<
  CampaignStatus,
  { label: string; variant: "default" | "secondary" | "outline" }
> = {
  planned: { label: "Planejada", variant: "outline" },
  active: { label: "Em andamento", variant: "default" },
  completed: { label: "Concluída", variant: "secondary" },
  cancelled: { label: "Cancelada", variant: "outline" },
};

function periodLabel(year: number, month: number): string {
  return `${MONTHS[month - 1] ?? "?"} de ${year}`;
}

/** Prazo é `date` puro: formatar sem passar por fuso evita errar um dia. */
function formatDueDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

export function NewCampaignButton({
  clanId,
  isFiscal,
}: {
  clanId: string;
  isFiscal: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const now = new Date();
  const [name, setName] = useState("");
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [dueDate, setDueDate] = useState("");
  const [openFiscalControl, setOpenFiscalControl] = useState(isFiscal);

  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];

  function submit() {
    startTransition(async () => {
      const result = await createClanCampaign({
        clanId,
        name,
        periodYear: Number(year),
        periodMonth: Number(month),
        dueDate: dueDate || undefined,
        openFiscalControl,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const fiscalSummary = result.data;
      toast.success(
        fiscalSummary?.fiscalControlCreated
          ? `Campanha e controle abertos para ${fiscalSummary.fiscalControlCreated} empresa(s).`
          : "Campanha aberta.",
      );
      if (fiscalSummary?.fiscalControlConflicts) {
        toast.warning(
          `${fiscalSummary.fiscalControlConflicts} controle(s) já pertenciam a outra campanha e foram preservados.`,
        );
      }
      setName("");
      setDueDate("");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm">
          <Plus aria-hidden /> Nova campanha
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova campanha do mês</DialogTitle>
          <DialogDescription>
            O guarda-chuva do trabalho recorrente — por exemplo, “Apuração
            mensal” ou “Fechamento do trimestre”.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="campaign-name">Nome</Label>
            <Input
              id="campaign-name"
              value={name}
              maxLength={200}
              placeholder="Apuração mensal"
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="campaign-month">Mês</Label>
              <Select value={month} onValueChange={setMonth}>
                <SelectTrigger id="campaign-month">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTHS.map((label, index) => (
                    <SelectItem key={label} value={String(index + 1)}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="campaign-year">Ano</Label>
              <Select value={year} onValueChange={setYear}>
                <SelectTrigger id="campaign-year">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {years.map((option) => (
                    <SelectItem key={option} value={String(option)}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {isFiscal ? (
            <label className="flex items-start gap-2 rounded-lg border bg-muted/25 p-3 text-xs">
              <input
                type="checkbox"
                className="mt-0.5 accent-primary"
                checked={openFiscalControl}
                onChange={(event) => setOpenFiscalControl(event.target.checked)}
              />
              <span>
                Abrir também o Controle Fiscal desta competência, congelando
                a ficha e o responsável atual de cada empresa.
              </span>
            </label>
          ) : null}

          <div className="grid gap-1.5">
            <Label htmlFor="campaign-due">Prazo (opcional)</Label>
            <Input
              id="campaign-due"
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            disabled={pending || name.trim().length < 3}
            onClick={submit}
          >
            Abrir campanha
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CampaignBoard({
  clanId,
  campaigns,
  canManage,
  isFiscal,
}: {
  clanId: string;
  campaigns: readonly CampaignView[];
  canManage: boolean;
  isFiscal: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function changeStatus(campaignId: string, status: CampaignStatus) {
    startTransition(async () => {
      const result = await setClanCampaignStatus({ clanId, campaignId, status });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Campanha atualizada.");
      router.refresh();
    });
  }

  return (
    <ul className="grid gap-2">
      {campaigns.map((campaign) => {
        const meta = STATUS_META[campaign.status];
        return (
          <li
            key={campaign.id}
            className={cn(
              "clan-operational-row flex min-h-16 flex-wrap items-center justify-between gap-3 px-4 py-3",
              campaign.status === "cancelled" && "opacity-60",
            )}
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{campaign.name}</p>
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <CalendarRange className="size-3.5" aria-hidden />
                  {periodLabel(campaign.periodYear, campaign.periodMonth)}
                </span>
                {campaign.dueDate ? (
                  <span>· prazo {formatDueDate(campaign.dueDate)}</span>
                ) : null}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Badge variant={meta.variant}>{meta.label}</Badge>
              {isFiscal ? (
                <Button asChild type="button" variant="outline" size="sm">
                  <Link
                    href={`/clans/${clanId}?tab=portfolio&fiscalView=control&fiscalYear=${campaign.periodYear}&fiscalMonth=${campaign.periodMonth}`}
                  >
                    <ClipboardCheck aria-hidden /> Controle
                  </Link>
                </Button>
              ) : null}
              {canManage ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={pending}
                    >
                      Situação
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {campaign.status !== "active" ? (
                      <DropdownMenuItem
                        onSelect={() => changeStatus(campaign.id, "active")}
                      >
                        <CalendarRange aria-hidden /> Marcar em andamento
                      </DropdownMenuItem>
                    ) : null}
                    {campaign.status !== "completed" ? (
                      <DropdownMenuItem
                        onSelect={() => changeStatus(campaign.id, "completed")}
                      >
                        <Check aria-hidden /> Concluir
                      </DropdownMenuItem>
                    ) : null}
                    {campaign.status !== "cancelled" ? (
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => changeStatus(campaign.id, "cancelled")}
                      >
                        <X aria-hidden /> Cancelar
                      </DropdownMenuItem>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
