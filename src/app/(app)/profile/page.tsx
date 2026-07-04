import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { initials, ROLE_LABELS } from "@/lib/people";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getActiveMember, requireOrgSession } from "@/lib/session";

export const metadata: Metadata = { title: "Perfil" };

export default async function ProfilePage() {
  const session = await requireOrgSession();
  const member = await getActiveMember();
  if (!member) {
    redirect("/onboarding");
  }

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Perfil</h1>

      <Card>
        <CardContent className="flex items-center gap-4">
          <Avatar className="size-14">
            <AvatarFallback className="text-lg">
              {initials(session.user.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold">{session.user.name}</p>
            <p className="truncate text-sm text-muted-foreground">
              {session.user.email}
            </p>
            <Badge variant="secondary" className="mt-1">
              {ROLE_LABELS[member.role] ?? member.role}
            </Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
