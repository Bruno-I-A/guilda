import type { Metadata } from "next";

import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Entrar" };

/** Origem sentinela: qualquer destino que escape dela não é interno. */
const ORIGEM_INTERNA = "https://guilda.local";

/**
 * Só devolve o destino quando ele RESOLVE para dentro da própria aplicação.
 *
 * A checagem anterior era textual (`startsWith("/") && !startsWith("//")`) e
 * passava por dois casos que o parser de URL resolve para outra origem:
 * `/\evil.com` (a barra invertida equivale a barra em esquemas especiais) e
 * `/<tab>/evil.com` (tab, CR e LF são removidos antes do parse). Resolver
 * primeiro e comparar a origem depois não tem esse ponto cego — é o mesmo
 * padrão que `returnToTasks` já usa em /tasks/[id].
 */
function destinoInterno(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value, ORIGEM_INTERNA);
    if (parsed.origin !== ORIGEM_INTERNA) return undefined;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return undefined;
  }
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <SignInForm next={destinoInterno(next)} />;
}
