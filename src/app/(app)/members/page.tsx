import { headers } from "next/headers";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { initials, ROLE_LABELS } from "@/lib/people";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { auth } from "@/lib/auth";
import { getActiveMember, isAdminRole, requireOrgSession } from "@/lib/session";

import { InvitationActions, InviteMemberDialog, MemberActions } from "./member-actions";

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
  const pendingInvitations = org.invitations
    .filter(
      (inv) => inv.status === "pending" && new Date(inv.expiresAt).getTime() > Date.now(),
    )
    .sort((a, b) => new Date(b.expiresAt).getTime() - new Date(a.expiresAt).getTime());

  const roleRank: Record<string, number> = { owner: 0, admin: 1, member: 2 };
  const members = [...org.members].sort(
    (a, b) =>
      (roleRank[a.role] ?? 9) - (roleRank[b.role] ?? 9) ||
      a.user.name.localeCompare(b.user.name),
  );

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Membros</h1>
          <p className="text-muted-foreground">
            {members.length} {members.length === 1 ? "pessoa" : "pessoas"} em{" "}
            {org.name}
          </p>
        </div>
        {viewerIsAdmin ? <InviteMemberDialog /> : null}
      </div>

      <Card>
        <CardContent className="divide-y p-0">
          {members.map((member) => {
            const isSelf = member.userId === session.user.id;
            const canManage =
              viewerIsAdmin && !isSelf && member.role !== "owner";
            return (
              <div key={member.id} className="flex items-center gap-3 p-4">
                <Avatar className="size-9">
                  <AvatarFallback className="text-xs">
                    {initials(member.user.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {member.user.name}
                    {isSelf ? (
                      <span className="text-muted-foreground"> (você)</span>
                    ) : null}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {member.user.email}
                  </p>
                </div>
                <Badge variant={member.role === "member" ? "secondary" : "default"}>
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
              </div>
            );
          })}
        </CardContent>
      </Card>

      {viewerIsAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Convites pendentes</CardTitle>
            <CardDescription>
              Compartilhe o link do convite — quem abrir poderá criar a conta e
              entrar na organização.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-1 p-0 pb-2">
            {pendingInvitations.length === 0 ? (
              <p className="px-6 pb-4 text-sm text-muted-foreground">
                Nenhum convite pendente. Convide alguém para a guilda!
              </p>
            ) : (
              pendingInvitations.map((inv, index) => (
                <div key={inv.id}>
                  {index > 0 ? <Separator /> : null}
                  <div className="flex flex-wrap items-center gap-2 px-6 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{inv.email}</p>
                      <p className="text-xs text-muted-foreground">
                        {ROLE_LABELS[inv.role ?? "member"] ?? inv.role} · expira em{" "}
                        {new Date(inv.expiresAt).toLocaleDateString("pt-BR")}
                      </p>
                    </div>
                    <InvitationActions invitationId={inv.id} />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
