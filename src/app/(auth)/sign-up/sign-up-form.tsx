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
import { orgSlug } from "@/lib/slug";

const baseSchema = z.object({
  name: z.string().trim().min(2, "Informe seu nome.").max(80, "Nome longo demais."),
  email: z.email("Informe um e-mail válido."),
  password: z
    .string()
    .min(8, "A senha precisa de pelo menos 8 caracteres.")
    .max(128, "Senha longa demais."),
});

const withOrgSchema = baseSchema.extend({
  organizationName: z
    .string()
    .trim()
    .min(2, "Informe o nome da organização.")
    .max(80, "Nome longo demais."),
});

type FieldName = "name" | "email" | "password" | "organizationName";

export function SignUpForm({
  inviteId,
  inviteEmail,
}: {
  inviteId?: string;
  inviteEmail?: string;
}) {
  const router = useRouter();
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const joiningByInvite = Boolean(inviteId);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const raw = {
      name: form.get("name"),
      email: form.get("email"),
      password: form.get("password"),
      ...(joiningByInvite ? {} : { organizationName: form.get("organizationName") }),
    };
    const parsed = joiningByInvite
      ? baseSchema.safeParse(raw)
      : withOrgSchema.safeParse(raw);
    if (!parsed.success) {
      const flat = z.flattenError(parsed.error).fieldErrors as Partial<
        Record<FieldName, string[]>
      >;
      setErrors({
        name: flat.name?.[0],
        email: flat.email?.[0],
        password: flat.password?.[0],
        organizationName: flat.organizationName?.[0],
      });
      return;
    }
    setErrors({});
    setSubmitting(true);

    const { error: signUpError } = await authClient.signUp.email({
      name: parsed.data.name,
      email: parsed.data.email,
      password: parsed.data.password,
    });
    if (signUpError) {
      setSubmitting(false);
      toast.error(authErrorMessage(signUpError));
      return;
    }

    if (joiningByInvite && inviteId) {
      // Conta criada a partir de um convite: entra na organização do convite.
      const { data, error } = await authClient.organization.acceptInvitation({
        invitationId: inviteId,
      });
      if (error || !data) {
        setSubmitting(false);
        toast.error(error ? authErrorMessage(error) : "Não foi possível aceitar o convite.");
        // conta existe mas sem org — onboarding resolve
        router.push("/onboarding");
        return;
      }
      await authClient.organization.setActive({
        organizationId: data.invitation.organizationId,
      });
    } else {
      const organizationName = (parsed.data as z.infer<typeof withOrgSchema>)
        .organizationName;
      const { data: org, error: orgError } = await authClient.organization.create({
        name: organizationName,
        slug: orgSlug(organizationName),
      });
      if (orgError || !org) {
        setSubmitting(false);
        toast.error(orgError ? authErrorMessage(orgError) : "Não foi possível criar a organização.");
        router.push("/onboarding");
        return;
      }
      await authClient.organization.setActive({ organizationId: org.id });
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <Card className="panel-cut texture-iron">
      <CardHeader>
        <CardTitle>Criar conta</CardTitle>
        <CardDescription>
          {joiningByInvite
            ? "Crie sua conta para aceitar o convite."
            : "Crie sua conta e a organização da sua equipe."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <div className="grid gap-2">
            <Label htmlFor="name">Seu nome</Label>
            <Input
              id="name"
              name="name"
              autoComplete="name"
              placeholder="Maria Silva"
              aria-invalid={Boolean(errors.name)}
            />
            {errors.name ? (
              <p className="text-sm text-destructive">{errors.name}</p>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="voce@empresa.com"
              defaultValue={inviteEmail}
              readOnly={Boolean(inviteEmail)}
              aria-invalid={Boolean(errors.email)}
            />
            {inviteEmail ? (
              <p className="text-xs text-muted-foreground">
                O convite foi emitido para este e-mail.
              </p>
            ) : null}
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
              autoComplete="new-password"
              aria-invalid={Boolean(errors.password)}
            />
            {errors.password ? (
              <p className="text-sm text-destructive">{errors.password}</p>
            ) : null}
          </div>
          {joiningByInvite ? null : (
            <div className="grid gap-2">
              <Label htmlFor="organizationName">Nome da organização</Label>
              <Input
                id="organizationName"
                name="organizationName"
                placeholder="Ex.: Acme Ltda"
                aria-invalid={Boolean(errors.organizationName)}
              />
              {errors.organizationName ? (
                <p className="text-sm text-destructive">{errors.organizationName}</p>
              ) : null}
            </div>
          )}
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Criando conta…" : "Criar conta"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Já tem conta?{" "}
            <Link
              href={inviteId ? `/sign-in?next=/invite/${inviteId}` : "/sign-in"}
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              Entrar
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
