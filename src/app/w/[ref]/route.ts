import { resolveShortRef } from "@/lib/notices/links";

/**
 * Botão "Abrir na Guilda" dos modelos do WhatsApp (2026-11-24): a variável do
 * link é uma referência curta (`t-<id>`, `m`, `f`…) e aqui ela vira o caminho.
 * O conjunto é fechado (nunca redireciona para endereço livre) e o destino
 * exige sessão como sempre. `Location` relativo: atrás do proxy a URL interna
 * da requisição não é a que o navegador vê.
 */
export async function GET(_request: Request, context: { params: Promise<{ ref: string }> }) {
  const { ref } = await context.params;
  return new Response(null, {
    status: 307,
    headers: { Location: resolveShortRef(ref), "Cache-Control": "no-store" },
  });
}
