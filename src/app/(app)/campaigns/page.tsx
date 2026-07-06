import { Flag } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { requireOrgSession } from "@/lib/session";

import { CampaignTabs } from "./campaign-tabs";

export const metadata: Metadata = { title: "Campanhas" };

export default async function CampaignsPage() {
  await requireOrgSession();

  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-wide">Campanhas</h1>
        <p className="text-muted-foreground">
          Processos recorrentes sobre a carteira de clientes — fechamentos,
          obrigações e afins.
        </p>
      </div>

      <CampaignTabs active="campaigns" />

      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-12 text-center">
        <Flag className="size-8 text-muted-foreground" aria-hidden />
        <p className="font-medium">A criação de campanhas chega em breve</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Enquanto isso, prepare os{" "}
          <Link
            href="/campaigns/templates"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            templates de checklist
          </Link>{" "}
          por regime tributário — cada campanha vai materializar as missões a
          partir deles.
        </p>
      </div>
    </div>
  );
}
