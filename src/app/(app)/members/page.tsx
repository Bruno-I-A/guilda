import { headers } from "next/headers";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { initials, ROLE_LABELS } from "@/lib/people";
import { PageHeader } from "@/components/page-header";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { auth } from "@/lib/auth";
import { getActiveMember, isAdminRole, requireOrgSession } from "@/lib/session";

import { InviteMemberDialog, MemberActions } from "./member-actions";

export const metadata: Metadata = { title: "Membros" };

export default async function MembersPage() {
  const session = await requireOrgSession();
  const viewer = await getActiveMember();
  if (!viewer) {
    redirect("/onboarding");
  }

  const org = await auth.api.getFullOrganization({ headers: await headers() });
  if (!org) {
    redirect("/onboarding");
  }

  const viewerIsAdmin = isAdminRole(viewer.role);

  const roleRank: Record<string, number> = { owner: 0, admin: 1, member: 2 };
  const members = [...org.members].sort(
    (a, b) =>
      (roleRank[a.role] ?? 9) - (roleRank[b.role] ?? 9) ||
      a.user.name.localeCompare(b.user.name),
  );

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Membros"
        description={
          <>
            <span className="font-mono tabular-nums">{members.length}</span>{" "}
            {members.length === 1 ? "pessoa" : "pessoas"} em {org.name}
          </>
        }
        action={viewerIsAdmin ? <InviteMemberDialog /> : undefined}
      />

      {/*
        Era um <Card> de estoque com `divide-y` — a única lista do app que
        ainda usava a superfície genérica. Agora cada pessoa é uma placa
        chanfrada, igual a /clients e aos templates. Sem `texture-iron`:
        textura é de tela de vitrine, e esta é lista de uso diário.
      */}
      <ul className="grid gap-1.5">
        {members.map((member) => {
          const isSelf = member.userId === session.user.id;
          const canManage = viewerIsAdmin && !isSelf && member.role !== "owner";
          return (
            <li
              key={member.id}
              className="panel-cut panel-cut-sm flex items-center gap-3 px-4 py-2.5"
            >
              <Avatar className="size-9">
                <AvatarFallback className="text-xs">
                  {initials(member.user.name)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium leading-snug">
                  {member.user.name}
                  {isSelf ? (
                    <span className="text-muted-foreground"> (você)</span>
                  ) : null}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {member.user.email}
                </p>
              </div>
              <Badge
                variant={member.role === "member" ? "secondary" : "default"}
                className="shrink-0"
              >
                {ROLE_LABELS[member.role] ?? member.role}
              </Badge>
              {canManage ? (
                <MemberActions
                  memberId={member.id}
                  memberName={member.user.name}
                  role={member.role}
                  organizationId={org.id}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
