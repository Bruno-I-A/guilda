import { APIError, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import * as schema from "@/db/schema";
import {
  bootstrapOrganizationClans,
  cleanupRemovedOrganizationMemberClans,
  ensureOrganizationClans,
  MemberRemovalBlockedError,
  prepareOrganizationMemberRemoval,
} from "@/lib/clans/bootstrap";
import { organizationRoleIncludesOwner } from "@/lib/clans/rules";

export const auth = betterAuth({
  appName: "Guilda",
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  user: {
    additionalFields: {
      mustChangePassword: {
        type: "boolean",
        defaultValue: false,
        input: true,
      },
    },
  },
  // Rate limiting nas rotas de auth (regra inegociável nº 7).
  // Ativo em produção; janela/limite mais duros para login, registro e convite.
  rateLimit: {
    enabled: process.env.NODE_ENV === "production",
    window: 60,
    max: 100,
    storage: "database",
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 60, max: 3 },
      "/organization/invite-member": { window: 60, max: 10 },
      "/organization/accept-invitation": { window: 60, max: 10 },
    },
  },
  databaseHooks: {
    session: {
      create: {
        // Ao criar a sessão (login), ativa a primeira organização do
        // usuário para que session.activeOrganizationId nunca fique nulo
        // para quem já é membro de alguma org.
        before: async (session) => {
          const memberships = await db.query.member.findMany({
            where: eq(schema.member.userId, session.userId),
            orderBy: (member, { asc }) => [asc(member.createdAt)],
          });
          for (const membership of memberships) {
            if (organizationRoleIncludesOwner(membership.role)) {
              await ensureOrganizationClans(
                membership.organizationId,
                membership.userId,
              );
            }
          }
          return {
            data: {
              ...session,
              activeOrganizationId: memberships[0]?.organizationId ?? null,
            },
          };
        },
      },
    },
  },
  plugins: [
    organization({
      // Convites são compartilhados por LINK (sem e-mail na v1) —
      // a página de membros exibe a URL /invite/<id> para copiar.
      async sendInvitationEmail() {
        // no-op: sem infraestrutura de e-mail na v1
      },
      organizationHooks: {
        async afterCreateOrganization({ organization, user }) {
          await bootstrapOrganizationClans(organization.id, user.id);
        },
        async beforeDeleteOrganization({ organization }) {
          // O adapter remove members antes da organization. Antecipar o DELETE
          // aqui faz a flag/CBs da migration 0022 rodarem no mesmo statement;
          // a remoção subsequente do adapter se torna idempotentemente vazia.
          await db
            .delete(schema.organization)
            .where(eq(schema.organization.id, organization.id));
        },
        async beforeRemoveMember({ member }) {
          try {
            await prepareOrganizationMemberRemoval(
              member.organizationId,
              member.userId,
            );
          } catch (error) {
            if (error instanceof MemberRemovalBlockedError) {
              throw new APIError("BAD_REQUEST", { message: error.message });
            }
            throw error;
          }
        },
        async afterRemoveMember({ member }) {
          await cleanupRemovedOrganizationMemberClans(
            member.organizationId,
            member.userId,
          );
        },
      },
    }),
    // Precisa ser o ÚLTIMO plugin: permite que Server Actions gravem cookies.
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
