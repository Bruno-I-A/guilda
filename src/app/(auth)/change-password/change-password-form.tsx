"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-errors";

export function ChangePasswordForm({ forced }: { forced: boolean }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<{ next?: string; confirm?: string }>({});

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const currentPassword = String(form.get("currentPassword") ?? "");
    const newPassword = String(form.get("newPassword") ?? "");
    const confirmPassword = String(form.get("confirmPassword") ?? "");

    const nextErrors: typeof errors = {};
    if (newPassword.length < 8) {
      nextErrors.next = "A senha precisa ter pelo menos 8 caracteres.";
    }
    if (newPassword !== confirmPassword) {
      nextErrors.confirm = "As senhas não coincidem.";
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});
    setSubmitting(true);

    const { error } = await authClient.changePassword({ currentPassword, newPassword });
    if (error) {
      setSubmitting(false);
      toast.error(authErrorMessage(error));
      return;
    }

    // Marca a troca como feita — deixa de ser redirecionado para cá.
    await authClient.updateUser({ mustChangePassword: false });
    setSubmitting(false);
    toast.success("Senha alterada!");
    router.push("/dashboard");
    router.refresh();
  }

  return (
    // Era `frame-carved`, utilitário que deixou de existir quando o passe
    // épico o substituiu por `panel-cut` — a classe estava morta e este card
    // vinha sem superfície temática nenhuma.
    <Card className="panel-cut texture-iron rounded-none border-0 ring-0">
      <CardHeader>
        <CardTitle asChild>
          <h1>{forced ? "Defina sua senha" : "Alterar senha"}</h1>
        </CardTitle>
        <CardDescription>
          {forced
            ? "Você está usando uma senha temporária — defina uma senha só sua para continuar."
            : "Informe sua senha atual e a nova senha."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <div className="grid gap-2">
            <Label htmlFor="currentPassword">
              {forced ? "Senha temporária" : "Senha atual"}
            </Label>
            <Input
              id="currentPassword"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="newPassword">Nova senha</Label>
            <Input
              id="newPassword"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              aria-invalid={Boolean(errors.next)}
            />
            {errors.next ? <p className="text-sm text-destructive">{errors.next}</p> : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="confirmPassword">Confirmar nova senha</Label>
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              aria-invalid={Boolean(errors.confirm)}
            />
            {errors.confirm ? (
              <p className="text-sm text-destructive">{errors.confirm}</p>
            ) : null}
          </div>
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Salvando…" : "Salvar nova senha"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
