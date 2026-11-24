const INFORMATIVE_PATTERN =
  /\bINFORMATIVO\s+(?:NOVO\s+CLIENTE|ALTERA[CÇ][AÃ]O\s+CLIENTE|DE\s+BAIXA\s+DE\s+CLIENTE)\b/i;
export function isDetailedInformativeMessage(text: string): boolean {
  return INFORMATIVE_PATTERN.test(text);
}
