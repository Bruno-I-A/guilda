import "server-only";

/**
 * Validação de segredos na inicialização (F9 e F10 da auditoria).
 *
 * A biblioteca (better-auth) só recusa o SEU default exato; este guarda
 * acrescenta a régua do projeto: recusa o placeholder do Dockerfile, os
 * valores dos arquivos .env.example e chaves de baixa entropia — para que um
 * segredo fraco não suba em produção só porque a lib deixou passar.
 *
 * As funções de validação são puras (testadas em env-guard.test.ts). O
 * `assertSecureEnv` decide, pelo ambiente, entre lançar (produção) e avisar.
 */

export type EnvIssue = { variavel: string; motivo: string };

/** Só os campos que o guarda lê — `process.env` satisfaz este formato. */
export type EnvLike = {
  BETTER_AUTH_SECRET?: string;
  FLOW_SECRETS_KEY?: string;
  NODE_ENV?: string;
  NEXT_PHASE?: string;
};

/** Placeholders conhecidos que NUNCA podem virar segredo real. */
const PLACEHOLDERS_EXATOS = new Set([
  // Dockerfile (estágio de build) — não deve vazar para runtime.
  "placeholder-somente-para-o-build-32ch",
  // default do better-auth.
  "better-auth-secret-12345678901234567890",
  // .env.example / .env.production.example.
  "troque-por-um-segredo-forte-openssl-rand-base64-32",
  "troque-por-um-segredo-forte",
]);

/** Trechos que denunciam um valor de exemplo/placeholder. */
const PLACEHOLDER_SUBSTRINGS = [
  "placeholder",
  "changeme",
  "change-me",
  "troque",
  "example",
  "seu-segredo",
  "your-secret",
  "secret-1234",
];

/** Nº de caracteres distintos — barreira grosseira contra baixa entropia. */
function distinctChars(value: string): number {
  return new Set(value).size;
}

function pareceExemplo(value: string): boolean {
  const lower = value.toLowerCase();
  return PLACEHOLDER_SUBSTRINGS.some((s) => lower.includes(s));
}

/**
 * Valida BETTER_AUTH_SECRET. Espelha o mínimo da lib (≥32) e acrescenta a
 * recusa a placeholders e a valores degenerados (poucos caracteres distintos).
 */
export function validarAuthSecret(value: string | undefined): EnvIssue | null {
  const v = value?.trim();
  if (!v) {
    return { variavel: "BETTER_AUTH_SECRET", motivo: "não definida." };
  }
  if (v.length < 32) {
    return {
      variavel: "BETTER_AUTH_SECRET",
      motivo: "precisa ter pelo menos 32 caracteres.",
    };
  }
  if (PLACEHOLDERS_EXATOS.has(v) || pareceExemplo(v)) {
    return {
      variavel: "BETTER_AUTH_SECRET",
      motivo: "é um placeholder/valor de exemplo — gere um com `openssl rand -base64 32`.",
    };
  }
  if (distinctChars(v) < 10) {
    return {
      variavel: "BETTER_AUTH_SECRET",
      motivo: "tem entropia baixa demais (poucos caracteres distintos).",
    };
  }
  return null;
}

/** Decodifica FLOW_SECRETS_KEY como secrets.ts faz (hex de 64 ou base64). */
function decodeFlowKey(value: string): Buffer {
  return /^[A-Fa-f0-9]{64}$/.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64");
}

/**
 * Valida FLOW_SECRETS_KEY. É OPCIONAL: vazia significa "o Fluxo não guarda
 * senha Gov.br" e é aceita. Mas, se definida, precisa ser uma chave real de
 * 32 bytes com entropia — ela cifra senha de portal de governo.
 */
export function validarFlowSecretsKey(value: string | undefined): EnvIssue | null {
  const v = value?.trim();
  if (!v) return null; // opcional, degradação intencional
  const key = decodeFlowKey(v);
  if (key.length !== 32) {
    return {
      variavel: "FLOW_SECRETS_KEY",
      motivo: "precisa decodificar para exatamente 32 bytes (hex de 64 ou base64 de 32 bytes).",
    };
  }
  if (new Set(key).size < 16) {
    return {
      variavel: "FLOW_SECRETS_KEY",
      motivo: "tem entropia baixa demais para uma chave AES-256 — gere com `openssl rand -base64 32`.",
    };
  }
  return null;
}

/** Todos os problemas de segredo do ambiente atual. */
export function problemasDeSegredo(env: EnvLike = process.env): EnvIssue[] {
  return [
    validarAuthSecret(env.BETTER_AUTH_SECRET),
    validarFlowSecretsKey(env.FLOW_SECRETS_KEY),
  ].filter((issue): issue is EnvIssue => issue !== null);
}

/**
 * Ponto de entrada da inicialização. Em produção, lança e derruba o boot —
 * melhor não subir do que subir com um segredo fraco. Fora de produção, só
 * avisa (o .env.example precisa continuar rodando localmente).
 */
export function assertSecureEnv(env: EnvLike = process.env): void {
  // Durante `next build` os placeholders do Dockerfile são intencionais.
  if (env.NEXT_PHASE === "phase-production-build") return;

  const issues = problemasDeSegredo(env);
  if (issues.length === 0) return;

  const linhas = issues.map((i) => `  - ${i.variavel}: ${i.motivo}`).join("\n");
  const mensagem = `Configuração de segredos inválida:\n${linhas}`;

  if (env.NODE_ENV === "production") {
    throw new Error(mensagem);
  }
  console.warn(`[env-guard] ${mensagem}`);
}
