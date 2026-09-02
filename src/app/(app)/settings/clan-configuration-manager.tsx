"use client";

import { Pencil, Plus, Route, Save, Trash2, UserRoundCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  CLAN_DUTIES,
  CLAN_DUTY_DESCRIPTIONS,
  CLAN_DUTY_LABELS,
  type ClanDuty,
} from "@/domain/clan-duties";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import {
  createClan,
  replaceClanRoutingRules,
  setClanDuty,
  updateClan,
} from "./clan-actions";

export function CreateClanDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await createClan({
        name: String(form.get("name") ?? ""),
        description: String(form.get("description") ?? "") || null,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Novo clã criado e você foi definido como liderança.");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button"><Plus aria-hidden /> Novo clã</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Criar clã</DialogTitle>
          <DialogDescription>
            O clã nasce com Missões, Integrantes e Campanhas. As partes dos
            Informativos são configuradas depois, sem alterar o código.
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-1.5">
            <Label htmlFor="new-clan-name">Nome</Label>
            <Input id="new-clan-name" name="name" required maxLength={100} placeholder="Ex.: Atendimento" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="new-clan-description">Responsabilidade do clã</Label>
            <Textarea id="new-clan-description" name="description" maxLength={500} rows={3} placeholder="O que esta equipe assume dentro do escritório" />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>{pending ? "Criando…" : "Criar clã"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ClanDetailsDialog({
  clanId,
  name,
  description,
  active,
}: {
  clanId: string;
  name: string;
  description: string | null;
  active: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(active);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await updateClan({
        clanId,
        name: String(form.get("name") ?? ""),
        description: String(form.get("description") ?? "") || null,
        active: enabled,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Configuração do clã atualizada.");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Editar clã ${name}`}>
          <Pencil aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Configurar clã</DialogTitle>
          <DialogDescription>
            O identificador interno permanece estável; nome, responsabilidade e
            disponibilidade podem mudar sem perder histórico.
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-1.5">
            <Label htmlFor={`clan-name-${clanId}`}>Nome</Label>
            <Input id={`clan-name-${clanId}`} name="name" defaultValue={name} required maxLength={100} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`clan-description-${clanId}`}>Responsabilidade</Label>
            <Textarea id={`clan-description-${clanId}`} name="description" defaultValue={description ?? ""} maxLength={500} rows={3} />
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={() => setEnabled((current) => !current)}
            className="panel-cut panel-cut-sm flex min-h-11 items-center justify-between bg-card/50 px-3 text-left text-sm"
          >
            <span><strong className="block">Clã ativo</strong><span className="text-xs text-muted-foreground">Clãs inativos preservam histórico, mas não recebem novas missões.</span></span>
            <span className={enabled ? "font-mono text-success" : "font-mono text-muted-foreground"}>{enabled ? "SIM" : "NÃO"}</span>
          </button>
          <DialogFooter>
            <Button type="submit" disabled={pending}>{pending ? "Salvando…" : "Salvar"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface RoutingMember {
  userId: string;
  name: string;
  functionTitle: string | null;
}

interface EditableRule {
  sector: string;
  userId: string | null;
}

export function ClanRoutingManager({
  clanId,
  clanName,
  members,
  initialRules,
}: {
  clanId: string;
  clanName: string;
  members: RoutingMember[];
  initialRules: EditableRule[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [rules, setRules] = useState(initialRules);

  function save() {
    startTransition(async () => {
      const result = await replaceClanRoutingRules({ clanId, rules });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Destinos dos Informativos de ${clanName} atualizados.`);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <section className="grid gap-2 border-t border-border/70 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Route className="size-4 text-primary" aria-hidden /> Destinos dos Informativos
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {initialRules.length === 0
              ? "Nenhuma parte configurada; o clã não recebe linhas automaticamente."
              : `${initialRules.length} ${initialRules.length === 1 ? "nome de setor configurado" : "nomes de setor configurados"}.`}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setRules(initialRules);
            setOpen(true);
          }}
        >
          <Route aria-hidden /> Configurar destinos
        </Button>
      </div>

      {initialRules.length > 0 ? (
        <p className="line-clamp-2 text-xs text-muted-foreground">
          {initialRules.map((rule) => rule.sector).join(" · ")}
        </p>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Destinos de {clanName}</DialogTitle>
            <DialogDescription>
              Cada nome abaixo representa uma parte ou setor que pode aparecer
              no Informativo. A regra envia a missão para a fila do clã ou
              diretamente para uma pessoa deste clã.
            </DialogDescription>
          </DialogHeader>

          <div className="flex justify-end">
            <Button type="button" variant="outline" size="sm" onClick={() => setRules((current) => [...current, { sector: "", userId: null }])}>
              <Plus aria-hidden /> Adicionar parte
            </Button>
          </div>

          {rules.length === 0 ? (
            <p className="panel-cut panel-cut-sm bg-card/30 p-4 text-center text-xs text-muted-foreground">
              Nenhum nome de setor configurado. Este clã não receberá linhas automaticamente.
            </p>
          ) : (
            <div className="grid gap-2">
              {rules.map((rule, index) => (
                <div key={index} className="grid gap-2 sm:grid-cols-[minmax(10rem,1fr)_minmax(12rem,1fr)_auto]">
                  <Input
                    value={rule.sector}
                    maxLength={120}
                    aria-label={`Nome do setor ${index + 1}`}
                    placeholder="Ex.: Emissão de notas"
                    onChange={(event) => setRules((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, sector: event.target.value } : item))}
                  />
                  <Select
                    value={rule.userId ?? "clan"}
                    onValueChange={(value) => setRules((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, userId: value === "clan" ? null : value } : item))}
                  >
                    <SelectTrigger aria-label={`Destino de ${rule.sector || `regra ${index + 1}`}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="clan">Fila do clã</SelectItem>
                      {members.map((member) => (
                        <SelectItem key={member.userId} value={member.userId}>
                          {member.name}{member.functionTitle ? ` · ${member.functionTitle}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="ghost" size="icon" aria-label={`Remover regra ${rule.sector || index + 1}`} onClick={() => setRules((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <DialogFooter>
            <Button type="button" disabled={pending || rules.some((rule) => !rule.sector.trim())} onClick={save}>
              <Save aria-hidden /> {pending ? "Salvando…" : "Salvar destinos"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

const SEM_RESPONSAVEL = "__sem_responsavel__";

/**
 * Quem responde por cada atribuição do clã.
 *
 * Sem diálogo de propósito: são poucas atribuições e a troca é de um campo só —
 * abrir modal para mudar um seletor é fricção sem ganho. Salva na hora.
 */
export function ClanDutiesManager({
  clanId,
  clanName,
  members,
  duties,
}: {
  clanId: string;
  clanName: string;
  members: RoutingMember[];
  duties: { duty: ClanDuty; userId: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const donoDe = new Map(duties.map((entry) => [entry.duty, entry.userId]));

  function salvar(duty: ClanDuty, valor: string) {
    const userId = valor === SEM_RESPONSAVEL ? null : valor;
    startTransition(async () => {
      const result = await setClanDuty({ clanId, duty, userId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const nome = members.find((m) => m.userId === userId)?.name;
      toast.success(
        userId
          ? `${nome} agora responde por “${CLAN_DUTY_LABELS[duty]}” em ${clanName}.`
          : `“${CLAN_DUTY_LABELS[duty]}” voltou para a fila de ${clanName}.`,
      );
      router.refresh();
    });
  }

  return (
    <section className="grid gap-3 border-t border-border/70 pt-4">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <UserRoundCheck className="size-4 text-primary" aria-hidden /> Atribuições
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Quem recebe nominalmente cada etapa recorrente. Sem responsável, o
          trabalho cai na fila de distribuição do clã.
        </p>
      </div>

      {members.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Este clã ainda não tem integrantes para receber atribuições.
        </p>
      ) : (
        <div className="grid gap-3">
          {CLAN_DUTIES.map((duty) => (
            <div key={duty} className="grid gap-1.5">
              <Label htmlFor={`duty-${clanId}-${duty}`}>
                {CLAN_DUTY_LABELS[duty]}
              </Label>
              <Select
                value={donoDe.get(duty) ?? SEM_RESPONSAVEL}
                onValueChange={(valor) => salvar(duty, valor)}
                disabled={pending}
              >
                <SelectTrigger id={`duty-${clanId}-${duty}`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEM_RESPONSAVEL}>
                    Ninguém — cai na fila do clã
                  </SelectItem>
                  {members.map((member) => (
                    <SelectItem key={member.userId} value={member.userId}>
                      {member.name}
                      {member.functionTitle ? ` · ${member.functionTitle}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {CLAN_DUTY_DESCRIPTIONS[duty]}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
