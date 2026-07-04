import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Swords } from "lucide-react";

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
      <div className="flex items-center gap-2 font-semibold text-lg">
        <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Swords className="size-4" aria-hidden />
        </span>
        Guilda
      </div>
      <div className="w-full max-w-sm">
        <CreateOrgForm userName={session.user.name} />
      </div>
    </div>
  );
}
