"use client";

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

const schema = z.object({
  organizationName: z
    .string()
    .trim()
    .min(2, "Informe o nome da organização.")
    .max(80, "Nome longo demais."),
});

export function CreateOrgForm({ userName }: { userName: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = schema.safeParse({ organizationName: form.get("organizationName") });
    if (!parsed.success) {
      setError(z.flattenError(parsed.error).fieldErrors.organizationName?.[0]);
      return;
    }
    setError(undefined);
    setSubmitting(true);
    const { data: org, error: orgError } = await authClient.organization.create({
      name: parsed.data.organizationName,
      slug: orgSlug(parsed.data.organizationName),
    });
    if (orgError || !org) {
      setSubmitting(false);
      toast.error(orgError ? authErrorMessage(orgError) : "Não foi possível criar a organização.");
      return;
    }
    await authClient.organization.setActive({ organizationId: org.id });
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Quase lá, {userName.split(" ")[0]}!</CardTitle>
        <CardDescription>
          Sua conta ainda não pertence a nenhuma organização. Crie a sua para
          começar — ou peça um convite a alguém da sua equipe.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <div className="grid gap-2">
            <Label htmlFor="organizationName">Nome da organização</Label>
            <Input
              id="organizationName"
              name="organizationName"
              placeholder="Ex.: Acme Ltda"
              aria-invalid={Boolean(error)}
            />
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Criando…" : "Criar organização"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
