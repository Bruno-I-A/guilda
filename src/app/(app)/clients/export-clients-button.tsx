"use client";

import { ChevronDown, FileSpreadsheet } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Baixa a planilha .xlsx das empresas para cadastrar em outro sistema. Segue
 * os filtros da tela (regime e busca); as inativas só vão quando pedidas,
 * porque empresa baixada atrapalha a importação do outro lado.
 */
export function ExportClientsButton({
  filterQuery,
  activeCount,
  totalCount,
}: {
  /** `regime` e `q` da tela, já montados como query string (ou vazio). */
  filterQuery: string;
  activeCount: number;
  totalCount: number;
}) {
  const href = (includeInactive: boolean) => {
    const params = new URLSearchParams(filterQuery);
    if (includeInactive) params.set("inativas", "1");
    const suffix = params.toString();
    return suffix ? `/api/clients/export?${suffix}` : "/api/clients/export";
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={totalCount === 0}>
          <FileSpreadsheet aria-hidden /> Exportar Excel
          <ChevronDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          {filterQuery ? "Empresas do filtro atual" : "Empresas cadastradas"}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild disabled={activeCount === 0}>
          <a href={href(false)} download>
            Só as ativas ({activeCount})
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={href(true)} download>
            Todas, com as inativas ({totalCount})
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
