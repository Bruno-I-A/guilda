/**
 * Para onde o "voltar" da página da missão leva.
 *
 * O valor chega pela URL (`?returnTo=`), então é entrada externa: só sobrevive
 * caminho interno conhecido. Host de fora, `//evil.com` e caminho desconhecido
 * caem na lista de missões. É guarda de open redirect — a lista branca existe
 * para ser estreita, então acrescentar destino aqui é decisão consciente, não
 * detalhe de UI.
 */
export interface ReturnTarget {
  /** Destino já normalizado, seguro para usar em `href`/`router.push`. */
  href: string;
  /** Rótulo do link, para o botão dizer de onde a pessoa veio. */
  label: string;
}

const FALLBACK: ReturnTarget = { href: "/tasks", label: "Missões" };

/** Só o formato; se o clã existe e é visível, quem decide é a página dele. */
const CLAN_PATH = /^\/clans\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseReturnTo(
  value: string | string[] | undefined,
): ReturnTarget {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return FALLBACK;

  try {
    // A base fictícia resolve caminho relativo e, junto com a checagem de
    // origem, derruba qualquer tentativa de sair do app.
    const parsed = new URL(raw, "https://guilda.local");
    if (parsed.origin !== "https://guilda.local") return FALLBACK;

    const { pathname, search } = parsed;
    if (pathname === "/tasks") {
      return { href: `${pathname}${search}`, label: "Missões" };
    }
    if (pathname === "/dashboard") {
      return { href: pathname, label: "Início" };
    }
    if (pathname === "/mural") {
      return { href: pathname, label: "Mural" };
    }
    if (CLAN_PATH.test(pathname)) {
      // A aba vive na query: sem ela a pessoa volta para o clã, mas cai em
      // Missões em vez da seção de onde saiu.
      return { href: `${pathname}${search}`, label: "Clã" };
    }
    return FALLBACK;
  } catch {
    return FALLBACK;
  }
}
