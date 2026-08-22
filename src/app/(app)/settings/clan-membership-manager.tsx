"use client";

import { Crown, MoreHorizontal, Pencil, Star, Trash2, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
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
import type { ActionResult } from "@/lib/action-context";

import {
  addClanMembership,
  removeClanMembership,
  setClanLeader,
  setClanMemberFunction,
  setPrimaryClan,
} from "./clan-actions";

interface MembershipView {
  userId: string;
  name: string;
  isLeader: boolean;
  isPrimary: boolean;
  functionTitle: string | null;
}

interface OrgMemberView {
  userId: string;
  name: string;
}

export function ClanMembershipManager({
  clanId,
  clanName,
  memberships,
  orgMembers,
}: {
  clanId: string;
  clanName: string;
  memberships: MembershipView[];
  orgMembers: OrgMemberView[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const available = useMemo(
    () =>
      orgMembers.filter(
        (member) =>
          !memberships.some((membership) => membership.userId === member.userId),
      ),
    [memberships, orgMembers],
  );
  const [selectedUserId, setSelectedUserId] = useState(available[0]?.userId ?? "");
  const [editingFunction, setEditingFunction] = useState<MembershipView | null>(null);
  const [functionTitle, setFunctionTitle] = useState("");
  const effectiveSelectedUserId = available.some(
    (member) => member.userId === selectedUserId,
  )
    ? selectedUserId
    : available[0]?.userId ?? "";

  function run(action: () => Promise<ActionResult>, successMessage: string) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(successMessage);
      router.refresh();
    });
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {available.length > 0 ? (
          <>
            <Select value={effectiveSelectedUserId} onValueChange={setSelectedUserId}>
              <SelectTrigger
                className="min-w-48 flex-1"
                aria-label={`Adicionar pessoa ao clã ${clanName}`}
              >
                <SelectValue placeholder="Escolha uma pessoa" />
              </SelectTrigger>
              <SelectContent>
                {available.map((member) => (
                  <SelectItem key={member.userId} value={member.userId}>
                    {member.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={
                pending ||
                !effectiveSelectedUserId
              }
              onClick={() =>
                run(
                  () =>
                    addClanMembership({
                      clanId,
                      userId: effectiveSelectedUserId,
                    }),
                  `Pessoa adicionada ao clã ${clanName}.`,
                )
              }
            >
              <UserPlus aria-hidden /> Adicionar
            </Button>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            Todas as pessoas da Guilda já participam deste clã.
          </p>
        )}
      </div>

      {memberships.length > 0 ? (
        <ul className="grid gap-1">
          {memberships.map((membership) => (
            <li
              key={membership.userId}
              className="flex min-w-0 items-center gap-2 rounded-md bg-muted/35 px-2.5 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                <span className="block truncate">{membership.name}</span>
                <span className="block truncate text-[11px] font-normal text-muted-foreground">
                  {membership.functionTitle ?? "Função não definida"}
                </span>
              </span>
              {membership.isLeader ? (
                <Badge variant="default" className="gap-1">
                  <Crown className="size-3" aria-hidden /> Líder
                </Badge>
              ) : null}
              {membership.isPrimary ? (
                <Badge variant="secondary" className="gap-1">
                  <Star className="size-3" aria-hidden /> Principal
                </Badge>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={pending}
                    aria-label={`Gerenciar ${membership.name} em ${clanName}`}
                  >
                    <MoreHorizontal aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() => {
                      setEditingFunction(membership);
                      setFunctionTitle(membership.functionTitle ?? "");
                    }}
                  >
                    <Pencil aria-hidden /> Definir função
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      run(
                        () =>
                          setClanLeader({
                            clanId,
                            userId: membership.userId,
                            isLeader: !membership.isLeader,
                          }),
                        membership.isLeader
                          ? "Liderança retirada."
                          : "Nova liderança definida.",
                      )
                    }
                  >
                    <Crown aria-hidden />
                    {membership.isLeader ? "Retirar liderança" : "Tornar líder"}
                  </DropdownMenuItem>
                  {!membership.isPrimary ? (
                    <DropdownMenuItem
                      onSelect={() =>
                        run(
                          () =>
                            setPrimaryClan({
                              clanId,
                              userId: membership.userId,
                            }),
                          "Clã principal atualizado.",
                        )
                      }
                    >
                      <Star aria-hidden /> Marcar como principal
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() =>
                      run(
                        () =>
                          removeClanMembership({
                            clanId,
                            userId: membership.userId,
                          }),
                        `Pessoa removida do clã ${clanName}.`,
                      )
                    }
                  >
                    <Trash2 aria-hidden /> Remover do clã
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      ) : null}

      <Dialog
        open={Boolean(editingFunction)}
        onOpenChange={(open) => {
          if (!open) setEditingFunction(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Função no clã</DialogTitle>
            <DialogDescription>
              Descreve a responsabilidade profissional de {editingFunction?.name} em {clanName}.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor={`function-${editingFunction?.userId ?? "member"}`}>Função</Label>
            <Input
              id={`function-${editingFunction?.userId ?? "member"}`}
              value={functionTitle}
              maxLength={100}
              placeholder="Ex.: Analista fiscal"
              onChange={(event) => setFunctionTitle(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              disabled={pending || !editingFunction}
              onClick={() => {
                if (!editingFunction) return;
                const target = editingFunction;
                run(
                  () => setClanMemberFunction({
                    clanId,
                    userId: target.userId,
                    functionTitle: functionTitle.trim() || null,
                  }),
                  "Função atualizada.",
                );
                setEditingFunction(null);
              }}
            >
              Salvar função
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
