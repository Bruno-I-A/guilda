/**
 * Procuração ou certificado da própria empresa (decisão de 2026-11-18,
 * docs/superpowers/specs/2026-11-18-procuracao-design.md). Puro.
 */

export const CREDENTIAL_MODES = ["certificate", "proxy"] as const;
export type CredentialMode = (typeof CREDENTIAL_MODES)[number];

export const PROXY_STATUSES = ["untested", "confirmed", "invalid", "no_emission", "technical_failure"] as const;
export type ProxyStatus = (typeof PROXY_STATUSES)[number];

export const CREDENTIAL_MODE_LABELS: Record<CredentialMode, string> = {
  certificate: "Certificado da empresa",
  proxy: "Procuração",
};

export const PROXY_STATUS_LABELS: Record<ProxyStatus, string> = {
  untested: "Procuração não testada",
  confirmed: "Procuração confirmada",
  invalid: "Procuração recusada",
  no_emission: "Procuração sem permissão de emissão",
  technical_failure: "Não foi possível testar a procuração",
};

/** O selo depois de "procuração · ", onde a palavra já está dita. */
export const PROXY_STATUS_SHORT_LABELS: Record<ProxyStatus, string> = {
  untested: "não testada",
  confirmed: "confirmada",
  invalid: "recusada",
  no_emission: "sem permissão de emissão",
  technical_failure: "teste com falha técnica",
};

/** A empresa manda; sem marcação, o padrão do escritório; sem padrão, certificado (como sempre foi). */
export function effectiveCredentialMode(
  clientMode: CredentialMode | null | undefined,
  defaultMode: CredentialMode | null | undefined,
): CredentialMode {
  return clientMode ?? defaultMode ?? "certificate";
}

/**
 * O cursor foi construído com outra credencial: a leitura recomeça do zero.
 * Não está medido que a sequência de NSU é a mesma lendo com o A1 da empresa
 * ou com o do escritório. Sem registro vale certificado, que é como todo
 * cursor foi construído até a procuração existir.
 */
export function needsCursorReset(readMode: CredentialMode | null | undefined, effective: CredentialMode): boolean {
  return (readMode ?? "certificate") !== effective;
}

/** Recusa que quer dizer "a procuração não deixa" (medido no Tero). */
export function isProxyAuthorizationError(errors: readonly { code: string; message: string }[]): boolean {
  return errors.some(
    (error) => error.code === "E2245" || error.code === "401" || error.code === "403" || /procura[cç][aã]o/i.test(error.message),
  );
}

/** O que impede emitir por procuração; null = pode tentar. Falha técnica não impede. */
export function proxyEmissionProblem(status: ProxyStatus): string | null {
  if (status === "invalid") return "Procuração recusada pelo Sistema Nacional. Renove a procuração ou use o certificado da empresa.";
  if (status === "no_emission") return "A procuração não permite emitir. Renove com a permissão de emissão ou use o certificado da empresa.";
  return null;
}
