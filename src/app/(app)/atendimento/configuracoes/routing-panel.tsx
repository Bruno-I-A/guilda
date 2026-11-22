"use client";

import { LoaderCircle, Route, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ClanRoutingView } from "@/lib/support/agent/routing";

import { saveClanRouting } from "./routing-actions";

/**
 * Encaminhamento por assunto (2026-11-20): quando o agente encaminha ao clã,
 * vai para a pessoa do assunto, para o responsável da Carteira ou para o líder.
 */
export function RoutingPanel({ clans }: { clans: ClanRoutingView[] }) {
  return (
    <section className="panel-cut grid min-w-0 grid-cols-1 gap-5 border border-border bg-card p-5">
      <div className="flex min-w-0 gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center border border-primary/30 bg-primary/10 text-primary">
          <Route className="size-5" aria-hidden />
        </div>
        <div className="min-w-0">
          <h2>Quem atende cada assunto</h2>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            Quando o agente encaminha a um clã, a conversa vai para a pessoa do assunto. No Fiscal, os assuntos da Carteira
            vão para o responsável da empresa. O que não casar vai para o líder. Só quem recebe a conversa é avisado.
          </p>
        </div>
      </div>
      {clans.filter((clan) => clan.members.length > 0).map((clan) => (
        <ClanRoutingForm key={clan.id} clan={clan} />
      ))}
    </section>
  );
}

function ClanRoutingForm({ clan }: { clan: ClanRoutingView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const initialPeople = Object.fromEntries(clan.members.map((m) => [m.userId, clan.rules.find((r) => r.userId === m.userId)?.topics ?? ""]));
  const initialPortfolio = clan.rules.find((r) => r.userId === null)?.topics ?? "";
  const [people, setPeople] = useState<Record<string, string>>(initialPeople);
  const [portfolio, setPortfolio] = useState(initialPortfolio);
  const changed = portfolio.trim() !== initialPortfolio || clan.members.some((m) => (people[m.userId] ?? "").trim() !== initialPeople[m.userId]);
  const leaders = clan.members.filter((m) => m.isLeader);

  function save() {
    start(async () => {
      const result = await saveClanRouting({
        clanId: clan.id,
        people: clan.members.map((m) => ({ userId: m.userId, topics: people[m.userId] ?? "" })),
        portfolioTopics: portfolio,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Assuntos do ${clan.name} salvos.`);
      router.refresh();
    });
  }

  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 border border-border p-4" aria-busy={pending}>
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
        <h3>{clan.name}</h3>
        <span className="text-xs text-muted-foreground">
          {leaders.length === 0
            ? "Sem líder: o que não casar avisa o clã inteiro."
            : leaders.length === 1
              ? `O que não casar vai para ${leaders[0].name}.`
              : "O que não casar avisa os líderes."}
        </span>
      </div>
      {clan.members.map((member) => (
        <div key={member.userId} className="grid min-w-0 grid-cols-1 gap-1.5 sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-center sm:gap-3">
          <Label htmlFor={`topics-${clan.id}-${member.userId}`} className="min-w-0 break-words">
            {member.name}
            {member.isLeader ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">líder</span> : null}
          </Label>
          <Input
            id={`topics-${clan.id}-${member.userId}`}
            value={people[member.userId] ?? ""}
            onChange={(event) => setPeople((current) => ({ ...current, [member.userId]: event.target.value }))}
            placeholder="Assuntos que atende, ex.: parcelamento, guia de parcelamento"
            maxLength={500}
            autoComplete="off"
          />
        </div>
      ))}
      {clan.isPortfolioClan ? (
        <div className="grid min-w-0 grid-cols-1 gap-1.5 border-t border-border pt-3 sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-start sm:gap-3">
          <Label htmlFor={`topics-${clan.id}-portfolio`} className="min-w-0 break-words sm:pt-2">
            Assuntos da Carteira
          </Label>
          <div className="grid min-w-0 gap-1.5">
            <Input
              id={`topics-${clan.id}-portfolio`}
              value={portfolio}
              onChange={(event) => setPortfolio(event.target.value)}
              placeholder="ex.: guias de imposto, guia atrasada"
              maxLength={500}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Vão para o responsável da empresa na Carteira quando a conversa está vinculada a ela; sem empresa, para o líder.
            </p>
          </div>
        </div>
      ) : null}
      <div>
        <Button type="button" variant="outline" onClick={save} disabled={pending || !changed}>
          {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Save aria-hidden />}
          Salvar {clan.name}
        </Button>
      </div>
    </div>
  );
}
