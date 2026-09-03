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
    // Autocadastro FECHADO. Sem isto, /api/auth/sign-up/email aceita qualquer
    // pessoa da internet, que sai com conta e organização próprias dentro da
    // instância. Tirar o link da tela de login escondia a porta; não a fechava.
    // Conta nasce pela tela de Membros ou pelo script de bootstrap — os dois
    // passam por src/lib/auth-admin.ts, que usa o internalAdapter e não este
    // endpoint. Mexer aqui reabre o buraco.
    disableSignUp: true,
  },
  user: {
    additionalFields: {
      mustChangePassword: {
        type: "boolean",
        defaultValue: false,
        // `input: false` é a trava: com `true`, /update-user aceitava o campo
        // no corpo e qualquer pessoa desligava a rotação obrigatória sem
        // nunca trocar a senha temporária. Quem desliga agora é o servidor,
        // como consequência da troca (src/app/(auth)/change-password/actions.ts).
        // A criação do membro continua funcionando: `createMemberWithTempPassword`
        // usa internalAdapter.createUser, que não passa por parseUserInput.
        input: false,
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
      // Inerte enquanto disableSignUp estiver ligado; fica como rede de
      // segurança para o dia em que alguém reabrir o cadastro sem pensar nisto.
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
