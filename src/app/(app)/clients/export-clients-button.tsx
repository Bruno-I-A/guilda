"use client";

import { FileSpreadsheet } from "lucide-react";
import { useState } from "react";

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
import { TAX_REGIME_LABELS, TAX_REGIMES, type TaxRegime } from "@/lib/clients-ui";

export type RegimeCounts = Record<TaxRegime, { active: number; total: number }>;

/**
 * Baixa a planilha .xlsx das empresas para cadastrar em outro sistema. Na
 * janela se escolhe quais regimes vão e se as inativas entram — por padrão só
 * as ativas, porque empresa baixada atrapalha a importação do outro lado.
 */
export function ExportClientsButton({
  counts,
  initialRegime,
}: {
  counts: RegimeCounts;
  /** Regime filtrado na tela, para a janela já abrir marcando só ele. */
  initialRegime: TaxRegime | null;
}) {
  const initial = () => new Set<TaxRegime>(initialRegime ? [initialRegime] : TAX_REGIMES);
  const [selected, setSelected] = useState<Set<TaxRegime>>(initial);
  const [includeInactive, setIncludeInactive] = useState(false);

  const countOf = (regime: TaxRegime) =>
    includeInactive ? counts[regime].total : counts[regime].active;
  const total = [...selected].reduce((sum, regime) => sum + countOf(regime), 0);
  const allSelected = selected.size === TAX_REGIMES.length;

  function toggle(regime: TaxRegime, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(regime);
      else next.delete(regime);
      return next;
    });
  }

  const params = new URLSearchParams();
  for (const regime of TAX_REGIMES) if (selected.has(regime)) params.append("regime", regime);
  if (includeInactive) params.set("inativas", "1");
  const href = `/api/clients/export?${params}`;

  return (
    <Dialog
      onOpenChange={(open) => {
        if (open) {
          setSelected(initial());
          setIncludeInactive(false);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <FileSpreadsheet aria-hidden /> Exportar Excel
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Exportar empresas</DialogTitle>
          <DialogDescription>
            Escolha os regimes. A planilha traz uma linha por empresa, com
            CNPJ, endereço, contatos, CNAEs e sócios.
          </DialogDescription>
        </DialogHeader>

        <fieldset className="grid gap-1">
          <legend className="mb-1 flex w-full items-center justify-between gap-2">
            <span className="hud-label">Regimes</span>
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              onClick={() => setSelected(allSelected ? new Set() : new Set(TAX_REGIMES))}
            >
              {allSelected ? "Desmarcar todos" : "Marcar todos"}
            </button>
          </legend>
          {TAX_REGIMES.map((regime) => (
            <label
              key={regime}
              className="flex min-h-10 cursor-pointer items-center gap-3 border-b border-border/40 text-sm last:border-b-0"
            >
              <input
                type="checkbox"
                checked={selected.has(regime)}
                onChange={(event) => toggle(regime, event.target.checked)}
                className="size-4 shrink-0 accent-primary"
              />
              <span className="flex-1">{TAX_REGIME_LABELS[regime]}</span>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {countOf(regime)}
              </span>
            </label>
          ))}
        </fieldset>

        <label className="flex cursor-pointer items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(event) => setIncludeInactive(event.target.checked)}
            className="size-4 shrink-0 accent-primary"
          />
          Incluir as empresas inativas
        </label>

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <p className="font-mono text-xs tabular-nums text-muted-foreground">
            {total} {total === 1 ? "empresa" : "empresas"}
          </p>
          {total > 0 ? (
            <Button asChild>
              <a href={href} download>
                <FileSpreadsheet aria-hidden /> Baixar planilha
              </a>
            </Button>
          ) : (
            <Button disabled>
              <FileSpreadsheet aria-hidden /> Baixar planilha
            </Button>
          )}
        </DialogFooter>
        {selected.size === 0 ? (
          <p className="-mt-2 text-xs text-warning">Marque pelo menos um regime.</p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
