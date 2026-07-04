import { eq } from "drizzle-orm";
import { Swords } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { getSession } from "@/lib/session";

import { AcceptInviteButton } from "./accept-invite-button";

export const metadata: Metadata = { title: "Convite" };

function InviteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted/40 p-4">
      <div className="flex items-center gap-2 font-semibold text-lg">
        <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Swords className="size-4" aria-hidden />
        </span>
        Guilda
      </div>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}

export default async function InvitePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const invitation = await db.query.invitation.findFirst({
    where: eq(schema.invitation.id, id),
    with: { organization: true, user: true },
  });

  if (!invitation) {
    return (
      <InviteShell>
        <Card>
          <CardHeader>
            <CardTitle>Convite não encontrado</CardTitle>
            <CardDescription>
              O link pode estar incorreto ou o convite foi removido.
            </CardDescription>
          </CardHeader>
        </Card>
      </InviteShell>
    );
  }

  const expired = invitation.expiresAt.getTime() < Date.now();
  if (invitation.status !== "pending" || expired) {
    return (
      <InviteShell>
        <Card>
          <CardHeader>
            <CardTitle>
              {expired ? "Convite expirado" : "Convite indisponível"}
            </CardTitle>
            <CardDescription>
              {expired
                ? "Peça um novo convite a alguém da organização."
                : "Este convite já foi aceito ou cancelado."}
            </CardDescription>
          </CardHeader>
        </Card>
      </InviteShell>
    );
  }

  const session = await getSession();
  const signUpHref = `/sign-up?invite=${invitation.id}&email=${encodeURIComponent(invitation.email)}`;
  const signInHref = `/sign-in?next=${encodeURIComponent(`/invite/${invitation.id}`)}`;

  return (
    <InviteShell>
      <Card>
        <CardHeader>
          <CardTitle>Convite para {invitation.organization.name}</CardTitle>
          <CardDescription>
            {invitation.user.name} convidou <strong>{invitation.email}</strong>{" "}
            para entrar como{" "}
            {invitation.role === "admin" ? "administrador(a)" : "membro"}.
          </CardDescription>
        </CardHeader>
        {session ? (
          <CardContent>
            {session.user.email.toLowerCase() === invitation.email.toLowerCase() ? (
              <AcceptInviteButton
                invitationId={invitation.id}
                organizationId={invitation.organizationId}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Você está conectado(a) como <strong>{session.user.email}</strong>,
                mas o convite é para <strong>{invitation.email}</strong>. Saia da
                conta atual e entre (ou crie a conta) com o e-mail convidado.
              </p>
            )}
          </CardContent>
        ) : (
          <CardFooter className="flex-col gap-2">
            <Button asChild className="w-full">
              <Link href={signUpHref}>Criar conta e aceitar</Link>
            </Button>
            <Button asChild variant="outline" className="w-full">
              <Link href={signInHref}>Já tenho conta</Link>
            </Button>
          </CardFooter>
        )}
      </Card>
    </InviteShell>
  );
}
