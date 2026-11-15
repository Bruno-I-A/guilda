"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Tema claro/escuro (decisão de 2026-11-15, pedido do Bruno).
 *
 * - `data-theme`, não `class`: o `@custom-variant dark` do globals.css olha
 *   para `.dark`, e os primitivos do shadcn trazem ~30 variantes `dark:` que
 *   nunca estiveram ativas. Ligar a classe agora mudaria o tema escuro que já
 *   está em produção; com o atributo, o escuro fica idêntico.
 * - O escuro continua o padrão (é o :root). "Sistema" segue o aparelho.
 * - A escolha vive no localStorage do navegador (por aparelho). Se a equipe
 *   pedir que acompanhe a conta entre aparelhos, aí vira coluna no usuário.
 */
export const THEME_OPTIONS = [
  { value: "dark", label: "Escuro" },
  { value: "light", label: "Claro" },
  { value: "system", label: "Automático (do aparelho)" },
] as const;

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="data-theme"
      themes={["dark", "light"]}
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
      storageKey="guilda-theme"
    >
      {children}
    </NextThemesProvider>
  );
}
