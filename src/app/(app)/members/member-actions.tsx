"use client";

import { Copy, MoreHorizontal, ShieldCheck, ShieldOff, Trash2, UserPlus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

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
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-errors";

function inviteLink(invitationId: string): string {
  return `${window.location.origin}/invite/${invitationId}`;
}

async function copyInviteLink(invitationId: string) {
  await navigator.clipboard.writeText(inviteLink(invitationId));
  toast.success("Link do convite copiado!");
}

const inviteSchema = z.object({
  email: z.email("Informe um e-mail válido."),
  role: z.enum(["member", "admin"]),
});

export function InviteMemberDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [role, setRole] = useState<"member" | "admin">("member");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = inviteSchema.safeParse({ email: form.get("email"), role });
    if (!parsed.success) {
      setError(z.flattenError(parsed.error).fieldErrors.email?.[0]);
      return;
    }
    setError(undefined);
    setSubmitting(true);
    const { data, error: apiError } = await authClient.organization.inviteMember({
      email: parsed.data.email,
      role: parsed.data.role,
    });
    setSubmitting(false);
    if (apiError || !data) {
      toast.error(apiError ? authErrorMessage(apiError) : "Não foi possível criar o convite.");
      return;
    }
    await copyInviteLink(data.id);
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus aria-hidden /> Convidar
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Convidar para a guilda</DialogTitle>
          <DialogDescription>
            O convite gera um link para compartilhar com a pessoa convidada.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <div className="grid gap-2">
            <Label htmlFor="invite-email">E-mail</Label>
            <Input
              id="invite-email"
              name="email"
              type="email"
              placeholder="colega@empresa.com"
              aria-invalid={Boolean(error)}
            />
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="invite-role">Papel</Label>
            <Select value={role} onValueChange={(v) => setRole(v as "member" | "admin")}>
              <SelectTrigger id="invite-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">Membro</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? "Criando convite…" : "Criar convite e copiar link"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function InvitationActions({ invitationId }: { invitationId: string }) {
  const router = useRouter();
  const [cancelling, setCancelling] = useState(false);

  async function cancel() {
    setCancelling(true);
    const { error } = await authClient.organization.cancelInvitation({ invitationId });
    setCancelling(false);
    if (error) {
      toast.error(authErrorMessage(error));
      return;
    }
    toast.success("Convite cancelado.");
    router.refresh();
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="outline"
        size="sm"
        onClick={() => copyInviteLink(invitationId)}
      >
        <Copy aria-hidden /> Copiar link
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Cancelar convite"
        disabled={cancelling}
        onClick={cancel}
      >
        <X aria-hidden />
      </Button>
    </div>
  );
}

export function MemberActions({
  memberId,
  memberName,
  role,
  organizationId,
}: {
  memberId: string;
  memberName: string;
  role: string;
  organizationId: string;
}) {
  const router = useRouter();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);

  async function changeRole(nextRole: "member" | "admin") {
    setBusy(true);
    const { error } = await authClient.organization.updateMemberRole({
      memberId,
      role: nextRole,
    });
    setBusy(false);
    if (error) {
      toast.error(authErrorMessage(error));
      return;
    }
    toast.success(
      nextRole === "admin"
        ? `${memberName} agora é admin.`
        : `${memberName} agora é membro.`,
    );
    router.refresh();
  }

  async function removeMember() {
    setBusy(true);
    const { error } = await authClient.organization.removeMember({
      memberIdOrEmail: memberId,
      organizationId,
    });
    setBusy(false);
    setConfirmRemove(false);
    if (error) {
      toast.error(authErrorMessage(error));
      return;
    }
    toast.success(`${memberName} foi removido(a) da organização.`);
    router.refresh();
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Ações para ${memberName}`}>
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {role === "admin" ? (
            <DropdownMenuItem disabled={busy} onSelect={() => changeRole("member")}>
              <ShieldOff aria-hidden /> Rebaixar para membro
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem disabled={busy} onSelect={() => changeRole("admin")}>
              <ShieldCheck aria-hidden /> Promover a admin
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            variant="destructive"
            disabled={busy}
            onSelect={() => setConfirmRemove(true)}
          >
            <Trash2 aria-hidden /> Remover da organização
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Remover {memberName}?</DialogTitle>
            <DialogDescription>
              A pessoa perde o acesso à organização. O histórico de tarefas e XP
              é preservado.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmRemove(false)}>
              Cancelar
            </Button>
            <Button variant="destructive" disabled={busy} onClick={removeMember}>
              {busy ? "Removendo…" : "Remover"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
