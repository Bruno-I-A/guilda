"use client";

import { Check, Copy, MoreHorizontal, RefreshCw, ShieldCheck, ShieldOff, Trash2, UserPlus } from "lucide-react";
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

import { createMemberWithTempPassword } from "./actions";

/** Senha temporária legível (evita caracteres ambíguos tipo 0/O, l/1). */
function generateTempPassword(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 10; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

const addMemberSchema = z.object({
  name: z.string().trim().min(2, "Nome muito curto."),
  email: z.email("Informe um e-mail válido."),
  role: z.enum(["member", "admin"]),
});

export function InviteMemberDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [role, setRole] = useState<"member" | "admin">("member");
  const [submitting, setSubmitting] = useState(false);
  const [tempPassword, setTempPassword] = useState(generateTempPassword);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  function reset() {
    setError(undefined);
    setRole("member");
    setTempPassword(generateTempPassword());
    setCreated(null);
    setCopied(false);
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = addMemberSchema.safeParse({
      name: form.get("name"),
      email: form.get("email"),
      role,
    });
    if (!parsed.success) {
      const flat = z.flattenError(parsed.error).fieldErrors;
      setError(flat.name?.[0] ?? flat.email?.[0]);
      return;
    }
    setError(undefined);
    setSubmitting(true);
    const result = await createMemberWithTempPassword({
      ...parsed.data,
      tempPassword,
    });
    setSubmitting(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setCreated({ email: parsed.data.email, password: tempPassword });
    router.refresh();
  }

  async function copyCredentials() {
    if (!created) return;
    await navigator.clipboard.writeText(
      `Guilda — acesso criado\nE-mail: ${created.email}\nSenha temporária: ${created.password}\n\nVocê vai precisar trocar a senha no primeiro acesso.`,
    );
    setCopied(true);
    toast.success("Credenciais copiadas!");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <UserPlus aria-hidden /> Adicionar membro
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Membro criado!</DialogTitle>
              <DialogDescription>
                Copie e repasse estas credenciais — a senha só aparece aqui uma
                vez. A pessoa vai precisar trocá-la no primeiro acesso.
              </DialogDescription>
            </DialogHeader>
            {/*
              `frame-carved` não existe mais no globals.css — a caixa estava
              renderizando sem moldura nenhuma. Agora usa `panel-cut`, a
              superfície padrão do tema.
              A senha saiu do ouro: ouro é EXCLUSIVO de recompensa, e senha
              temporária não é prêmio — o destaque agora é o acento azul-gelo.
            */}
            <div className="panel-cut panel-cut-sm grid gap-2 p-4 font-mono text-sm">
              <div>
                <span className="text-muted-foreground">E-mail: </span>
                {created.email}
              </div>
              <div>
                <span className="text-muted-foreground">Senha: </span>
                <span className="font-semibold text-primary">
                  {created.password}
                </span>
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={copyCredentials}>
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />} Copiar
              </Button>
              <Button onClick={() => setOpen(false)}>Concluído</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Adicionar membro</DialogTitle>
              <DialogDescription>
                Cria a conta direto com uma senha temporária — sem link de
                convite.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={onSubmit} className="grid gap-4" noValidate>
              <div className="grid gap-2">
                <Label htmlFor="member-name">Nome</Label>
                <Input id="member-name" name="name" placeholder="Nome da pessoa" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="member-email">E-mail</Label>
                <Input
                  id="member-email"
                  name="email"
                  type="email"
                  placeholder="colega@empresa.com"
                  aria-invalid={Boolean(error)}
                />
                {error ? <p className="text-sm text-destructive">{error}</p> : null}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="member-role">Papel</Label>
                <Select value={role} onValueChange={(v) => setRole(v as "member" | "admin")}>
                  <SelectTrigger id="member-role" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">Membro</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="member-temp-password">Senha temporária</Label>
                <div className="flex gap-2">
                  <Input
                    id="member-temp-password"
                    value={tempPassword}
                    onChange={(e) => setTempPassword(e.target.value)}
                    className="font-mono"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="Gerar outra senha"
                    onClick={() => setTempPassword(generateTempPassword())}
                  >
                    <RefreshCw aria-hidden />
                  </Button>
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={submitting} className="w-full">
                  {submitting ? "Criando…" : "Criar acesso"}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
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
          {/* 28px de botão, 44px de alvo: o menu vive dentro de uma linha de
              lista e precisa ser acertável com o dedo. */}
          <Button
            variant="ghost"
            size="icon-sm"
            className="touch-target"
            aria-label={`Ações para ${memberName}`}
          >
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
              A pessoa perde o acesso à organização. O histórico de missões e XP
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
