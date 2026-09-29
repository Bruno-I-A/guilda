"use client";

import { CalendarRange, ExternalLink, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { createClosingFromTask } from "@/app/(app)/clans/[id]/closing-actions";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ClosingFigures } from "@/domain/closing-from-task";

/**
 * Gerar o fechamento a partir da missão.
 *
 * O balanço era anotado duas vezes: a pessoa escrevia caixa e resultado no
 * retorno da missão, e depois alguém repetia os mesmos números no período da
 * aba Fechamentos. Aqui o período nasce da própria missão, já com os números
 * que vieram no retorno — quando dá para lê-los com segurança.
 *
 * O período nasce FECHADO quando o trabalho já foi feito — missão concluída ou
 * entregue aguardando aprovação —, que é como a equipe registra manualmente.
 * Trabalho ainda não entregue gera período pendente, e aí quem o fecha é a
 * aprovação, por `syncClosingFromTask`.
 */
export function ClosingFromTaskCard({
  taskId,
  clientName,
  suggestedTitle,
  suggestedDueDate,
  figures,
  linkedClosing,
}: {
  taskId: string;
  clientName: string;
  suggestedTitle: string;
  suggestedDueDate: string;
  figures: ClosingFigures;
  /** Preenchido quando a missão já tem período vinculado. */
  linkedClosing: { clanId: string; year: number } | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [aberto, setAberto] = useState(false);
  const [title, setTitle] = useState(suggestedTitle);
  const [dueDate, setDueDate] = useState(suggestedDueDate);
  const [cashBalance, setCashBalance] = useState(figures.cashBalance ?? "");
  const [periodResult, setPeriodResult] = useState(figures.periodResult ?? "");
  const [shareholderLoan, setShareholderLoan] = useState(figures.shareholderLoan ?? "");

  const leuNumeros = Boolean(
    figures.cashBalance || figures.periodResult || figures.shareholderLoan,
  );

  if (linkedClosing) {
    return (
      <div className="panel-cut flex flex-wrap items-center gap-x-3 gap-y-1 border border-success/30 bg-success/5 px-4 py-3 text-sm">
        <CalendarRange className="size-4 shrink-0 text-success" aria-hidden />
        <span>
          Vinculada ao fechamento de <strong>{clientName}</strong>.
        </span>
        <Link
          href={`/clans/${linkedClosing.clanId}?tab=closings&year=${linkedClosing.year}&q=${encodeURIComponent(clientName)}`}
          className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
        >
          Ver nos Fechamentos <ExternalLink className="size-3.5" aria-hidden />
        </Link>
      </div>
    );
  }

  function gerar() {
    startTransition(async () => {
      const result = await createClosingFromTask({
        taskId,
        title,
        dueDate,
        cashBalance,
        periodResult,
        shareholderLoan,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.data?.alreadyLinked
          ? "Esta missão já tinha um fechamento."
          : "Fechamento criado e vinculado à missão.",
      );
      setAberto(false);
      router.refresh();
    });
  }

  if (!aberto) {
    return (
      <div className="panel-cut flex flex-wrap items-center justify-between gap-3 border border-border/70 bg-card/40 px-4 py-3">
        <p className="min-w-0 text-sm text-muted-foreground">
          Esta missão é de <strong className="text-foreground">{clientName}</strong>.
          Gere o período nos Fechamentos para não anotar o mesmo trabalho duas vezes.
        </p>
        <Button type="button" variant="outline" onClick={() => setAberto(true)}>
          <CalendarRange aria-hidden /> Gerar fechamento
        </Button>
      </div>
    );
  }

  return (
    <div className="panel-cut grid gap-3 border border-primary/30 bg-card/40 p-4">
      <div>
        <h3>Gerar fechamento de {clientName}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {leuNumeros
            ? "Os valores vieram do retorno da missão — confira antes de gerar."
            : "Não consegui ler valores no retorno; preencha o que fizer sentido."}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="cft-title">Título do período</Label>
          <Input
            id="cft-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={160}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="cft-due">Vencimento</Label>
          <Input
            id="cft-due"
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label htmlFor="cft-cash">Saldo de caixa</Label>
          {/* Caixa e resultado aceitam negativo: caixa descoberto existe e
              prejuízo é resultado negativo. Só o empréstimo de sócio não
              aceita, igual ao formulário manual. */}
          <CurrencyInput
            id="cft-cash"
            name="cashBalance"
            value={cashBalance}
            onValueChange={setCashBalance}
            allowNegative
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="cft-result">Resultado</Label>
          <CurrencyInput
            id="cft-result"
            name="periodResult"
            value={periodResult}
            onValueChange={setPeriodResult}
            allowNegative
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="cft-loan">Empréstimo de sócio</Label>
          <CurrencyInput
            id="cft-loan"
            name="shareholderLoan"
            value={shareholderLoan}
            onValueChange={setShareholderLoan}
          />
        </div>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => setAberto(false)}>
          Cancelar
        </Button>
        <Button
          type="button"
          disabled={pending || title.trim().length < 3 || !dueDate}
          onClick={gerar}
        >
          {pending ? (
            <LoaderCircle className="animate-spin" aria-hidden />
          ) : (
            <CalendarRange aria-hidden />
          )}
          Gerar fechamento
        </Button>
      </div>
    </div>
  );
}
