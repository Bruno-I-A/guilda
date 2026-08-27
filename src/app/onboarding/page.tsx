import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { GuildCrest } from "@/components/guild-crest";
import { requireSession } from "@/lib/session";

import { CreateOrgForm } from "./create-org-form";

export const metadata: Metadata = { title: "Criar organização" };

export default async function OnboardingPage() {
  const session = await requireSession();
  if (session.session.activeOrganizationId) {
    redirect("/dashboard");
  }
  return (
    // Alinhado ao (auth)/layout: as duas telas são vizinhas no funil de
    // entrada e antes não combinavam (crest 14 vs 16, texto lg vs 2xl, e um
    // fundo `bg-muted/40` que só existia aqui).
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 p-4">
      <div className="flex flex-col items-center gap-3 font-heading text-2xl font-semibold tracking-widest">
        <GuildCrest className="size-16" />
        Guilda
      </div>
      <div className="w-full max-w-sm">
        <CreateOrgForm userName={session.user.name} />
      </div>
    </div>
  );
}
