import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { GuildCrest } from "@/components/guild-crest";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { requireSession } from "@/lib/session";

import { SignOutButton } from "./sign-out-button";

export const metadata: Metadata = { title: "Sem organização" };

/**
 * Para onde vai quem está logado sem uma organização que valha: conta sem
 * vínculo nenhum, ou sessão que ainda aponta para o escritório de onde a
 * pessoa saiu.
 *
 * Organização não se cria pelo app (auth.ts, `allowUserToCreateOrganization`),
 * então aqui não há formulário: só a explicação e a saída. O vínculo é
 * conferido de verdade antes de mandar ao painel — confiar apenas em
 * `activeOrganizationId` fazia /dashboard e /onboarding se redirecionarem
 * um para o outro sem fim quando a pessoa já tinha sido removida.
 */
export default async function OnboardingPage() {
  const session = await requireSession();
  const memberships = await db.query.member.findMany({
    where: eq(schema.member.userId, session.user.id),
    columns: { organizationId: true },
  });
  const activeOrgId = session.session.activeOrganizationId;
  if (activeOrgId && memberships.some((m) => m.organizationId === activeOrgId)) {
    redirect("/dashboard");
  }
  const hasOtherOrganization = memberships.length > 0;

  return (
    // Alinhado ao (auth)/layout: as duas telas são vizinhas no funil de entrada.
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 p-4">
      <div className="flex flex-col items-center gap-3 font-heading text-2xl font-semibold tracking-widest">
        <GuildCrest className="size-16" />
        Guilda
      </div>
      <div className="w-full max-w-sm">
        <Card className="panel-cut texture-iron rounded-none border-0 ring-0">
          <CardHeader>
            <CardTitle asChild>
              <h1>{hasOtherOrganization ? "Entre de novo" : "Sem organização"}</h1>
            </CardTitle>
            <CardDescription>
              {hasOtherOrganization
                ? "Você não faz mais parte da organização em que estava. Entre de novo para continuar na sua outra organização."
                : "Sua conta não faz parte de nenhuma organização da Guilda. Peça a um admin da sua equipe para adicionar você em Membros."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SignOutButton label={hasOtherOrganization ? "Entrar de novo" : "Sair"} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
