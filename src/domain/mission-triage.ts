import type { TaskStatus } from "./task-state";

/**
 * Triagem da lista de missões (funções puras).
 *
 * A lista antiga misturava tudo num filtro só: origem, escopo, status e
 * prazo, quatro selects para chegar em "o que é meu e ainda não fiz". Aqui a
 * estrutura vem antes do filtro:
 *
 *   - A ORIGEM vira o eixo principal (`MissionView`). Missão de Informativo
 *     nasce de um pacote confirmado, em lote, e faz sentido lida como
 *     pacote; missão avulsa é um pedido de uma pessoa para outra e precisa
 *     de acompanhamento individual. Juntas, as avulsas somem no meio.
 *   - Dentro das avulsas, a lista do próprio usuário é dividida por PAPEL
 *     dele em cada missão (fazer, aprovar, pediu, enviou), não por status.
 *     Status é atributo; papel é o que decide a próxima ação.
 *   - Dentro dos informativos, a unidade é o PACOTE: as missões da mesma
 *     empresa, com o progresso do conjunto.
 */

export const MISSION_VIEWS = ["standalone", "informative"] as const;
export type MissionView = (typeof MISSION_VIEWS)[number];

/**
 * `?view=` na URL. O `origin=` legado (filtro que existiu por um commit na
 * develop) é aceito como sinônimo para não quebrar link já copiado.
 */
export function parseMissionView(
  value: string | undefined,
  legacyOrigin?: string | undefined,
): MissionView {
  if (MISSION_VIEWS.includes(value as MissionView)) return value as MissionView;
  if (legacyOrigin === "informative") return "informative";
  return "standalone";
}

export const MISSION_SCOPES = ["mine", "my_clans", "clan", "person", "all"] as const;
export type MissionScope = (typeof MISSION_SCOPES)[number];

/**
 * `created` (escopo antigo) virou a seção "Você pediu" da visão pessoal.
 * O padrão depende da visão: avulsa é pessoal; informativo é lido por clã,
 * porque a missão nasce sem dono e quem a assume é alguém do clã.
 */
export function parseMissionScope(
  value: string | undefined,
  fallback: MissionScope = "mine",
): MissionScope {
  return MISSION_SCOPES.includes(value as MissionScope)
    ? (value as MissionScope)
    : fallback;
}

export function defaultMissionScope(
  view: MissionView,
  belongsToAClan: boolean,
): MissionScope {
  return view === "informative" && belongsToAClan ? "my_clans" : "mine";
}

/** Missão ainda em jogo — as que contam como trabalho pendente. */
export const OPEN_STATUSES = [
  "pending",
  "in_progress",
  "awaiting_approval",
  "rejected",
] as const satisfies readonly TaskStatus[];

export function isOpenStatus(status: TaskStatus): boolean {
  return (OPEN_STATUSES as readonly TaskStatus[]).includes(status);
}

export interface TriageTask {
  id: string;
  title: string;
  status: TaskStatus;
  creatorId: string;
  assigneeId: string | null;
  dueDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export function isTaskOverdue(
  task: Pick<TriageTask, "dueDate" | "status">,
  now: Date,
): boolean {
  if (!task.dueDate || !isOpenStatus(task.status)) return false;
  return task.dueDate.getTime() < now.getTime();
}

/**
 * Ordem de leitura de uma fila aberta: atrasadas primeiro, depois o prazo
 * mais próximo, sem prazo por último e, no empate, a mais recente em cima.
 */
export function compareOpenTasks<T extends TriageTask>(
  now: Date,
): (left: T, right: T) => number {
  return (left, right) => {
    const leftOverdue = isTaskOverdue(left, now);
    const rightOverdue = isTaskOverdue(right, now);
    if (leftOverdue !== rightOverdue) return leftOverdue ? -1 : 1;

    const leftDue = left.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
    const rightDue = right.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
    if (leftDue !== rightDue) return leftDue - rightDue;

    return right.createdAt.getTime() - left.createdAt.getTime();
  };
}

/** Encerradas: a mais recentemente fechada em cima. */
export function compareClosedTasks<T extends TriageTask>(
  left: T,
  right: T,
): number {
  const leftClosed = (left.completedAt ?? left.updatedAt).getTime();
  const rightClosed = (right.completedAt ?? right.updatedAt).getTime();
  return rightClosed - leftClosed;
}

export const STANDALONE_SECTIONS = [
  "todo",
  "approve",
  "requested",
  "submitted",
  "closed",
] as const;
export type StandaloneSection = (typeof STANDALONE_SECTIONS)[number];

/**
 * O papel do usuário em cada missão avulsa. Uma missão cai em UMA seção:
 *
 *   todo       é a pessoa responsável e ainda tem trabalho a fazer
 *   submitted  é a pessoa responsável, já entregou e espera quem pediu
 *   approve    pediu a outra pessoa e a entrega está na sua mão
 *   requested  pediu a outra pessoa (ou a um clã) e ainda não voltou
 *   closed     concluída ou cancelada, em qualquer um dos papéis
 *
 * Auto-missão (criador == responsável) é sempre `todo`: ela não passa por
 * aprovação, então nunca espera ninguém.
 */
export function standaloneSectionFor(
  task: Pick<TriageTask, "status" | "creatorId" | "assigneeId">,
  viewerId: string,
): StandaloneSection | null {
  const isAssignee = task.assigneeId === viewerId;
  const isCreator = task.creatorId === viewerId;
  if (!isAssignee && !isCreator) return null;

  if (!isOpenStatus(task.status)) return "closed";
  if (isAssignee) {
    return task.status === "awaiting_approval" ? "submitted" : "todo";
  }
  return task.status === "awaiting_approval" ? "approve" : "requested";
}

export type StandaloneTriage<T extends TriageTask> = Record<StandaloneSection, T[]>;

export function triageStandaloneTasks<T extends TriageTask>(
  tasks: readonly T[],
  viewerId: string,
  now: Date,
): StandaloneTriage<T> {
  const sections: StandaloneTriage<T> = {
    todo: [],
    approve: [],
    requested: [],
    submitted: [],
    closed: [],
  };
  for (const task of tasks) {
    const section = standaloneSectionFor(task, viewerId);
    if (section) sections[section].push(task);
  }
  const openOrder = compareOpenTasks<T>(now);
  sections.todo.sort(openOrder);
  sections.approve.sort(openOrder);
  sections.requested.sort(openOrder);
  sections.submitted.sort(openOrder);
  sections.closed.sort(compareClosedTasks);
  return sections;
}

/** Escopos amplos (clã, pessoa, Guilda) não têm papel: só aberto/encerrado. */
export function splitOpenAndClosed<T extends TriageTask>(
  tasks: readonly T[],
  now: Date,
): { open: T[]; closed: T[] } {
  const open: T[] = [];
  const closed: T[] = [];
  for (const task of tasks) {
    (isOpenStatus(task.status) ? open : closed).push(task);
  }
  open.sort(compareOpenTasks<T>(now));
  closed.sort(compareClosedTasks);
  return { open, closed };
}

export const INFORMATIVE_KINDS = [
  "new_client",
  "client_change",
  "client_closure",
  "general_task",
] as const;
export type InformativeKind = (typeof INFORMATIVE_KINDS)[number];

export const INFORMATIVE_KIND_LABELS: Record<InformativeKind, string> = {
  new_client: "Novo cliente",
  client_change: "Alteração",
  client_closure: "Baixa",
  general_task: "Missões gerais",
};

export function parseInformativeKind(value: unknown): InformativeKind {
  return INFORMATIVE_KINDS.includes(value as InformativeKind)
    ? (value as InformativeKind)
    : "general_task";
}

export interface InformativeSummary {
  id: string;
  kind: InformativeKind;
  /** Razão social registrada na prévia — cai para o nome da empresa vinculada. */
  companyName: string | null;
  createdAt: Date;
}

export interface PackageProgress {
  /** Concluídas. */
  done: number;
  /** Missões que contam: tudo menos as canceladas. */
  total: number;
  cancelled: number;
}

export interface InformativePackage<T extends TriageTask> {
  informativeId: string;
  kind: InformativeKind;
  label: string;
  createdAt: Date;
  /** As missões visíveis no escopo atual, na ordem de leitura. */
  tasks: T[];
  /** Status de TODAS as missões do pacote — alimenta o medidor por segmento. */
  statuses: TaskStatus[];
  /** Progresso do pacote INTEIRO, mesmo quando o escopo mostra só parte dele. */
  progress: PackageProgress;
  /** Ainda tem missão em jogo em qualquer parte do pacote. */
  open: boolean;
}

export function packageProgress(
  statuses: readonly TaskStatus[],
): PackageProgress {
  let done = 0;
  let cancelled = 0;
  for (const status of statuses) {
    if (status === "completed") done += 1;
    else if (status === "cancelled") cancelled += 1;
  }
  return { done, total: statuses.length - cancelled, cancelled };
}

/**
 * Agrupa as missões visíveis por informativo, com o progresso de todo o
 * pacote. `allStatuses` traz o status de TODAS as missões de cada pacote —
 * inclusive as fora do escopo — porque "3 de 7" precisa ser o 7 de verdade.
 *
 * Pacotes com trabalho aberto vêm primeiro, do mais recente ao mais antigo;
 * os encerrados vão para o fim, na mesma ordem.
 */
export function groupInformativePackages<T extends TriageTask & { informativeId: string | null; clientName?: string | null }>(
  tasks: readonly T[],
  informatives: ReadonlyMap<string, Omit<InformativeSummary, "id">>,
  allStatuses: ReadonlyMap<string, readonly TaskStatus[]>,
  now: Date,
): InformativePackage<T>[] {
  const byInformative = new Map<string, T[]>();
  for (const task of tasks) {
    if (!task.informativeId) continue;
    const group = byInformative.get(task.informativeId) ?? [];
    group.push(task);
    byInformative.set(task.informativeId, group);
  }

  const openOrder = compareOpenTasks<T>(now);
  const packages: InformativePackage<T>[] = [];
  for (const [informativeId, group] of byInformative) {
    const summary = informatives.get(informativeId);
    const statuses = allStatuses.get(informativeId) ?? group.map((task) => task.status);
    const progress = packageProgress(statuses);
    const clientName = group.find((task) => task.clientName)?.clientName ?? null;
    const label = summary?.companyName ?? clientName ?? "Missões sem empresa";
    packages.push({
      informativeId,
      kind: summary?.kind ?? "general_task",
      label,
      createdAt: summary?.createdAt ?? group[0].createdAt,
      tasks: [...group].sort((left, right) => {
        const leftOpen = isOpenStatus(left.status);
        const rightOpen = isOpenStatus(right.status);
        if (leftOpen !== rightOpen) return leftOpen ? -1 : 1;
        return leftOpen ? openOrder(left, right) : compareClosedTasks(left, right);
      }),
      statuses: [...statuses],
      progress,
      open: statuses.some((status) => isOpenStatus(status)),
    });
  }

  packages.sort((left, right) => {
    if (left.open !== right.open) return left.open ? -1 : 1;
    return right.createdAt.getTime() - left.createdAt.getTime();
  });
  return packages;
}
