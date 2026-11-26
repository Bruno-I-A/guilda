import { shortRef } from "./links";

/**
 * Aviso da Guilda pelo WhatsApp (2026-11-24, substitui o Telegram).
 *
 * O produtor descreve o aviso em dados; daqui saem as três formas de enviá-lo:
 * texto (janela de 24 h aberta), botões de resposta (janela aberta e há ação)
 * e parâmetros de modelo Utility (janela fechada). Funções puras e testadas.
 */

export const NOTICE_PREFERENCES = [
  "tasks",
  "approvals",
  "deadlines",
  "xp",
  "closings",
  "campaigns",
  "mural",
  "daily_summary",
] as const;
export type NoticePreference = (typeof NOTICE_PREFERENCES)[number];

/** Botão de resposta do WhatsApp: id até 256, título até 20 caracteres. */
export type NoticeButton = Readonly<{ id: string; title: string }>;

export type Notice =
  | Readonly<{
      family: "new_mission";
      heading: string;
      title: string;
      /** Clã ou empresa, para o modelo: "Revisar folha (clã Fiscal)". */
      context?: string;
      /** Várias missões de um Informativo: a lista vai só no texto. */
      items?: readonly string[];
      due: string;
      xp: number;
      path: string;
      button?: NoticeButton;
    }>
  | Readonly<{
      family: "approval";
      who: string;
      title: string;
      xp: number;
      note?: string;
      path: string;
      taskId: string;
    }>
  | Readonly<{
      family: "mission_update";
      title: string;
      update: string;
      detail?: string;
      path: string;
      button?: NoticeButton;
    }>
  | Readonly<{
      family: "deadline";
      title: string;
      overdue: boolean;
      due: string;
      xp: number;
      path: string;
    }>
  | Readonly<{
      family: "daily_summary";
      open: number;
      available: number;
      xp: number;
      path: string;
    }>
  | Readonly<{
      family: "general";
      heading: string;
      summary: string;
      detail?: string;
      path: string;
    }>;

export type NoticeFamily = Notice["family"];

export type MemberNoticePayload = Readonly<{
  version: 3;
  kind: "notice";
  preference: NoticePreference;
  notice: Notice;
}>;

/** Resposta a uma mensagem do integrante: sempre dentro da janela que ela abriu. */
export type MemberReplyPayload = Readonly<{
  version: 3;
  kind: "reply";
  text: string;
  buttons?: readonly NoticeButton[];
}>;

export type MemberV3Payload = MemberNoticePayload | MemberReplyPayload;

export type NoticeTemplateKey =
  | "nova_missao"
  | "aprovacao"
  | "missao_atualizada"
  | "prazo"
  | "resumo"
  | "aviso";

export type MemberTemplateKey = NoticeTemplateKey | "novo_cliente";

export type NoticeTemplateDefinition = Readonly<{
  name: string;
  /** Corpo do modelo. Nunca começa nem termina em variável: a Meta recusa. */
  body: string;
  examples: readonly string[];
  /** Resposta rápida antes do botão de link (só o Aprovar). */
  quickReply?: string;
}>;

/**
 * Os modelos da Guilda. Todos têm o botão "Abrir na Guilda" com uma referência
 * curta como variável (`https://<app>/w/{{1}}`, ver `shortRef`), para o mesmo
 * modelo servir missão, lista, Mural e fechamentos.
 */
export const NOTICE_TEMPLATES: Record<NoticeTemplateKey, NoticeTemplateDefinition> = {
  nova_missao: {
    name: "guilda_nova_missao",
    body: "Nova missão na Guilda: {{1}}. Prazo: {{2}}. Recompensa: {{3}} XP. Abra pelo botão abaixo para ver os detalhes.",
    examples: ["Conferir a folha de outubro (clã RH)", "25/11/2026", "50"],
  },
  aprovacao: {
    // O v1 começava por {{1}} e foi recusado pela Meta. Nome novo permite
    // enviar o texto corrigido sem ficar preso ao modelo rejeitado existente.
    name: "guilda_aprovacao_v2",
    body: "Atenção: {{1}} entregou a missão {{2}} para a sua aprovação. Recompensa: {{3}} XP. Aprove por aqui ou abra a missão pelo botão abaixo.",
    examples: ["Ana Souza", "Conferir a folha de outubro", "50"],
    quickReply: "Aprovar",
  },
  missao_atualizada: {
    name: "guilda_missao_atualizada",
    body: "Atualização da missão {{1}}: {{2}}. Abra pelo botão abaixo para ver o histórico.",
    examples: ["Conferir a folha de outubro", "Ana Souza iniciou a missão"],
  },
  prazo: {
    name: "guilda_prazo",
    body: "Lembrete da Guilda: a missão {{1}} {{2}}. Abra pelo botão abaixo para ver os detalhes.",
    examples: ["Conferir a folha de outubro", "vence hoje (25/11/2026)"],
  },
  resumo: {
    name: "guilda_resumo",
    body: "Seu resumo da Guilda: {{1}} missões em aberto com você, {{2}} disponíveis nos seus clãs e {{3}} XP no total. Abra pelo botão abaixo para ver a lista.",
    examples: ["4", "2", "1250"],
  },
  aviso: {
    name: "guilda_aviso",
    body: "Aviso da Guilda: {{1}}. Abra pelo botão abaixo para ver os detalhes.",
    examples: ["Fechamento concluído, ACME Comércio Ltda, Balanço 2025"],
  },
};

export const TEMPLATE_URL_EXAMPLE = "t-00000000-0000-4000-8000-000000000000";

export function taskButton(action: "start" | "resume" | "approve", taskId: string): NoticeButton {
  const transition = action === "approve" ? "approve" : "start";
  const title = action === "approve" ? "Aprovar" : action === "resume" ? "Retomar" : "Iniciar missão";
  return { id: `task:${transition}:${taskId}`, title };
}

/**
 * Variável de modelo: a Meta recusa quebra de linha, tabulação e mais de quatro
 * espaços seguidos, e variável vazia. Curta para o corpo não passar de 1024.
 */
export function templateParam(value: string | number, max = 120): string {
  const text = String(value).replace(/\s+/g, " ").trim();
  if (!text) return "-";
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function lines(...parts: (string | false | null | undefined)[]): string {
  return parts.filter((part): part is string => typeof part === "string").join("\n");
}

/**
 * Texto do aviso dentro da janela. Sem link (2026-11-24, pedido do Bruno: "não
 * precisa enviar"): a ação vem nos botões, e o modelo de fora da janela leva o
 * botão "Abrir na Guilda".
 */
export function noticeText(notice: Notice): string {
  switch (notice.family) {
    case "new_mission":
      return lines(notice.heading, "", notice.title, notice.context && `Onde: ${notice.context}`, ...(notice.items ?? []).map((item) => `• ${item}`), `Prazo: ${notice.due}`, `Recompensa: ${notice.xp} XP`);
    case "approval":
      return lines("Entrega para a sua aprovação", "", notice.title, `Quem entregou: ${notice.who}`, `Recompensa: ${notice.xp} XP`, notice.note && "", notice.note && `Retorno: ${notice.note}`);
    case "mission_update":
      return lines(notice.update, "", notice.title, notice.detail);
    case "deadline":
      return lines(notice.overdue ? "Missão atrasada" : "Missão vence hoje", "", notice.title, `Prazo: ${notice.due}`, `Recompensa: ${notice.xp} XP`);
    case "daily_summary":
      return lines("Resumo da Guilda", "", `${notice.open} missão(ões) em aberto com você`, `${notice.available} disponível(is) nos seus clãs`, `${notice.xp} XP no total`);
    case "general":
      return lines(notice.heading, "", notice.summary, notice.detail);
  }
}

/** Botões de resposta do aviso dentro da janela (máximo 3). */
export function noticeButtons(notice: Notice): NoticeButton[] {
  if (notice.family === "approval") return [taskButton("approve", notice.taskId)];
  if ((notice.family === "new_mission" || notice.family === "mission_update") && notice.button) return [notice.button];
  return [];
}

export type NoticeTemplateCall = Readonly<{
  key: NoticeTemplateKey;
  bodyParams: string[];
  /** Variável do botão de link: referência curta, nunca o caminho cru. */
  urlRef: string;
  quickReplyPayload?: string;
}>;

/** Parâmetros do modelo Utility do aviso, para quando a janela está fechada. */
export function noticeTemplate(notice: Notice): NoticeTemplateCall {
  const urlRef = shortRef(notice.path);
  switch (notice.family) {
    case "new_mission":
      return {
        key: "nova_missao",
        bodyParams: [templateParam(notice.context ? `${notice.title} (${notice.context})` : notice.title, 160), templateParam(notice.due, 40), templateParam(notice.xp, 10)],
        urlRef,
      };
    case "approval":
      return {
        key: "aprovacao",
        bodyParams: [templateParam(notice.who, 80), templateParam(notice.title, 160), templateParam(notice.xp, 10)],
        urlRef,
        quickReplyPayload: taskButton("approve", notice.taskId).id,
      };
    case "mission_update":
      return {
        key: "missao_atualizada",
        bodyParams: [templateParam(notice.title, 160), templateParam(notice.detail ? `${notice.update}. ${notice.detail}` : notice.update, 300)],
        urlRef,
      };
    case "deadline":
      return {
        key: "prazo",
        bodyParams: [templateParam(notice.title, 160), templateParam(notice.overdue ? `está atrasada (prazo ${notice.due})` : `vence hoje (${notice.due})`, 60)],
        urlRef,
      };
    case "daily_summary":
      return {
        key: "resumo",
        bodyParams: [templateParam(notice.open, 10), templateParam(notice.available, 10), templateParam(notice.xp, 12)],
        urlRef,
      };
    case "general":
      return {
        key: "aviso",
        bodyParams: [templateParam(notice.detail ? `${notice.heading}, ${notice.summary}. ${notice.detail}` : `${notice.heading}, ${notice.summary}`, 400)],
        urlRef,
      };
  }
}

const FAMILIES = new Set<NoticeFamily>(["new_mission", "approval", "mission_update", "deadline", "daily_summary", "general"]);

function isButton(value: unknown): value is NoticeButton {
  if (!value || typeof value !== "object") return false;
  const button = value as Record<string, unknown>;
  return typeof button.id === "string" && button.id.length > 0 && button.id.length <= 256
    && typeof button.title === "string" && button.title.length > 0 && button.title.length <= 20;
}

/** Confere o payload gravado na fila; o que não se reconhece não sai. */
export function parseMemberV3Payload(value: unknown): MemberV3Payload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (payload.version !== 3) return null;
  if (payload.kind === "reply") {
    if (typeof payload.text !== "string" || !payload.text || payload.text.length > 4096) return null;
    const buttons = payload.buttons;
    if (buttons !== undefined && (!Array.isArray(buttons) || buttons.length > 3 || !buttons.every(isButton))) return null;
    return { version: 3, kind: "reply", text: payload.text, ...(buttons ? { buttons: buttons as NoticeButton[] } : {}) };
  }
  if (payload.kind !== "notice") return null;
  if (!NOTICE_PREFERENCES.includes(payload.preference as NoticePreference)) return null;
  const notice = payload.notice as Record<string, unknown> | null;
  if (!notice || typeof notice !== "object" || !FAMILIES.has(notice.family as NoticeFamily) || typeof notice.path !== "string") return null;
  if (notice.button !== undefined && !isButton(notice.button)) return null;
  return { version: 3, kind: "notice", preference: payload.preference as NoticePreference, notice: notice as unknown as Notice };
}
