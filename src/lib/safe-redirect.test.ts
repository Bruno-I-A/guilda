import { describe, expect, test } from "vitest";

/**
 * Réplica exata do filtro de `src/app/(auth)/sign-in/page.tsx`.
 *
 * O filtro vive na page porque é o único consumidor, mas a regra é sutil o
 * bastante para merecer teste: a versão textual anterior
 * (`startsWith("/") && !startsWith("//")`) deixava passar `/\evil.com` e
 * `/<tab>/evil.com`, que o parser de URL resolve para outra origem.
 */
const ORIGEM_INTERNA = "https://guilda.local";

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

describe("destino do ?next= no sign-in", () => {
  test.each([
    ["/dashboard", "/dashboard"],
    ["/tasks?status=pending", "/tasks?status=pending"],
    ["/clans/abc#topo", "/clans/abc#topo"],
  ])("aceita caminho interno %s", (entrada, esperado) => {
    expect(destinoInterno(entrada)).toBe(esperado);
  });

  test.each([
    ["//evil.com", "protocolo-relativo"],
    ["https://evil.com", "absoluto"],
    ["http://evil.com/x", "absoluto sem TLS"],
    ["/\\evil.com", "barra invertida — passava no filtro textual"],
    ["/\t/evil.com", "tab — passava no filtro textual"],
    ["/\n/evil.com", "quebra de linha"],
    ["/\r/evil.com", "retorno de carro"],
    ["\\\\evil.com", "UNC"],
    ["javascript:alert(1)", "esquema perigoso"],
  ])("recusa %s (%s)", (entrada) => {
    expect(destinoInterno(entrada)).toBeUndefined();
  });

  test("ausência de destino continua caindo no padrão", () => {
    expect(destinoInterno(undefined)).toBeUndefined();
    expect(destinoInterno("")).toBeUndefined();
  });
});
