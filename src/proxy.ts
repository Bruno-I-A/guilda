import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Proteção de rotas (Next 16: proxy.ts, o antigo middleware) + CSP com nonce.
 *
 * Duas responsabilidades independentes:
 *
 * 1. Redirecionamento OTIMISTA por cookie de sessão — só uma otimização; a
 *    validação real acontece no servidor (src/lib/session.ts) em todo layout
 *    protegido e em toda Server Action. NÃO é a fronteira de segurança.
 *
 * 2. Content-Security-Policy por requisição. Em produção o `script-src` usa um
 *    nonce aleatório + `strict-dynamic`, eliminando o `'unsafe-inline'` que
 *    antes anulava a defesa contra XSS. Em desenvolvimento a política é
 *    afrouxada porque o Next injeta scripts inline e usa eval() para HMR e o
 *    overlay de erro — testar CSP estrita só faz sentido no build de produção.
 */
// Só o login. O autocadastro foi removido (auth.ts: disableSignUp) — link
// antigo para /sign-up cai aqui e é redirecionado para /sign-in.
const AUTH_PAGES = ["/sign-in"];

function novoNonce(): string {
  // Web Crypto está disponível no runtime do proxy (edge e nodejs).
  return btoa(crypto.randomUUID() + crypto.randomUUID());
}

function contentSecurityPolicy(nonce: string): string {
  const producao = process.env.NODE_ENV === "production";
  const scriptSrc = producao
    ? `'self' 'nonce-${nonce}' 'strict-dynamic'`
    : "'self' 'unsafe-inline' 'unsafe-eval'";
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    // Estilos inline do Next/Tailwind: nonce de estilo é impraticável aqui, e
    // o risco de `style-src` é muito menor que o de `script-src`.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const sessionCookie = getSessionCookie(request);
  const isAuthPage = AUTH_PAGES.some((p) => pathname.startsWith(p));

  // Redirecionamentos não carregam HTML, então não precisam da CSP.
  if (!sessionCookie && !isAuthPage) {
    const signIn = new URL("/sign-in", request.url);
    signIn.searchParams.set("next", pathname);
    return NextResponse.redirect(signIn);
  }
  if (sessionCookie && isAuthPage) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // Passa adiante com a CSP: o nonce vai no header da REQUISIÇÃO para que o
  // Next o aplique aos próprios <script>, e no header da RESPOSTA para o
  // navegador. Ambos precisam do MESMO valor.
  const nonce = novoNonce();
  const csp = contentSecurityPolicy(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

// ATENÇÃO: este matcher é OTIMIZAÇÃO, não a fronteira de segurança. Ele decide
// onde rodar o redirecionamento otimista por cookie E onde emitir a CSP por
// requisição. Cobre todas as páginas HTML reais (grupo (app) + páginas de
// auth); `/` se redireciona sozinho e os assets estáticos não precisam de CSP.
// Uma rota nova de dados que fique fora daqui continua protegida pelo layout —
// só perde o redirect antecipado. NÃO tratar a presença aqui como autorização.
export const config = {
  matcher: [
    "/dashboard/:path*",
    "/tasks/:path*",
    "/clients/:path*",
    "/campaigns/:path*",
    "/leaderboard/:path*",
    "/members/:path*",
    "/profile/:path*",
    "/clans/:path*",
    "/closings/:path*",
    "/informativos/:path*",
    "/mural/:path*",
    "/settings/:path*",
    "/onboarding",
    "/change-password",
    "/sign-in",
  ],
};
