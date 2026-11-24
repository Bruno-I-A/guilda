/**
 * Endereços e rótulos dos avisos da Guilda. Moravam no módulo do Telegram;
 * mudaram para cá quando os avisos passaram para o WhatsApp (2026-11-24).
 */

export function appBaseUrl(): string | null {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL;
  return base ? base.replace(/\/+$/, "") : null;
}

/** Caminho relativo sem a barra inicial: é a variável do botão dos modelos. */
export function noticePath(path: string): string {
  return path.replace(/^\/+/, "");
}

export function appLink(path: string, baseUrl: string | null = appBaseUrl()): string {
  const relative = noticePath(path);
  return baseUrl ? `${baseUrl}/${relative}` : `/${relative}`;
}

export function taskPath(taskId: string): string {
  return `tasks/${taskId}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Referência curta do botão "Abrir na Guilda" dos modelos: `https://<app>/w/{{1}}`.
 * Só letra, número e hífen, porque a Meta pode codificar `/`, `#` e `?` dentro
 * da variável e o link quebraria. A rota `/w/[ref]` devolve o caminho.
 */
export function shortRef(path: string): string {
  const clean = noticePath(path);
  const task = /^tasks\/([0-9a-f-]{36})$/i.exec(clean);
  if (task && UUID.test(task[1])) return `t-${task[1].toLowerCase()}`;
  if (clean === "tasks?view=informative") return "ti";
  const notice = /^mural#aviso-([0-9a-f-]{36})$/i.exec(clean);
  if (notice && UUID.test(notice[1])) return `m-${notice[1].toLowerCase()}`;
  if (clean === "mural") return "m";
  if (clean === "closings") return "f";
  return "d";
}

/** Caminho de uma referência curta; conjunto fechado, nunca um endereço livre. */
export function resolveShortRef(ref: string): string {
  const task = /^t-(.+)$/.exec(ref);
  if (task && UUID.test(task[1])) return `/tasks/${task[1].toLowerCase()}`;
  const notice = /^m-(.+)$/.exec(ref);
  if (notice && UUID.test(notice[1])) return `/mural#aviso-${notice[1].toLowerCase()}`;
  if (ref === "ti") return "/tasks?view=informative";
  if (ref === "m") return "/mural";
  if (ref === "f") return "/closings";
  return "/dashboard";
}

export function dueDateLabel(dueDate: Date | null): string {
  if (!dueDate) return "Sem prazo";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(dueDate);
}
