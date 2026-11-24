import { calculateTaskXp } from "@/domain/xp";
import type { InformativeDraftPayload } from "@/lib/ai/informative-schema";

/**
 * Missão avulsa pedida por mensagem no WhatsApp por quem não lidera clã
 * (2026-11-24, pedido do Bruno: "todos devem poder criar missões"). A leitura
 * é a mesma IA dos Informativos; daqui sai só o que o formulário de missão
 * permite a qualquer integrante: missão para uma pessoa da Guilda ou para um
 * clã, com empresa já cadastrada se houver. Nada de criar empresa, Fluxo,
 * fechamento ou aviso no Mural: isso continua sendo Informativo, de líder,
 * admin e dono.
 */

export const MESSAGE_DRAFT_MAX_MISSIONS = 10;

export type MessageMission = Readonly<{
  title: string;
  description: string | null;
  priority: number;
  difficulty: number;
  /** AAAA-MM-DD, como o formulário. */
  dueDate: string | null;
  assignment:
    | Readonly<{ type: "individual"; userId: string; name: string }>
    | Readonly<{ type: "clan"; clanId: string; name: string }>;
}>;

export type MessageMissionPlan = Readonly<{
  version: 1;
  clientId: string | null;
  companyName: string | null;
  missions: readonly MessageMission[];
}>;

export type PlanResult =
  | Readonly<{ ok: true; plan: MessageMissionPlan; notes: readonly string[] }>
  | Readonly<{ ok: false; message: string }>;

/**
 * O pedido pelo WhatsApp é missão avulsa, para todos (2026-11-24: o Bruno pediu
 * "comprar um chopp" para o Rafa e saiu missão de Informativo com aviso no Mural
 * para a Guilda inteira). Só vai pelo Informativo, e só para líder, admin e dono,
 * o que precisa dele: empresa nova, alteração ou baixa, aviso para o Mural,
 * distribuição de lucros e fechamento.
 */
export function needsInformative(payload: InformativeDraftPayload): boolean {
  return payload.kind !== "general_task"
    || payload.freeNotice !== null
    || payload.commitments.length > 0
    || payload.company.createClient
    || payload.tasks.some((task) => task.category !== "general");
}

export function planFromInformative(payload: InformativeDraftPayload): PlanResult {
  if (payload.unresolvedAssignees.length > 0) {
    return {
      ok: false,
      message: `Não achei na Guilda: ${payload.unresolvedAssignees.join(", ")}. Escreva o nome como aparece na Guilda e mande de novo.`,
    };
  }
  const pending = payload.tasks.filter((task) => task.assignmentType === "pending");
  if (pending.length > 0) {
    return {
      ok: false,
      message: `Não entendi para quem é: ${pending.map((task) => task.title).join("; ")}. Diga a pessoa ou o clã e mande de novo.`,
    };
  }
  if (payload.tasks.length === 0) {
    return { ok: false, message: "Não achei uma tarefa nessa mensagem. Diga o que precisa ser feito e para quem." };
  }
  if (payload.tasks.length > MESSAGE_DRAFT_MAX_MISSIONS) {
    return { ok: false, message: `Por mensagem, até ${MESSAGE_DRAFT_MAX_MISSIONS} missões por vez. Divida o pedido em partes.` };
  }
  const missions: MessageMission[] = [];
  for (const task of payload.tasks) {
    if (task.assignmentType === "pending") continue;
    missions.push({
      title: task.title.slice(0, 200),
      description: task.description,
      priority: task.priority,
      difficulty: task.difficulty,
      dueDate: task.dueDate,
      assignment: task.assignmentType === "individual"
        ? { type: "individual", userId: task.assigneeId, name: task.assigneeName }
        : { type: "clan", clanId: task.clanId, name: task.clanName },
    });
  }
  const companyName = payload.company.legalName;
  const notes = payload.company.createClient && companyName
    ? [`${companyName} não está cadastrada na Guilda: a missão sai sem empresa.`]
    : [];
  return {
    ok: true,
    plan: { version: 1, clientId: payload.company.clientId, companyName: payload.company.clientId ? companyName : null, missions },
    notes,
  };
}

function dueLabel(value: string | null): string {
  if (!value) return "sem prazo";
  const [year, month, day] = value.split("-");
  return `prazo ${day}/${month}/${year}`;
}

export function messageDraftPreview(plan: MessageMissionPlan, notes: readonly string[] = []): string {
  const lines = [plan.missions.length === 1 ? "Prévia da missão" : `Prévia das ${plan.missions.length} missões`, ""];
  if (plan.companyName) lines.push(`Empresa: ${plan.companyName}`, "");
  plan.missions.forEach((mission, index) => {
    const who = mission.assignment.type === "individual" ? mission.assignment.name : `Clã ${mission.assignment.name} (sem responsável)`;
    lines.push(`${index + 1}. ${who}: ${mission.title}`);
    lines.push(`   ${dueLabel(mission.dueDate)} · ${calculateTaskXp(mission.difficulty, mission.priority)} XP`);
  });
  if (notes.length) lines.push("", ...notes);
  lines.push("", "Nada foi criado ainda.");
  return lines.join("\n").slice(0, 4096);
}

/** Confere o payload guardado antes de criar: só o que o plano produz é aceito. */
export function parseMessageMissionPlan(value: unknown): MessageMissionPlan | null {
  if (!value || typeof value !== "object") return null;
  const plan = value as Record<string, unknown>;
  if (plan.version !== 1 || !Array.isArray(plan.missions) || plan.missions.length === 0 || plan.missions.length > MESSAGE_DRAFT_MAX_MISSIONS) return null;
  for (const item of plan.missions as Record<string, unknown>[]) {
    const assignment = item?.assignment as Record<string, unknown> | undefined;
    if (typeof item?.title !== "string" || !item.title || typeof item.priority !== "number" || typeof item.difficulty !== "number") return null;
    if (item.dueDate !== null && (typeof item.dueDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(item.dueDate))) return null;
    if (!assignment || (assignment.type === "individual" ? typeof assignment.userId !== "string" : assignment.type === "clan" ? typeof assignment.clanId !== "string" : true)) return null;
  }
  return value as MessageMissionPlan;
}
