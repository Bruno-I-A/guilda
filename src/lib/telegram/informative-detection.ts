const INFORMATIVE_PATTERN =
  /\bINFORMATIVO\s+(?:NOVO\s+CLIENTE|ALTERA[CÇ][AÃ]O\s+CLIENTE|DE\s+BAIXA\s+DE\s+CLIENTE)\b/i;
const BUSINESS_MISSION_PATTERN = /\bMISS[AÃ]O\s+EMPRESARIAL\b/i;

export function isBusinessMissionMessage(text: string): boolean {
  return BUSINESS_MISSION_PATTERN.test(text);
}

export function isClientWorkMessage(text: string): boolean {
  return INFORMATIVE_PATTERN.test(text) || isBusinessMissionMessage(text);
}

export function validateBusinessMissionFormat(text: string): string | null {
  if (!isBusinessMissionMessage(text)) return null;

  const required = [
    {
      pattern:
        /^\s*TIPO\s*:\s*(ABERTURA|ABRIU|BAIXA|FECHOU|ALTERA[CÇ][AÃ]O|ALTEROU)\s*$/im,
      label: "TIPO",
    },
    { pattern: /^\s*EMPRESA\s*:\s*\S.+$/im, label: "EMPRESA" },
    { pattern: /^\s*A[CÇ][OÕ]ES\s*:\s*(?:\S.*)?$/im, label: "AÇÕES" },
    { pattern: /^\s*RESPONS[AÁ]VEL\s*:\s*\S.+$/im, label: "RESPONSÁVEL" },
  ];
  const missing = required
    .filter(({ pattern }) => !pattern.test(text))
    .map(({ label }) => label);
  if (missing.length) return `Campos ausentes ou inválidos: ${missing.join(", ")}.`;

  const actionsStart = text.search(/^\s*A[CÇ][OÕ]ES\s*:/im);
  const responsibleStart = text.search(/^\s*RESPONS[AÁ]VEL\s*:/im);
  if (actionsStart < 0 || responsibleStart <= actionsStart) {
    return "Liste as ações antes do responsável.";
  }
  const actionBlock = text.slice(actionsStart, responsibleStart);
  if (!/(?:^|\n)\s*-\s*\S+/m.test(actionBlock)) {
    return "Inclua pelo menos uma ação iniciada por hífen.";
  }
  return null;
}
