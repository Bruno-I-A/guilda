import { and, eq, inArray } from "drizzle-orm";
import { KeyRound } from "lucide-react";
import { headers } from "next/headers";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { db } from "@/db";
import * as schema from "@/db/schema";
import { authorizePasswordReset } from "@/domain/password-reset";
import type { OrgRole } from "@/domain/task-state";
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

  // Quem ainda não trocou a senha temporária (cadastro novo ou senha
  // redefinida). Só o admin vê: é ele quem repassa a senha e acompanha.
  const pendingPassword = new Set<string>();
  if (viewerIsAdmin && members.length > 0) {
    const rows = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(
        and(
          inArray(
            schema.user.id,
            members.map((member) => member.userId),
          ),
          eq(schema.user.mustChangePassword, true),
        ),
      );
    for (const row of rows) pendingPassword.add(row.id);
  }

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
                {pendingPassword.has(member.userId) ? (
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-warning">
                    <KeyRound className="size-3" aria-hidden />
                    Ainda não trocou a senha temporária
                  </p>
                ) : null}
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
                  canResetPassword={
                    authorizePasswordReset({
                      actorRole: viewer.role as OrgRole,
                      targetRole: member.role as OrgRole,
                      isSelf,
                      // Conferido no servidor ao redefinir; aqui só decide o menu.
                      targetInOtherOrganization: false,
                    }).allowed
                  }
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
