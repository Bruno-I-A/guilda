/**
 * Criação de missão em uma linha (parser puro).
 *
 *   Conferir DAS de agosto @Camila !alta ~sexta #2
 *
 * "Liberdade" na criação significa baixa fricção COM campos estruturados,
 * nunca texto livre solto (decisão do CLAUDE.md): cada atalho vira um campo
 * real — responsável, prioridade, prazo, dificuldade — porque sem estrutura
 * o XP e o ranking não têm o que calcular. O que sobra da linha é o título.
 *
 *   @nome     pessoa (nome ou parte dele) ou clã. Sem @, a missão é sua.
 *   !alta     prioridade: alta · média · baixa (ou 1..3)
 *   ~sexta    prazo: hoje · amanhã · dia da semana · 15/09 · 15/09/2027 · +3
 *   #3        dificuldade 1..5
 *
 * Nunca inventa dado: atalho que não entende vira aviso, não chute.
 */

export interface QuickMissionMember {
  userId: string;
  name: string;
  /** Quando preenchido, a pessoa não pode receber missão (sem clã determinável). */
  resolutionError?: string | null;
}

export interface QuickMissionClan {
  id: string;
  name: string;
}

export type QuickMissionTarget =
  | { kind: "self" }
  | { kind: "person"; userId: string; name: string }
  | { kind: "clan"; clanId: string; name: string };

export interface QuickMissionIssue {
  token: string;
  message: string;
}

export interface QuickMissionParse {
  title: string;
  target: QuickMissionTarget;
  priority: number;
  difficulty: number;
  /** `YYYY-MM-DD` no calendário local de quem digita; null sem prazo. */
  dueDate: string | null;
  issues: QuickMissionIssue[];
}

export interface QuickMissionContext {
  members: readonly QuickMissionMember[];
  clans: readonly QuickMissionClan[];
  now: Date;
}

const MARKERS = new Set(["@", "!", "~", "#"]);

export function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/\s+/g, " ")
    .trim();
}

function isBoundary(text: string, index: number): boolean {
  return index >= text.length || /[\s,.;:!?)]/.test(text[index]);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function toLocalIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(base: Date, days: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
}

const WEEKDAYS: Record<string, number> = {
  dom: 0,
  domingo: 0,
  seg: 1,
  segunda: 1,
  "segunda-feira": 1,
  ter: 2,
  terca: 2,
  "terca-feira": 2,
  qua: 3,
  quarta: 3,
  "quarta-feira": 3,
  qui: 4,
  quinta: 4,
  "quinta-feira": 4,
  sex: 5,
  sexta: 5,
  "sexta-feira": 5,
  sab: 6,
  sabado: 6,
};

/**
 * Resolve o prazo relativo ao dia de quem digita. Dia da semana é a PRÓXIMA
 * ocorrência, incluindo hoje: "~sexta" numa sexta de manhã é hoje.
 */
export function resolveQuickDueDate(raw: string, now: Date): string | null {
  const value = normalizeName(raw);
  if (!value) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (value === "hoje") return toLocalIsoDate(today);
  if (value === "amanha") return toLocalIsoDate(addDays(today, 1));

  const weekday = WEEKDAYS[value];
  if (weekday !== undefined) {
    const delta = (weekday - today.getDay() + 7) % 7;
    return toLocalIsoDate(addDays(today, delta));
  }

  const relative = /^\+?(\d{1,3})d?$/.exec(value);
  if (relative) return toLocalIsoDate(addDays(today, Number(relative[1])));

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) {
    const candidate = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return candidate.getMonth() === Number(iso[2]) - 1 ? toLocalIsoDate(candidate) : null;
  }

  const br = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(value);
  if (br) {
    const day = Number(br[1]);
    const month = Number(br[2]) - 1;
    let year = br[3] ? Number(br[3]) : today.getFullYear();
    if (br[3] && br[3].length === 2) year += 2000;
    let candidate = new Date(year, month, day);
    if (candidate.getMonth() !== month || candidate.getDate() !== day) return null;
    // Sem ano, uma data já passada só pode ser do ano que vem.
    if (!br[3] && candidate.getTime() < today.getTime()) {
      candidate = new Date(year + 1, month, day);
    }
    return toLocalIsoDate(candidate);
  }

  return null;
}

const PRIORITY_WORDS: Record<string, number> = {
  "1": 1,
  baixa: 1,
  baixo: 1,
  "2": 2,
  media: 2,
  medio: 2,
  normal: 2,
  "3": 3,
  alta: 3,
  alto: 3,
  urgente: 3,
};

type TargetMatch =
  | { ok: true; target: QuickMissionTarget; length: number }
  | { ok: false; length: number; message: string };

/**
 * Resolve o `@` contra pessoas e clãs. Primeiro tenta o nome completo (o
 * mais longo que couber: "@Bruno Klain" não pode parar em "Bruno"); depois,
 * um único token contra cada parte de nome. Duas pessoas possíveis é
 * decisão de quem digita, não do parser.
 */
function matchTarget(rest: string, ctx: QuickMissionContext): TargetMatch {
  const normalizedRest = normalizeName(rest);
  const candidates: { target: QuickMissionTarget; name: string }[] = [
    ...ctx.members.map((member) => ({
      target: { kind: "person" as const, userId: member.userId, name: member.name },
      name: member.name,
    })),
    ...ctx.clans.map((clan) => ({
      target: { kind: "clan" as const, clanId: clan.id, name: clan.name },
      name: clan.name,
    })),
  ];

  let best: { target: QuickMissionTarget; length: number } | null = null;
  for (const candidate of candidates) {
    const normalizedName = normalizeName(candidate.name);
    if (!normalizedName || !normalizedRest.startsWith(normalizedName)) continue;
    if (!isBoundary(normalizedRest, normalizedName.length)) continue;
    // Quantos caracteres do texto ORIGINAL formam o nome: acento decomposto
    // e espaço duplo mudam o comprimento, então se mede pelo texto, não pelo
    // nome normalizado.
    let length = 0;
    for (let end = 1; end <= rest.length; end += 1) {
      if (normalizeName(rest.slice(0, end)) === normalizedName) {
        length = end;
        break;
      }
    }
    if (length === 0) continue;
    if (!best || length > best.length) best = { target: candidate.target, length };
  }
  if (best) return { ok: true, ...best };

  const token = /^\S+/.exec(rest)?.[0] ?? "";
  const normalizedToken = normalizeName(token.replace(/[,.;:!?)]+$/, ""));
  if (!normalizedToken) {
    return { ok: false, length: token.length, message: "Depois do @ vem o nome da pessoa ou do clã." };
  }
  const people = ctx.members.filter((member) =>
    normalizeName(member.name)
      .split(" ")
      .some((part) => part.startsWith(normalizedToken)),
  );
  const clans = ctx.clans.filter((clan) =>
    normalizeName(clan.name).startsWith(normalizedToken),
  );
  const matches: QuickMissionTarget[] = [
    ...people.map((member) => ({ kind: "person" as const, userId: member.userId, name: member.name })),
    ...clans.map((clan) => ({ kind: "clan" as const, clanId: clan.id, name: clan.name })),
  ];
  if (matches.length === 1) return { ok: true, target: matches[0], length: token.length };
  if (matches.length > 1) {
    const names = matches.map((match) => (match.kind === "self" ? "você" : match.name));
    return {
      ok: false,
      length: token.length,
      message: `@${token} pode ser ${names.slice(0, 4).join(", ")}. Escreva o nome completo.`,
    };
  }
  return { ok: false, length: token.length, message: `Ninguém chamado "${token}" na Guilda.` };
}

export function parseQuickMission(
  text: string,
  ctx: QuickMissionContext,
): QuickMissionParse {
  let target: QuickMissionTarget = { kind: "self" };
  let priority = 2;
  let difficulty = 2;
  let dueDate: string | null = null;
  const issues: QuickMissionIssue[] = [];
  const titleParts: string[] = [];

  let index = 0;
  let plainStart = 0;
  while (index < text.length) {
    const char = text[index];
    const atWordStart = index === 0 || /\s/.test(text[index - 1]);
    if (!MARKERS.has(char) || !atWordStart) {
      index += 1;
      continue;
    }

    titleParts.push(text.slice(plainStart, index));
    const rest = text.slice(index + 1);

    if (char === "@") {
      const match = matchTarget(rest, ctx);
      const consumed = index + 1 + match.length;
      const token = text.slice(index, consumed);
      if (match.ok) {
        if (match.target.kind === "person") {
          const member = ctx.members.find(
            (candidate) => match.target.kind === "person" && candidate.userId === match.target.userId,
          );
          if (member?.resolutionError) {
            issues.push({ token, message: `${member.name}: ${member.resolutionError}` });
          } else {
            target = match.target;
          }
        } else {
          target = match.target;
        }
      } else {
        issues.push({ token, message: match.message });
      }
      index = consumed;
      plainStart = index;
      continue;
    }

    const token = /^\S*/.exec(rest)?.[0] ?? "";
    const consumed = index + 1 + token.length;
    const raw = text.slice(index, consumed);
    const value = normalizeName(token.replace(/[,.;:?)]+$/, ""));

    if (char === "!") {
      const parsed = PRIORITY_WORDS[value];
      if (parsed) priority = parsed;
      else issues.push({ token: raw, message: "Prioridade: !alta, !média ou !baixa." });
    } else if (char === "#") {
      const parsed = /^[1-5]$/.test(value) ? Number(value) : null;
      if (parsed) difficulty = parsed;
      else issues.push({ token: raw, message: "Dificuldade: #1 a #5." });
    } else if (char === "~") {
      const parsed = resolveQuickDueDate(value, ctx.now);
      if (parsed) dueDate = parsed;
      else issues.push({ token: raw, message: "Prazo: ~hoje, ~amanhã, ~sexta, ~15/09 ou ~+3." });
    }

    index = consumed;
    plainStart = index;
  }
  titleParts.push(text.slice(plainStart));

  const title = titleParts
    .join(" ")
    .replace(/\s+/g, " ")
    // "@Camila, urgente" deixa a vírgula para trás: cola nela a palavra anterior.
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
  return { title, target, priority, difficulty, dueDate, issues };
}

/**
 * Sugestões para o `@` que está sendo digitado: o token entre o `@` mais
 * próximo do cursor e o cursor, sem espaço no meio. Devolve null quando o
 * cursor não está num `@`.
 */
export function quickMissionMentionAtCursor(
  text: string,
  cursor: number,
): { start: number; query: string } | null {
  const before = text.slice(0, cursor);
  const at = before.lastIndexOf("@");
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  // Uma palavra já fechada por espaço e mais outra ainda pode ser nome
  // composto ("@Bruno K"); outro atalho, espaço duplo ou uma frase inteira
  // depois do @ é sinal de que a menção já terminou.
  if (/\s[@!~#]/.test(query) || /\s\s/.test(query) || /\n/.test(query)) return null;
  if (query.trim().split(/\s+/).length > 3) return null;
  return { start: at, query };
}

export function suggestQuickMissionTargets(
  query: string,
  ctx: Pick<QuickMissionContext, "members" | "clans">,
  limit = 6,
): QuickMissionTarget[] {
  const normalized = normalizeName(query);
  const people = ctx.members
    .filter((member) => !member.resolutionError)
    .filter((member) => {
      if (!normalized) return true;
      const name = normalizeName(member.name);
      return name.startsWith(normalized) || name.split(" ").some((part) => part.startsWith(normalized));
    })
    .map((member) => ({ kind: "person" as const, userId: member.userId, name: member.name }));
  const clans = ctx.clans
    .filter((clan) => !normalized || normalizeName(clan.name).startsWith(normalized))
    .map((clan) => ({ kind: "clan" as const, clanId: clan.id, name: clan.name }));
  return [...people, ...clans].slice(0, limit);
}
