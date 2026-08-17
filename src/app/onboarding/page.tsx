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
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted/40 p-4">
      <div className="flex flex-col items-center gap-2 font-heading text-lg font-semibold tracking-widest">
        <GuildCrest className="size-14" />
        Guilda
      </div>
      <div className="w-full max-w-sm">
        <CreateOrgForm userName={session.user.name} />
      </div>
    </div>
  );
}
