import "server-only";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import type { FlowActivity, FlowQsaMember } from "@/domain/company-flow";
import { TAX_REGIME_LABELS, type TaxRegime } from "@/lib/clients-ui";
import { formatBRLCurrency } from "@/lib/currency";
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
 * Insere o aviso e, quando ele exige ciência, enfileira uma única notificação
 * para cada integrante da Guilda. As missões de um Informativo não disparam
 * notificações individuais de criação; este aviso representa o pacote todo.
 * Aviso sem `requiresAck` NÃO notifica — senão o mural vira spam.
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

/**
 * Corpo do aviso de empresa nova: dados cadastrais + o que a consulta de
 * CNPJ trouxe (atividades, data de abertura) + o que não virou missão.
 *
 * O combinado do Fiscal (`fiscalPortfolioNote`) também é vida dupla aqui: já
 * fica gravado em `fiscal_portfolios.notes` quando o líder confirma a
 * carteira, mas o aviso é visto pela Guilda inteira ANTES disso acontecer —
 * sem repetir aqui, a informação ficaria invisível até alguém abrir a aba
 * Carteira.
 */
export function newClientNoticeBody(input: {
  legalName: string;
  cnpj: string | null;
  taxRegime: string | null;
  city: string | null;
  contact: string | null;
  summary: string | null;
  cnaeDescription: string | null;
  secondaryCnaes: readonly { code: string; description: string }[] | null;
  openedAt: string | null;
  fiscalPortfolioNote: string | null;
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
  if (input.openedAt) {
    lines.push(
      `Abertura: ${new Date(`${input.openedAt}T12:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC" })}`,
    );
  }
  if (input.cnaeDescription) {
    const secondary =
      input.secondaryCnaes && input.secondaryCnaes.length > 0
        ? ` (e mais ${input.secondaryCnaes.length} atividade${input.secondaryCnaes.length === 1 ? "" : "s"} secundária${input.secondaryCnaes.length === 1 ? "" : "s"})`
        : "";
    lines.push("", `Atividade principal: ${input.cnaeDescription}${secondary}`);
  }
  if (input.fiscalPortfolioNote) {
    lines.push("", "Combinado do Fiscal", input.fiscalPortfolioNote);
  }
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

/**
 * O Fluxo é a fonte oficial dos dados societários. O aviso aproveita esse
 * registro diretamente, em vez de depender do texto reduzido enviado à IA.
 * Credenciais Gov.br nunca entram aqui.
 */
export function companyFlowNoticeBody(input: {
  legalName: string;
  cnpj: string | null;
  activities: readonly FlowActivity[];
  taxRegime: TaxRegime | null;
  iptu: string | null;
  socialCapital: string | null;
  roomSize: string | null;
  address: string | null;
  clientResponsible: string | null;
  qsa: readonly FlowQsaMember[];
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  requestDetails: string | null;
  processingNotes: string | null;
  taskCount: number;
}): string {
  const lines = ["Dados da abertura societária", `Razão social: ${input.legalName}`];
  if (input.cnpj) lines.push(`CNPJ: ${input.cnpj}`);
  if (input.activities.length > 0) {
    lines.push(`Atividades: ${input.activities.map((activity) => activity.description).join("; ")}`);
  }
  if (input.taxRegime) lines.push(`Regime tributário: ${TAX_REGIME_LABELS[input.taxRegime]}`);
  if (input.iptu) lines.push(`IPTU: ${input.iptu}`);
  if (input.socialCapital) lines.push(`Capital social: ${formatBRLCurrency(input.socialCapital)}`);
  if (input.roomSize) lines.push(`Tamanho da sala: ${input.roomSize}`);
  if (input.address) lines.push(`Endereço: ${input.address}`);
  if (input.clientResponsible) lines.push(`Responsável: ${input.clientResponsible}`);
  if (input.qsa.length > 0) {
    lines.push("", "QSA");
    for (const member of input.qsa) {
      lines.push(`• ${[member.name, member.document && `CPF/CNPJ: ${member.document}`, member.qualification, member.participation].filter(Boolean).join(" — ")}`);
    }
  }
  const contact = [input.contactName, input.contactPhone, input.contactEmail].filter(Boolean).join(" · ");
  if (contact) lines.push(`Contato: ${contact}`);
  if (input.requestDetails) lines.push("", "Solicitação", input.requestDetails);
  if (input.processingNotes) lines.push("", "Retorno do Societário", input.processingNotes);
  lines.push(
    "",
    input.taskCount === 1
      ? "1 missão foi criada a partir deste Fluxo."
      : `${input.taskCount} missões foram criadas a partir deste Fluxo.`,
  );
  return lines.join("\n");
}
