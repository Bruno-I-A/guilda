import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Proteção de rotas (Next 16: proxy.ts, o antigo middleware).
 * Checagem OTIMISTA: só verifica a presença do cookie de sessão para
 * redirecionar cedo. A validação real da sessão acontece no servidor
 * (src/lib/session.ts) em todo layout protegido e em toda Server Action.
 */
// Só o login. O autocadastro foi removido (auth.ts: disableSignUp) — link
// antigo para /sign-up cai aqui e é redirecionado para /sign-in.
const AUTH_PAGES = ["/sign-in"];

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const sessionCookie = getSessionCookie(request);
  const isAuthPage = AUTH_PAGES.some((p) => pathname.startsWith(p));

  if (!sessionCookie && !isAuthPage) {
    const signIn = new URL("/sign-in", request.url);
    signIn.searchParams.set("next", pathname);
    return NextResponse.redirect(signIn);
  }

  if (sessionCookie && isAuthPage) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/tasks/:path*",
    "/clients/:path*",
    "/campaigns/:path*",
    "/leaderboard/:path*",
    "/members/:path*",
    "/profile/:path*",
    "/onboarding",
    "/change-password",
    "/sign-in",
  ],
};
