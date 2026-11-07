/** CSP por requisição. O nonce é criado no proxy e aplicado pelo Next aos scripts. */
export function buildContentSecurityPolicy(
  nonce: string,
  production: boolean,
): string {
  const scriptSrc = production
    ? `'self' 'nonce-${nonce}' 'strict-dynamic'`
    : "'self' 'unsafe-inline' 'unsafe-eval' https://connect.facebook.net";
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    // Embedded Signup: SDK público no browser; troca do code continua no servidor.
    "connect-src 'self' https://graph.facebook.com https://www.facebook.com",
    "frame-src https://www.facebook.com https://web.facebook.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://www.facebook.com",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}
