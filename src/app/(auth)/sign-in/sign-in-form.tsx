"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

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

const schema = z.object({
  email: z.email("Informe um e-mail válido."),
  password: z.string().min(1, "Informe sua senha."),
});

export function SignInForm({ next }: { next?: string }) {
  const router = useRouter();
  const [errors, setErrors] = useState<Partial<Record<"email" | "password", string>>>({});
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = schema.safeParse({
      email: form.get("email"),
      password: form.get("password"),
    });
    if (!parsed.success) {
      const flat = z.flattenError(parsed.error).fieldErrors;
      setErrors({ email: flat.email?.[0], password: flat.password?.[0] });
      return;
    }
    setErrors({});
    setSubmitting(true);
    const { error } = await authClient.signIn.email({
      email: parsed.data.email,
      password: parsed.data.password,
    });
    if (error) {
      setSubmitting(false);
      toast.error(authErrorMessage(error));
      return;
    }
    router.push(next ?? "/dashboard");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Entrar</CardTitle>
        <CardDescription>Acesse sua guilda para continuar.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <div className="grid gap-2">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="voce@empresa.com"
              aria-invalid={Boolean(errors.email)}
            />
            {errors.email ? (
              <p className="text-sm text-destructive">{errors.email}</p>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">Senha</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              aria-invalid={Boolean(errors.password)}
            />
            {errors.password ? (
              <p className="text-sm text-destructive">{errors.password}</p>
            ) : null}
          </div>
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Entrando…" : "Entrar"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Não tem conta?{" "}
            <Link href="/sign-up" className="font-medium text-foreground underline-offset-4 hover:underline">
              Criar conta
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
