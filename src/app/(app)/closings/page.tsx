import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { CONTABILIDADE_CLAN_SLUG } from "@/lib/clans/rules";
import { requireOrgSession } from "@/lib/session";

/**
 * Fechamentos mudou para dentro do clã Contabilidade (decisão de 2026-08-18).
 *
 * A rota sobrevive como redirecionamento porque há links vivos apontando para
 * ela — o botão "Abrir fechamentos" das notificações do Telegram, entre
 * outros. Quem não é da Contabilidade cai no guarda de acesso do clã, que é
 * exatamente o efeito pretendido.
 */
export default async function ClosingsRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireOrgSession();
  const params = await searchParams;

  const [clan] = await withOrgTx(session.orgId, (tx) =>
    tx
      .select({ id: schema.clans.id })
      .from(schema.clans)
      .where(
        and(
          eq(schema.clans.orgId, session.orgId),
          eq(schema.clans.slug, CONTABILIDADE_CLAN_SLUG),
        ),
      )
      .limit(1),
  );

  // Guilda sem o clã Contabilidade preparado: não há para onde levar.
  if (!clan) redirect("/clans");

  const query = new URLSearchParams({ tab: "closings" });
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && value) query.set(key, value);
  }
  redirect(`/clans/${clan.id}?${query}`);
}
