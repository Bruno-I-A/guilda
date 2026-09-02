import "server-only";

import { canHandleInformatives } from "@/domain/guild-permissions";
import type { InformativeDraftPayload } from "@/lib/ai/informative-schema";
import { leadsAnyClan } from "@/lib/clans/leadership";
import {
  cancelInformative,
  confirmInformative,
} from "@/lib/informatives/confirm";
import {
  buildInformativeDraft,
  draftIsBlocked,
  saveInformativeDraft,
  type InformativeActor,
} from "@/lib/informatives/draft";

import type { TelegramApi } from "./endpoint";
import { encodeDraftCallback } from "./endpoint";

/**
 * Porta de entrada do informativo pelo bot do Telegram.
 *
 * Toda a inteligência (extração, roteamento setor→clã, criação transacional)
 * mora em `src/lib/informatives/`; aqui ficam apenas a conversa e os botões.
 * O painel usa exatamente o mesmo pipeline.
 */

const NO_PERMISSION_MESSAGE =
  "Só líder de clã, admin ou owner pode registrar informativos da Guilda.";

function taxRegimeLabel(
  value: InformativeDraftPayload["company"]["taxRegime"],
): string {
  return value
    ? {
        mei: "MEI",
        simples: "Simples Nacional",
        presumido: "Lucro Presumido",
        association: "Associação",
        real: "Lucro Real",
      }[value]
    : "não identificado";
}

function closingPeriodTitle(value: string): string {
  const [, month, day] = value.split("-");
  return `${day}/${month}`;
}

export function draftPreview(payload: InformativeDraftPayload): string {
  const kindLabel = {
    new_client: "Novo cliente",
    client_change: "Alteração",
    client_closure: "Baixa de cliente",
    general_task: "Nova solicitação",
  }[payload.kind];
  const companyLabel = payload.company.legalName
    ? `${kindLabel}: ${payload.company.legalName}`
    : kindLabel;
  const lines = ["🤖 Prévia das missões", "", companyLabel];
  if (payload.sourceFormat === "informative") {
    lines.push(
      `CNPJ: ${payload.company.normalizedCnpj ?? "não informado"}`,
      `Regime: ${taxRegimeLabel(payload.company.taxRegime)}`,
      `Empresa no painel: ${payload.company.clientId ? "localizada" : payload.company.createClient ? "será criada" : "não localizada"}`,
    );
  }
  lines.push("", `${payload.tasks.length} missão(ões) proposta(s):`);
  payload.tasks.slice(0, 20).forEach((task, index) => {
    const assignmentLabel =
      task.assignmentType === "clan"
        ? `Clã ${task.clanName} · sem responsável`
        : task.assignmentType === "individual"
          ? `${task.assigneeName} · ${task.clanName}`
          : "Sem destino · decida no painel";
    lines.push(`${index + 1}. ${assignmentLabel} — ${task.title}`);
    const suggested = task.suggestions
      .map((suggestion) => suggestion.name ?? suggestion.rawName)
      .join(", ");
    if (task.assignmentType === "clan" && suggested) {
      lines.push(`   ↳ sugestão do informativo: ${suggested}`);
    }
    if (task.category === "closing_period" && task.dueDate) {
      lines.push(
        `   ↳ criará o período ${closingPeriodTitle(task.dueDate)}; ao concluir, fechará somente esse período`,
      );
    } else if (task.category === "annual_closing" && task.closingYear) {
      lines.push(`   ↳ ao concluir, fechará a campanha de ${task.closingYear}`);
    }
  });
  if (payload.tasks.length > 20) {
    lines.push(`… e mais ${payload.tasks.length - 20}.`);
  }
  const pendingCount = payload.tasks.filter(
    (task) => task.assignmentType === "pending",
  ).length;
  if (pendingCount > 0) {
    lines.push(
      "",
      `⚠️ ${pendingCount} missão(ões) sem clã e sem pessoa. Abra Informativos no painel para escolher o destino.`,
    );
  }
  if (payload.unresolvedAssignees.length) {
    lines.push(
      "",
      `⚠️ Pendências de responsável ou clã: ${payload.unresolvedAssignees.join(", ")}`,
    );
  }
  if (payload.observations.length) {
    lines.push(
      "",
      `📌 ${payload.observations.length} observação(ões) irão para o mural, não viram missão.`,
    );
  }
  if (payload.warnings.length) {
    lines.push("", ...payload.warnings.slice(0, 5).map((warning) => `⚠️ ${warning}`));
  }
  lines.push("", "Revise a prévia antes de confirmar. Nenhuma missão foi criada ainda.");
  return lines.join("\n").slice(0, 4096);
}

/** Decisão 9: líderes também registram e confirmam informativo. */
async function canHandle(actor: InformativeActor): Promise<boolean> {
  return canHandleInformatives({
    role: actor.role,
    leadsAnyClan: await leadsAnyClan(actor.orgId, actor.userId),
  });
}

export async function createInformativeDraft(
  api: TelegramApi,
  chatId: number,
  connectionId: string,
  actor: InformativeActor,
  sourceText: string,
): Promise<void> {
  if (!(await canHandle(actor))) {
    await api.sendMessage(chatId, NO_PERMISSION_MESSAGE);
    return;
  }

  await api.sendMessage(
    chatId,
    "🤖 Analisando a solicitação e conferindo responsáveis…",
  );

  const draft = await buildInformativeDraft(actor, sourceText);
  if (!draft.ok) {
    await api.sendMessage(chatId, draft.message);
    return;
  }

  const saved = await saveInformativeDraft({
    actor,
    payload: draft.payload,
    model: draft.model,
    sourceText,
    source: "telegram",
    connectionId,
  });

  const blocked = draftIsBlocked(draft.payload);
  await api.sendMessage(chatId, draftPreview(draft.payload), {
    replyMarkup: {
      inline_keyboard: [
        ...(blocked
          ? []
          : [
              [
                {
                  text: `Criar ${draft.payload.tasks.length} missões`,
                  callback_data: encodeDraftCallback("confirm", saved.id),
                },
              ],
            ]),
        [
          {
            text: "Cancelar prévia",
            callback_data: encodeDraftCallback("cancel", saved.id),
          },
        ],
      ],
    },
  });
}

export async function decideInformativeDraft(
  actor: InformativeActor,
  connectionId: string,
  draftId: string,
  decision: "confirm" | "cancel",
): Promise<{ ok: boolean; message: string }> {
  if (!(await canHandle(actor))) {
    return { ok: false, message: NO_PERMISSION_MESSAGE };
  }
  const result =
    decision === "cancel"
      ? await cancelInformative(actor, draftId, { connectionId })
      : await confirmInformative(actor, draftId, { connectionId });
  return { ok: result.ok, message: result.message };
}
