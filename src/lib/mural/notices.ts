import "server-only";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { appUrl } from "@/lib/telegram/notification-payload";
import {
  enqueueTelegramOrgBroadcast,
  notificationPayload,
} from "@/lib/telegram/notifications";

/**
 * Publicação de aviso no Mural da Guilda.
 *
 * Compartilhado pela ação do painel e pela confirmação de informativo — o
 * aviso de empresa nova nasce na MESMA transação que cria cliente e missões.
 * Idempotente para `new_client` pelo índice único parcial
 * `guild_notices_new_client_uidx`: reconfirmar o informativo não gera um
 * segundo aviso.
 */

export interface PublishGuildNoticeInput {
  orgId: string;
  authorId: string;
  kind?: "notice" | "new_client";
  title: string;
  body: string;
  clientId?: string | null;
  informativeId?: string | null;
  requiresAck?: boolean;
  pinned?: boolean;
}

export function noticeUrl(noticeId: string, baseUrl?: string): string {
  return appUrl(`/mural#aviso-${noticeId}`, baseUrl);
}

/**
 * Insere o aviso e, quando ele exige ciência, enfileira a notificação para
 * a Guilda inteira. Aviso sem `requiresAck` NÃO notifica — senão o mural
 * vira spam e as pessoas param de ler o que importa.
 *
 * Devolve `null` quando o aviso já existia (conflito do índice parcial).
 */
export async function publishGuildNotice(
  tx: OrgTx,
  input: PublishGuildNoticeInput,
): Promise<{ id: string } | null> {
  const [created] = await tx
    .insert(schema.guildNotices)
    .values({
      orgId: input.orgId,
      authorId: input.authorId,
      kind: input.kind ?? "notice",
      title: input.title.slice(0, 160),
      body: input.body,
      clientId: input.clientId ?? null,
      informativeId: input.informativeId ?? null,
      requiresAck: input.requiresAck ?? false,
      pinned: input.pinned ?? false,
    })
    .onConflictDoNothing()
    .returning({ id: schema.guildNotices.id });
  if (!created) return null;

  if (input.requiresAck) {
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL;
    await enqueueTelegramOrgBroadcast(tx, {
      orgId: input.orgId,
      eventType: "guild_notice_published",
      dedupeKey: `guild-notice:${created.id}`,
      payload: notificationPayload(
        "mural",
        `📜 Aviso da Guilda\n\n${input.title}\n\nConfirme a leitura no mural.`,
        [[{ text: "Abrir o mural", url: noticeUrl(created.id, baseUrl) }]],
      ),
    });
  }

  return created;
}

/** Corpo do aviso de empresa nova: dados cadastrais + o que não virou missão. */
export function newClientNoticeBody(input: {
  legalName: string;
  cnpj: string | null;
  taxRegime: string | null;
  city: string | null;
  contact: string | null;
  summary: string | null;
  observations: readonly string[];
  taskCount: number;
}): string {
  const lines: string[] = [];
  if (input.summary) lines.push(input.summary, "");
  lines.push("Dados cadastrais");
  lines.push(`Razão social: ${input.legalName}`);
  if (input.cnpj) lines.push(`CNPJ: ${input.cnpj}`);
  if (input.taxRegime) lines.push(`Enquadramento: ${input.taxRegime}`);
  if (input.city) lines.push(`Cidade: ${input.city}`);
  if (input.contact) lines.push(`Contato: ${input.contact}`);
  if (input.observations.length > 0) {
    lines.push("", "Observações e combinados");
    for (const observation of input.observations) {
      lines.push(`• ${observation}`);
    }
  }
  lines.push(
    "",
    input.taskCount === 1
      ? "1 missão foi criada a partir deste informativo."
      : `${input.taskCount} missões foram criadas a partir deste informativo.`,
  );
  return lines.join("\n");
}
