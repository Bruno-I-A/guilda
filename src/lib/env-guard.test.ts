import { randomBytes } from "node:crypto";
import { describe, expect, test, vi } from "vitest";

// env-guard importa "server-only"; no ambiente de teste (node) ele lança.
// Mesmo padrão de cnpj-lookup.test.ts — não depender do mock de outro arquivo.
vi.mock("server-only", () => ({}));

import {
  assertSecureEnv,
  problemasDeSegredo,
  validarAuthSecret,
  validarFlowSecretsKey,
} from "./env-guard";

const SEGREDO_FORTE = randomBytes(32).toString("base64"); // ~44 chars, alta entropia

describe("BETTER_AUTH_SECRET", () => {
  test("aceita um segredo forte gerado aleatoriamente", () => {
    expect(validarAuthSecret(SEGREDO_FORTE)).toBeNull();
  });

  test("recusa ausência", () => {
    expect(validarAuthSecret(undefined)?.motivo).toMatch(/não definida/);
    expect(validarAuthSecret("   ")?.motivo).toMatch(/não definida/);
  });

  test("recusa comprimento menor que 32", () => {
    expect(validarAuthSecret("curto-demais")?.motivo).toMatch(/32 caracteres/);
  });

  test("recusa o placeholder do Dockerfile", () => {
    expect(
      validarAuthSecret("placeholder-somente-para-o-build-32ch")?.motivo,
    ).toMatch(/placeholder/);
  });

  test("recusa o default do better-auth", () => {
    expect(
      validarAuthSecret("better-auth-secret-12345678901234567890")?.motivo,
    ).toMatch(/placeholder/);
  });

  test("recusa o valor do .env.example", () => {
    expect(
      validarAuthSecret("troque-por-um-segredo-forte-openssl-rand-base64-32")
        ?.motivo,
    ).toMatch(/placeholder/);
  });

  test("recusa valor degenerado de 32 caracteres iguais", () => {
    expect(validarAuthSecret("a".repeat(40))?.motivo).toMatch(/entropia/);
  });
});

describe("FLOW_SECRETS_KEY", () => {
  test("aceita vazia (feature opcional)", () => {
    expect(validarFlowSecretsKey(undefined)).toBeNull();
    expect(validarFlowSecretsKey("")).toBeNull();
  });

  test("aceita uma chave forte base64 de 32 bytes", () => {
    expect(validarFlowSecretsKey(randomBytes(32).toString("base64"))).toBeNull();
  });

  test("aceita uma chave forte hex de 64 caracteres", () => {
    expect(validarFlowSecretsKey(randomBytes(32).toString("hex"))).toBeNull();
  });

  test("recusa chave que não decodifica para 32 bytes", () => {
    expect(validarFlowSecretsKey("curta")?.motivo).toMatch(/32 bytes/);
  });

  test("recusa chave de 32 bytes com entropia baixa (tudo zero)", () => {
    const fraca = Buffer.alloc(32, 0).toString("base64");
    expect(validarFlowSecretsKey(fraca)?.motivo).toMatch(/entropia/);
  });
});

describe("problemasDeSegredo", () => {
  test("ambiente forte não tem problemas", () => {
    expect(
      problemasDeSegredo({
        BETTER_AUTH_SECRET: SEGREDO_FORTE,
        FLOW_SECRETS_KEY: randomBytes(32).toString("base64"),
      }),
    ).toEqual([]);
  });

  test("acumula problemas de ambas as variáveis", () => {
    const issues = problemasDeSegredo({
      BETTER_AUTH_SECRET: "placeholder-somente-para-o-build-32ch",
      FLOW_SECRETS_KEY: "curta",
    });
    expect(issues.map((i) => i.variavel).sort()).toEqual([
      "BETTER_AUTH_SECRET",
      "FLOW_SECRETS_KEY",
    ]);
  });
});

describe("assertSecureEnv — derruba em produção, avisa fora", () => {
  test("PRODUÇÃO + placeholder → lança e derrubaria o boot", () => {
    expect(() =>
      assertSecureEnv({
        BETTER_AUTH_SECRET: "placeholder-somente-para-o-build-32ch",
        NODE_ENV: "production",
      }),
    ).toThrow(/Configuração de segredos inválida/);
  });

  test("PRODUÇÃO + segredo forte → não lança", () => {
    expect(() =>
      assertSecureEnv({ BETTER_AUTH_SECRET: SEGREDO_FORTE, NODE_ENV: "production" }),
    ).not.toThrow();
  });

  test("desenvolvimento + placeholder → só avisa, não lança", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() =>
      assertSecureEnv({ BETTER_AUTH_SECRET: "placeholder-x", NODE_ENV: "development" }),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("env-guard"));
    warn.mockRestore();
  });

  test("fase de build ignora placeholders (NEXT_PHASE)", () => {
    expect(() =>
      assertSecureEnv({
        BETTER_AUTH_SECRET: "placeholder-somente-para-o-build-32ch",
        NODE_ENV: "production",
        NEXT_PHASE: "phase-production-build",
      }),
    ).not.toThrow();
  });
});
