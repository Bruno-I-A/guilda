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
