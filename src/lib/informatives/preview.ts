import type { InformativeDraftPayload } from "@/lib/ai/informative-schema";

/**
 * Prévia do Informativo em texto, para quem pede missão por mensagem (veio do
 * bot do Telegram; desde 2026-11-24 sai pelo WhatsApp). Nenhuma missão nasce
 * antes da confirmação.
 */

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
  const lines = ["Prévia das missões", "", companyLabel];
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
      `Atenção: ${pendingCount} missão(ões) sem clã e sem pessoa. Abra Informativos no painel para escolher o destino.`,
    );
  }
  if (payload.unresolvedAssignees.length) {
    lines.push(
      "",
      `Atenção: pendências de responsável ou clã: ${payload.unresolvedAssignees.join(", ")}`,
    );
  }
  if (payload.observations.length) {
    lines.push(
      "",
      `${payload.observations.length} observação(ões) irão para o mural, não viram missão.`,
    );
  }
  if (payload.warnings.length) {
    lines.push("", ...payload.warnings.slice(0, 5).map((warning) => `Atenção: ${warning}`));
  }
  lines.push("", "Revise a prévia antes de confirmar. Nenhuma missão foi criada ainda.");
  return lines.join("\n").slice(0, 4096);
}
