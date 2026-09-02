import type { NextConfig } from "next";

/**
 * A Content-Security-Policy saiu daqui: agora é emitida por requisição no
 * proxy (src/proxy.ts), com nonce + 'strict-dynamic' em produção (sem
 * 'unsafe-inline'). Estes cabeçalhos são estáticos e valem para TODAS as
 * rotas — inclusive as que o matcher do proxy não cobre.
 */
const securityHeaders = [
  // HSTS: efetivo atrás do Caddy com HTTPS
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
];

const nextConfig: NextConfig = {
  // Build mínimo para o Docker (copia .next/standalone no Dockerfile)
  output: "standalone",
  experimental: {
    // Importações fiscais aceitam planilhas de até 5 MB. A validação do
    // arquivo continua na Server Action; este teto só permite que ela receba o
    // corpo para validar e produzir a prévia de conciliação.
    serverActions: { bodySizeLimit: "6mb" },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
