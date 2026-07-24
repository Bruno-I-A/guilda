import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import * as schema from "@/db/schema";

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
          const membership = await db.query.member.findFirst({
            where: eq(schema.member.userId, session.userId),
          });
          return {
            data: {
              ...session,
              activeOrganizationId: membership?.organizationId ?? null,
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
    }),
    // Precisa ser o ÚLTIMO plugin: permite que Server Actions gravem cookies.
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
