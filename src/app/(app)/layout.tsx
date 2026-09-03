import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { countPendingNoticeAcks } from "@/lib/mural/queries";
import { countMissionsAwaitingUser } from "@/lib/tasks/queries";
import { getActiveMember, requireOrgSession } from "@/lib/session";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await requireOrgSession();

  const [org, member, pendingNotices, pendingMissions] = await Promise.all([
    db.query.organization.findFirst({
      where: eq(schema.organization.id, session.orgId),
    }),
    getActiveMember(),
    countPendingNoticeAcks(session.orgId, session.user.id),
    countMissionsAwaitingUser(session.orgId, session.user.id),
  ]);

  // Sessão aponta para org inexistente ou usuário não é mais membro:
  // volta ao onboarding em vez de quebrar.
  if (!org || !member) {
    redirect("/onboarding");
  }

  return (
    <AppShell
      orgName={org.name}
      user={{ name: session.user.name, email: session.user.email }}
      role={member.role}
      pendingNotices={pendingNotices}
      pendingMissions={pendingMissions}
    >
      {children}
    </AppShell>
  );
}
