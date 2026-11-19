import { describe, expect, test } from "vitest";

import {
  effectiveCredentialMode,
  isProxyAuthorizationError,
  needsCursorReset,
  proxyEmissionProblem,
} from "./nfse-credentials";

describe("credencial de cada empresa", () => {
  test("a empresa manda; sem marcação, o padrão do escritório; sem padrão, certificado", () => {
    expect(effectiveCredentialMode("certificate", "proxy")).toBe("certificate");
    expect(effectiveCredentialMode(null, "proxy")).toBe("proxy");
    expect(effectiveCredentialMode(undefined, undefined)).toBe("certificate");
  });

  test("cursor sem registro foi construído com certificado; trocar de credencial zera", () => {
    expect(needsCursorReset(null, "certificate")).toBe(false);
    expect(needsCursorReset(null, "proxy")).toBe(true);
    expect(needsCursorReset("proxy", "proxy")).toBe(false);
    expect(needsCursorReset("proxy", "certificate")).toBe(true);
  });

  test("recusa de procuração na emissão", () => {
    expect(isProxyAuthorizationError([{ code: "E2245", message: "Não há procuração" }])).toBe(true);
    expect(isProxyAuthorizationError([{ code: "403", message: "Proibido" }])).toBe(true);
    expect(isProxyAuthorizationError([{ code: "X", message: "Procuração sem o serviço" }])).toBe(true);
    expect(isProxyAuthorizationError([{ code: "E0014", message: "DPS já existe" }])).toBe(false);
  });

  test("só procuração recusada impede tentar emitir", () => {
    expect(proxyEmissionProblem("untested")).toBeNull();
    expect(proxyEmissionProblem("confirmed")).toBeNull();
    expect(proxyEmissionProblem("technical_failure")).toBeNull();
    expect(proxyEmissionProblem("invalid")).toMatch(/recusada/);
    expect(proxyEmissionProblem("no_emission")).toMatch(/não permite emitir/);
  });
});
