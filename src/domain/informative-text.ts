/**
 * Discriminador entre AÇÃO e COMBINADO dentro de um informativo.
 *
 * O informativo mistura três coisas: dados cadastrais, combinados
 * permanentes ("Camila responde pelos informativos") e ações pontuais.
 * Combinado não tem conclusão possível — virar missão só suja a lista.
 * O discriminador é o VERBO NO INFINITIVO no começo da ação; o que não é
 * ação vira corpo do aviso de empresa nova no Mural da Guilda.
 */

/** Cabeçalhos que abrem o bloco de ações. */
const ACTION_HEADINGS = ["acoes", "acao", "tarefas", "providencias"];

/** Cabeçalhos que abrem o bloco do que NÃO é ação. */
const OBSERVATION_HEADINGS = [
  "observacoes",
  "observacao",
  "obs",
  "combinados",
  "combinado",
  "notas",
];

/**
 * Palavras que terminam em -ar/-er/-ir/-or sem serem verbos. Sem esta lista
 * "setor", "valor" e "particular" abririam uma linha de combinado como se
 * fosse ação.
 */
const INFINITIVE_LOOKALIKES = new Set([
  "anterior",
  "auxiliar",
  "calor",
  "celular",
  "diretor",
  "doutor",
  "escolar",
  "exterior",
  "familiar",
  "favor",
  "interior",
  "lugar",
  "maior",
  "melhor",
  "menor",
  "militar",
  "motor",
  "particular",
  "peculiar",
  "posterior",
  "senhor",
  "setor",
  "similar",
  "superior",
  "titular",
  "valor",
  "vapor",
]);

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Retira numeração, negrito do WhatsApp e pontuação solta nas pontas. */
export function stripLineDecorations(line: string): string {
  return line
    .replace(/\*/g, "")
    .replace(/^\s*\d+(?:\.\d+)*\s*[-–—:)]?\s*/, "")
    .replace(/^[\s\-–—:•>]+/, "")
    .trim();
}

/** Uma palavra isolada tem cara de verbo no infinitivo? */
export function looksLikeInfinitive(word: string): boolean {
  const normalized = normalize(word).replace(/[^a-z]/g, "");
  if (normalized.length < 4) return false;
  if (INFINITIVE_LOOKALIKES.has(normalized)) return false;
  return /(?:ar|er|ir|or)$/.test(normalized);
}

/**
 * Uma linha é ação quando ALGUM de seus campos começa por infinitivo.
 * O teste é por segmento porque o formato é `Setor - Pessoa - ação` e o
 * prazo pode vir depois da ação (`… - prazo 05/09/2026`).
 */
export function isActionLine(line: string): boolean {
  const cleaned = stripLineDecorations(line);
  if (!cleaned) return false;
  return cleaned
    .split(/\s[-–—]\s|[/|;]/)
    .some((segment) => {
      const first = segment.trim().split(/\s+/)[0] ?? "";
      return looksLikeInfinitive(first);
    });
}

function headingOf(line: string): "action" | "observation" | null {
  const cleaned = normalize(stripLineDecorations(line))
    .replace(/[^a-z\s]/g, "")
    .trim();
  if (!cleaned || cleaned.split(/\s+/).length > 2) return null;
  if (ACTION_HEADINGS.includes(cleaned)) return "action";
  if (OBSERVATION_HEADINGS.includes(cleaned)) return "observation";
  return null;
}

/**
 * Linhas do informativo que NÃO são ação: o bloco `OBSERVAÇÕES` inteiro mais
 * o que aparecer dentro de `AÇÕES` sem verbo no infinitivo. É o corpo do
 * aviso de empresa nova no mural.
 *
 * Conservador de propósito: sem nenhum dos dois cabeçalhos não há como
 * separar dado cadastral de combinado, e a função devolve lista vazia em vez
 * de chutar.
 */
export function extractObservationLines(sourceText: string): string[] {
  const lines = sourceText.split(/\r?\n/);
  let section: "header" | "action" | "observation" = "header";
  let sawSection = false;
  const observations: string[] = [];

  for (const rawLine of lines) {
    const heading = headingOf(rawLine);
    if (heading) {
      section = heading;
      sawSection = true;
      continue;
    }
    const cleaned = stripLineDecorations(rawLine);
    if (!cleaned) continue;
    if (section === "observation") {
      observations.push(cleaned);
    } else if (section === "action" && !isActionLine(cleaned)) {
      observations.push(cleaned);
    }
  }

  return sawSection ? observations : [];
}
