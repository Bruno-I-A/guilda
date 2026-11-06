/**
 * Rotas autenticadas que alteram integrações externas aceitam somente
 * chamadas do próprio app. JSON já impede forms simples; o Origin fecha CSRF
 * por fetch e também considera a URL pública configurada atrás do proxy.
 */
export function isSameOriginRequest(request: Request): boolean {
  const received = request.headers.get("origin");
  if (!received) return false;
  const allowed = new Set<string>([new URL(request.url).origin]);
  for (const value of [process.env.NEXT_PUBLIC_APP_URL, process.env.BETTER_AUTH_URL]) {
    if (!value) continue;
    try {
      allowed.add(new URL(value).origin);
    } catch {
      // Ambiente inválido já é tratado no boot; não ampliar a allowlist.
    }
  }
  return allowed.has(received);
}
