/**
 * Hook de inicialização do Next (roda uma vez ao subir o servidor).
 * Usado só para validar os segredos do ambiente antes de servir qualquer
 * requisição — ver src/lib/env-guard.ts.
 */
export async function register(): Promise<void> {
  // Só faz sentido no runtime Node (onde os segredos vivem); o edge não os tem.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertSecureEnv } = await import("./lib/env-guard");
  assertSecureEnv();
}
