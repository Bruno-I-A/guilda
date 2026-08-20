"use client";

import {
  AlertTriangle,
  Building2,
  Crown,
  Search,
  Sparkles,
  UserRoundX,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TAX_REGIME_BADGE_CLASSES,
  TAX_REGIME_LABELS,
  type TaxRegime,
} from "@/lib/clients-ui";
import { cn } from "@/lib/utils";

import { assignPortfolioClients, confirmNewClientPortfolio } from "./portfolio-actions";
import {
  FiscalProfileDialog,
  type FiscalProfileView,
} from "./fiscal-profile-dialog";
import { FiscalImportDialog } from "./fiscal-import-dialog";

export interface PortfolioClientView {
  id: string;
  name: string;
  taxRegime: TaxRegime;
  active: boolean;
  profile: FiscalProfileView;
}

export interface PortfolioBucketView {
  userId: string;
  name: string;
  isLeader: boolean;
  clients: PortfolioClientView[];
}

/** Cliente novo (qualquer via de cadastro) ainda sem carteira. */
export interface AwaitingPortfolioView {
  client: PortfolioClientView;
  note: string | null;
  /** Só preenchido quando a pessoa sugerida ainda é do clã hoje. */
  suggestedOwnerId: string | null;
}

interface MemberOption {
  userId: string;
  name: string;
}

/** Devolve à fila de "sem responsável" — valor sentinela do Select. */
const UNASSIGN = "__unassign__";

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function ClientRow({
  clanId,
  client,
  selected,
  onToggle,
  selectable,
  canManage,
  contextNote,
}: {
  clanId: string;
  client: PortfolioClientView;
  selected: boolean;
  onToggle: (id: string) => void;
  selectable: boolean;
  canManage: boolean;
  contextNote?: string;
}) {
  return (
    <li
      className={cn(
        "grid gap-1 rounded-md bg-muted/25 px-2.5 py-1.5 text-sm transition-colors",
        selected && "bg-primary/15",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {selectable ? (
          <input
            type="checkbox"
            aria-label={`Selecionar ${client.name}`}
            className="size-3.5 shrink-0 accent-primary"
            checked={selected}
            onChange={() => onToggle(client.id)}
          />
        ) : null}
        <span className="min-w-0 flex-1 truncate">{client.name}</span>
        {!client.active ? (
          <Badge variant="outline" className="shrink-0 text-[10px]">inativa</Badge>
        ) : null}
        {client.profile.missingFields.length > 0 ? (
          <Badge variant="outline" className="shrink-0 border-amber-500/40 text-[10px] text-amber-300">
            ficha incompleta
          </Badge>
        ) : null}
        <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium", TAX_REGIME_BADGE_CLASSES[client.taxRegime])}>
          {TAX_REGIME_LABELS[client.taxRegime]}
        </span>
        <FiscalProfileDialog
          clanId={clanId}
          clientId={client.id}
          clientName={client.name}
          profile={client.profile}
          canManage={canManage}
        />
      </div>
      {client.profile.permanentNotes ? (
        <p className="line-clamp-2 pl-5 text-[11px] whitespace-pre-wrap text-muted-foreground">
          {client.profile.permanentNotes}
        </p>
      ) : null}
      {contextNote ? (
        <span className="pl-5 text-[11px] text-muted-foreground">{contextNote}</span>
      ) : null}
    </li>
  );
}

/**
 * Uma empresa nova por vez, com nota e sugestão próprias — por isso fora do
 * fluxo de seleção múltipla das demais seções. Confirmar aqui não só move a
 * carteira: também credita XP a quem assume (ver confirmNewClientPortfolio).
 */
function AwaitingRow({
  clanId,
  row,
  members,
  canManage,
}: {
  clanId: string;
  row: AwaitingPortfolioView;
  members: readonly MemberOption[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [userId, setUserId] = useState(row.suggestedOwnerId ?? "");

  function confirm() {
    if (!userId) return;
    startTransition(async () => {
      const result = await confirmNewClientPortfolio({
        clanId,
        clientId: row.client.id,
        userId,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${row.client.name} entrou na carteira.`);
      router.refresh();
    });
  }

  return (
    <li className="grid gap-2 rounded-md border border-primary/30 bg-card/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium">{row.client.name}</span>
        <span
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
            TAX_REGIME_BADGE_CLASSES[row.client.taxRegime],
          )}
        >
          {TAX_REGIME_LABELS[row.client.taxRegime]}
        </span>
        <FiscalProfileDialog
          clanId={clanId}
          clientId={row.client.id}
          clientName={row.client.name}
          profile={row.client.profile}
          canManage={canManage}
        />
      </div>
      {row.note ? (
        <p className="text-xs whitespace-pre-wrap text-muted-foreground">{row.note}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={userId} onValueChange={setUserId}>
          <SelectTrigger size="sm" className="min-w-44 flex-1" aria-label="Responsável">
            <SelectValue placeholder="Quem vai assumir…" />
          </SelectTrigger>
          <SelectContent>
            {members.map((member) => (
              <SelectItem key={member.userId} value={member.userId}>
                {member.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="button" size="sm" disabled={pending || !userId} onClick={confirm}>
          Confirmar
        </Button>
      </div>
    </li>
  );
}

export function PortfolioBoard({
  clanId,
  canManage,
  members,
  buckets,
  awaiting,
  orphans,
  stranded,
  totalClients,
  averagePerMember,
}: {
  clanId: string;
  canManage: boolean;
  members: readonly MemberOption[];
  buckets: readonly PortfolioBucketView[];
  awaiting: readonly AwaitingPortfolioView[];
  orphans: readonly PortfolioClientView[];
  stranded: readonly { client: PortfolioClientView; holderName: string }[];
  totalClients: number;
  averagePerMember: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [destination, setDestination] = useState(members[0]?.userId ?? "");

  const needle = normalize(query.trim());
  const matches = (client: PortfolioClientView) =>
    !needle || normalize(client.name).includes(needle);

  const visibleOrphans = orphans.filter(matches);
  const visibleStranded = stranded.filter((row) => matches(row.client));
  const visibleBuckets = buckets.map((bucket) => ({
    ...bucket,
    visible: bucket.clients.filter(matches),
  }));

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleMany(ids: readonly string[]) {
    setSelected((current) => {
      const next = new Set(current);
      const allSelected = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  function apply() {
    const clientIds = [...selected];
    if (clientIds.length === 0) return;
    const userId = destination === UNASSIGN ? null : destination;

    startTransition(async () => {
      const result = await assignPortfolioClients({ clanId, userId, clientIds });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const { moved, skipped } = result.data ?? { moved: 0, skipped: 0 };
      toast.success(
        `${moved} ${moved === 1 ? "empresa movida" : "empresas movidas"}` +
          (skipped > 0 ? ` · ${skipped} ignorada(s)` : ""),
      );
      setSelected(new Set());
      router.refresh();
    });
  }

  const assignedCount = buckets.reduce(
    (total, bucket) => total + bucket.clients.length,
    0,
  );

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg bg-muted/45 p-2.5">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Building2 className="size-3.5" aria-hidden /> Empresas
          </span>
          <strong className="mt-1 block font-mono text-lg">{totalClients}</strong>
        </div>
        <div className="rounded-lg bg-muted/45 p-2.5">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <UserRoundX className="size-3.5" aria-hidden /> Sem responsável
          </span>
          <strong
            className={cn(
              "mt-1 block font-mono text-lg",
              orphans.length + stranded.length + awaiting.length > 0 &&
                "text-destructive",
            )}
          >
            {orphans.length + stranded.length + awaiting.length}
          </strong>
        </div>
        <div className="rounded-lg bg-muted/45 p-2.5">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Users className="size-3.5" aria-hidden /> Na carteira
          </span>
          <strong className="mt-1 block font-mono text-lg">{assignedCount}</strong>
        </div>
        <div className="rounded-lg bg-muted/45 p-2.5">
          <span className="text-xs text-muted-foreground">Média por pessoa</span>
          <strong className="mt-1 block font-mono text-lg">
            {averagePerMember.toFixed(1)}
          </strong>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card/40 p-3">
        <div>
          <h2 className="font-medium">Carteira e Fichas Fiscais</h2>
          <p className="text-xs text-muted-foreground">
            O responsável pode mudar; regras e observações permanentes continuam com a empresa.
          </p>
        </div>
        {canManage ? <FiscalImportDialog clanId={clanId} /> : null}
      </div>

      {canManage && awaiting.length > 0 ? (
        <section className="grid gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
          <h3 className="flex items-center gap-1.5 text-sm font-medium">
            <Sparkles className="size-4 text-primary" aria-hidden />
            {awaiting.length}{" "}
            {awaiting.length === 1
              ? "cliente novo aguardando carteira"
              : "clientes novos aguardando carteira"}
          </h3>
          <ul className="grid gap-2">
            {awaiting.map((row) => (
              <AwaitingRow key={row.client.id} clanId={clanId} row={row} members={members} canManage={canManage} />
            ))}
          </ul>
        </section>
      ) : null}

      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar empresa pelo nome"
          aria-label="Buscar empresa"
          className="pl-9"
        />
      </div>

      {/* Barra de ação: só existe com seleção — sem seleção não há decisão. */}
      {canManage && selected.size > 0 ? (
        <div className="sticky bottom-20 z-20 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3 shadow-lg md:bottom-4">
          <span className="text-sm font-medium">
            {selected.size}{" "}
            {selected.size === 1 ? "empresa selecionada" : "empresas selecionadas"}
          </span>
          <Select value={destination} onValueChange={setDestination}>
            <SelectTrigger className="min-w-44 flex-1" aria-label="Destino">
              <SelectValue placeholder="Para quem" />
            </SelectTrigger>
            <SelectContent>
              {members.map((member) => (
                <SelectItem key={member.userId} value={member.userId}>
                  {member.name}
                </SelectItem>
              ))}
              <SelectItem value={UNASSIGN}>Tirar da carteira</SelectItem>
            </SelectContent>
          </Select>
          <Button type="button" disabled={pending || !destination} onClick={apply}>
            Mover
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => setSelected(new Set())}
          >
            Limpar
          </Button>
        </div>
      ) : null}

      {visibleStranded.length > 0 ? (
        <section className="grid gap-2 rounded-lg border border-destructive/50 bg-destructive/5 p-3">
          <h3 className="flex items-center gap-1.5 text-sm font-medium text-destructive">
            <AlertTriangle className="size-4" aria-hidden />
            {visibleStranded.length} com quem saiu do clã
          </h3>
          <ul className="grid gap-1">
            {visibleStranded.map(({ client, holderName }) => (
              <ClientRow
                key={client.id}
                clanId={clanId}
                client={client}
                selected={selected.has(client.id)}
                onToggle={toggle}
                selectable={canManage}
                canManage={canManage}
                contextNote={`estava com ${holderName}`}
              />
            ))}
          </ul>
        </section>
      ) : null}

      <section className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 font-medium">
            <UserRoundX className="size-4 text-muted-foreground" aria-hidden />
            Sem responsável
            <span className="font-mono text-sm text-muted-foreground">
              {visibleOrphans.length}
            </span>
          </h3>
          {canManage && visibleOrphans.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => toggleMany(visibleOrphans.map((client) => client.id))}
            >
              Selecionar todas
            </Button>
          ) : null}
        </div>
        {visibleOrphans.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            {needle
              ? "Nenhuma empresa sem responsável com esse nome."
              : "Toda empresa tem responsável."}
          </p>
        ) : (
          <ul className="grid gap-1">
            {visibleOrphans.map((client) => (
              <ClientRow
                key={client.id}
                clanId={clanId}
                client={client}
                selected={selected.has(client.id)}
                onToggle={toggle}
                selectable={canManage}
                canManage={canManage}
              />
            ))}
          </ul>
        )}
      </section>

      {visibleBuckets.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Nenhuma pessoa vinculada ao clã. A composição é definida nas
          Configurações da Guilda.
        </p>
      ) : (
        visibleBuckets.map((bucket) => (
          <section key={bucket.userId} className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-1.5 font-medium">
                {bucket.name}
                {bucket.isLeader ? (
                  <Crown className="size-3.5 text-primary" aria-hidden />
                ) : null}
                <span className="font-mono text-sm text-muted-foreground">
                  {bucket.clients.length}
                </span>
              </h3>
              {canManage && bucket.visible.length > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    toggleMany(bucket.visible.map((client) => client.id))
                  }
                >
                  Selecionar todas
                </Button>
              ) : null}
            </div>
            {bucket.visible.length === 0 ? (
              <p className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
                {needle
                  ? "Nenhuma empresa com esse nome nesta carteira."
                  : "Carteira vazia."}
              </p>
            ) : (
              <ul className="grid gap-1">
                {bucket.visible.map((client) => (
                  <ClientRow
                    key={client.id}
                    clanId={clanId}
                    client={client}
                    selected={selected.has(client.id)}
                    onToggle={toggle}
                    selectable={canManage}
                    canManage={canManage}
                  />
                ))}
              </ul>
            )}
          </section>
        ))
      )}
    </div>
  );
}
