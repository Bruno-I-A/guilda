"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCnpj } from "@/domain/cnpj";
import { TAX_REGIME_LABELS, type TaxRegime } from "@/lib/clients-ui";

export interface InformativeClientOption {
  id: string;
  name: string;
  cnpj: string | null;
  taxRegime: TaxRegime;
}

export function ClientPicker({
  clients,
  selectedId,
  onSelect,
  optional = false,
  onUnresolvedChange,
}: {
  clients: readonly InformativeClientOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  optional?: boolean;
  onUnresolvedChange?: (unresolved: boolean) => void;
}) {
  const [search, setSearch] = useState(() => clients.find((client) => client.id === selectedId)?.name ?? "");
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("pt-BR");
    const digits = query.replace(/\D/g, "");
    return clients.filter((client) =>
      !query || client.name.toLocaleLowerCase("pt-BR").includes(query) ||
      (digits.length > 0 && (client.cnpj ?? "").includes(digits)),
    ).slice(0, 12);
  }, [clients, search]);

  return (
    <div className="grid gap-1.5">
      <Label htmlFor="informative-company">Empresa{optional ? " (opcional)" : ""}</Label>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          id="informative-company"
          className="pl-9"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            onSelect("");
            onUnresolvedChange?.(Boolean(event.target.value.trim()));
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={optional ? "Busque uma empresa ou deixe em branco" : "Pesquise pelo nome ou CNPJ"}
          aria-expanded={open}
        />
        {open ? (
          <div className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
            {matches.length > 0 ? matches.map((client) => (
              <button
                key={client.id}
                type="button"
                className="flex w-full flex-col rounded-sm px-2 py-2 text-left text-sm hover:bg-accent"
                onClick={() => {
                  onSelect(client.id);
                  onUnresolvedChange?.(false);
                  setSearch(client.name);
                  setOpen(false);
                }}
              >
                <span>{client.name}</span>
                <span className="text-xs text-muted-foreground">
                  {client.cnpj ? formatCnpj(client.cnpj) : "CNPJ não informado"} · {TAX_REGIME_LABELS[client.taxRegime]}
                </span>
              </button>
            )) : (
              <p className="px-2 py-2 text-sm text-muted-foreground">Nenhuma empresa encontrada.</p>
            )}
          </div>
        ) : null}
      </div>
      {optional && !selectedId && search.trim() ? (
        <p className="text-xs text-warning">Selecione uma empresa da lista ou limpe a busca para publicar sem vínculo.</p>
      ) : null}
    </div>
  );
}
