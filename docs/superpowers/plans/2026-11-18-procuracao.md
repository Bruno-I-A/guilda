# Procuração (A1 do escritório) — Plano de implementação

> **Para quem executa:** use superpowers:subagent-driven-development (recomendado) ou
> superpowers:executing-plans, tarefa por tarefa. Os passos usam caixas (`- [ ]`).

**Objetivo:** permitir que a aba XML leia e que Notas dos clientes emita com o A1 do
escritório, por procuração, com um padrão do escritório e exceção por empresa.

**Arquitetura:** o A1 do escritório que o `guilda-fiscal` já abre na subida (o dos
honorários) passa a ser entregue à rotina de XML, à fila das notas dos clientes e a um
teste de procuração novo. Duas tabelas novas guardam o padrão do escritório e, por
empresa, o modo, o selo da procuração e com qual credencial o cursor de leitura foi
construído. O app só registra pedidos; quem fala com o Sistema Nacional é o serviço
fiscal.

**Desenho aprovado:** `docs/superpowers/specs/2026-11-18-procuracao-design.md`.

**Stack:** Next.js 16 (App Router), Drizzle + Postgres (RLS forçado), Vitest + PGlite,
serviço fiscal em Node (`scripts/fiscal-service.ts`).

**Regras da casa que valem aqui:**
- Toda tabela de domínio tem `org_id`, RLS forçado e política `org_isolation`.
- O `guilda_app` ganha tudo em tabela nova pelos default privileges: restringir exige
  `REVOKE`.
- Nenhum log com certificado, senha, envelope ou XML.
- Mensagens de commit em português, sem acento, terminando com
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Verificação antes de cada commit: o teste da tarefa. No fim: `npm test`,
  `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npm run check:rls`.

---

## Mapa de arquivos

| Arquivo | Papel |
|---|---|
| `src/domain/nfse-credentials.ts` (novo) | Modos, selos, modo efetivo, regra de zerar cursor, problemas de emissão. Puro. |
| `src/lib/nfse/proxy-check.ts` (novo) | URL do teste e classificação da resposta do ADN. Puro. |
| `src/db/schema/domain.ts` | Enums e as duas tabelas novas. |
| `src/db/migrations/0101_procuracao.sql` (gerado + RLS) | Tabelas, RLS, grants. |
| `src/lib/nfse/credentials-repository.ts` (novo) | Leitura e gravação de padrão, modo, selo, pedidos de teste e cursor. |
| `src/lib/nfse/xml-repository.ts` | `listRoutineClients` com o modo efetivo. |
| `src/lib/nfse/xml-cycle.ts` | Transporte do escritório por procuração, cursor zerado na troca, recusa vira selo. |
| `src/lib/nfse/proxy-test.ts` (novo) | Teste de procuração no ciclo do serviço fiscal. |
| `src/lib/nfse/sefin-client.ts` | `emit` devolve o XML da resposta; número da nota sem a consulta recusada. |
| `src/lib/nfse/processor.ts` | O XML da emissão segue no desfecho. |
| `src/lib/client-nfse/service.ts` | Emissão por procuração, XML por três fontes, conferência que não se pula. |
| `src/lib/client-nfse/month.ts` | Prontidão do emissor pelo modo efetivo. |
| `src/lib/client-nfse/loaders.ts` | Credencial no cartão do emissor e no "Buscar notas antigas". |
| `src/lib/office-fees/fiscal-operator.ts` | Mensagem própria para ação só de admin. |
| `scripts/fiscal-service.ts` | Entrega o A1 do escritório às três rotinas. |
| `src/app/(app)/clans/[id]/nfse-xml-actions.ts` | Ações: padrão, modo da empresa, pedido de teste. |
| `src/lib/nfse/xml-requests.ts` | Visões da aba XML com a credencial. |
| `src/app/(app)/clans/[id]/xml-credentials.tsx` (novo) | Painel "Credenciais" e controles por empresa. |
| `src/app/(app)/clans/[id]/xml-notes-board.tsx`, `xml-notes-tab.tsx`, `page.tsx` | Passo "Credenciais", filtro "Sem credencial", linha da empresa. |
| `src/app/(app)/clans/[id]/client-nfse-workspace.tsx` | "Emite por" no cartão da empresa. |
| `CLAUDE.md` | Decisão registrada. |

---

### Tarefa 1: Domínio das credenciais

**Arquivos:**
- Criar: `src/domain/nfse-credentials.ts`
- Teste: `src/domain/nfse-credentials.test.ts`

- [ ] **Passo 1: Escrever o teste**

```ts
import { describe, expect, test } from "vitest";

import {
  effectiveCredentialMode,
  isProxyAuthorizationError,
  needsCursorReset,
  proxyEmissionProblem,
  rejectionCode,
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

  test("código da recusa sai da mensagem do ADN", () => {
    expect(rejectionCode("E2245 — Não há procuração da inscrição X para a Y")).toBe("E2245");
    expect(rejectionCode("O Sistema Nacional recusou o certificado da empresa.")).toBeNull();
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/domain/nfse-credentials.test.ts`
Esperado: FAIL, módulo `./nfse-credentials` não existe.

- [ ] **Passo 3: Implementar**

```ts
/**
 * Procuração ou certificado da própria empresa (decisão de 2026-11-18,
 * docs/superpowers/specs/2026-11-18-procuracao-design.md). Puro.
 */

export const CREDENTIAL_MODES = ["certificate", "proxy"] as const;
export type CredentialMode = (typeof CREDENTIAL_MODES)[number];

export const PROXY_STATUSES = ["untested", "confirmed", "invalid", "no_emission", "technical_failure"] as const;
export type ProxyStatus = (typeof PROXY_STATUSES)[number];

export const CREDENTIAL_MODE_LABELS: Record<CredentialMode, string> = {
  certificate: "Certificado da empresa",
  proxy: "Procuração",
};

export const PROXY_STATUS_LABELS: Record<ProxyStatus, string> = {
  untested: "Procuração não testada",
  confirmed: "Procuração confirmada",
  invalid: "Procuração recusada",
  no_emission: "Procuração sem permissão de emissão",
  technical_failure: "Não foi possível testar a procuração",
};

/** A empresa manda; sem marcação, o padrão do escritório; sem padrão, certificado (como sempre foi). */
export function effectiveCredentialMode(
  clientMode: CredentialMode | null | undefined,
  defaultMode: CredentialMode | null | undefined,
): CredentialMode {
  return clientMode ?? defaultMode ?? "certificate";
}

/**
 * O cursor foi construído com outra credencial: a leitura recomeça do zero.
 * Não está medido que a sequência de NSU é a mesma lendo com o A1 da empresa
 * ou com o do escritório. Sem registro vale certificado, que é como todo
 * cursor foi construído até a procuração existir.
 */
export function needsCursorReset(readMode: CredentialMode | null | undefined, effective: CredentialMode): boolean {
  return (readMode ?? "certificate") !== effective;
}

/** Recusa que quer dizer "a procuração não deixa" (medido no Tero). */
export function isProxyAuthorizationError(errors: readonly { code: string; message: string }[]): boolean {
  return errors.some((error) => error.code === "E2245" || error.code === "401" || error.code === "403" || /procura[cç][aã]o/i.test(error.message));
}

/** O que impede emitir por procuração; null = pode tentar. Falha técnica não impede. */
export function proxyEmissionProblem(status: ProxyStatus): string | null {
  if (status === "invalid") return "Procuração recusada pelo Sistema Nacional. Renove a procuração ou use o certificado da empresa.";
  if (status === "no_emission") return "A procuração não permite emitir. Renove com a permissão de emissão ou use o certificado da empresa.";
  return null;
}

/** "E2245 — Não há procuração…" → "E2245"; sem código no começo → null. */
export function rejectionCode(message: string): string | null {
  return /^([A-Z]?\d{3,5})\s—/.exec(message)?.[1] ?? null;
}
```

- [ ] **Passo 4: Rodar e ver passar**

Rodar: `npx vitest run src/domain/nfse-credentials.test.ts`
Esperado: PASS (5 testes).

- [ ] **Passo 5: Commit**

```bash
git add src/domain/nfse-credentials.ts src/domain/nfse-credentials.test.ts
git commit -m "feat(procuracao): dominio da credencial de cada empresa"
```

---

### Tarefa 2: Classificação do teste de procuração

**Arquivos:**
- Criar: `src/lib/nfse/proxy-check.ts`
- Teste: `src/lib/nfse/proxy-check.test.ts`

- [ ] **Passo 1: Escrever o teste**

```ts
import { describe, expect, test } from "vitest";

import { classifyProxyResponse, proxyTestUrl } from "./proxy-check";
import type { HttpResponse } from "./sefin-client";
import { testAdnBatchBody } from "./testing/adn";

function response(status: number, body: string): HttpResponse {
  return { status, body: Buffer.from(body), contentType: "application/json" };
}

describe("teste de procuração", () => {
  test("URL lê a partir do NSU pedido, em nome do CNPJ da empresa", () => {
    expect(proxyTestUrl("producao", "33000167000101", 41)).toBe(
      "https://adn.nfse.gov.br/contribuintes/DFe/41?lote=true&cnpjConsulta=33000167000101",
    );
    expect(() => proxyTestUrl("producao", "123", 0)).toThrow(/14 dígitos/);
  });

  test("lote legível confirma e traz os documentos para medir a sequência", () => {
    const outcome = classifyProxyResponse(response(200, testAdnBatchBody([{ nsu: 42, xml: "<NFSe/>" }])));
    expect(outcome).toMatchObject({ status: "confirmed", httpStatus: 200, code: null });
    expect(outcome.documents).toEqual([{ nsu: 42, xml: "<NFSe/>" }]);
  });

  test("nenhum documento ainda também confirma", () => {
    const body = JSON.stringify({ StatusProcessamento: "NENHUM_DOCUMENTO_LOCALIZADO" });
    expect(classifyProxyResponse(response(404, body))).toMatchObject({ status: "confirmed", documents: [] });
  });

  test("E2245 é procuração recusada, com o código", () => {
    const body = JSON.stringify({ StatusProcessamento: "REJEICAO", Erros: [{ Codigo: "E2245", Descricao: "Não há procuração da inscrição X para a Y" }] });
    expect(classifyProxyResponse(response(400, body))).toMatchObject({ status: "invalid", code: "E2245", message: "Não há procuração da inscrição X para a Y" });
  });

  test("403 é recusa", () => {
    expect(classifyProxyResponse(response(403, "{}"))).toMatchObject({ status: "invalid", httpStatus: 403 });
  });

  test("rede, 5xx, 429 e formato desconhecido nunca viram recusa", () => {
    expect(classifyProxyResponse(response(0, ""))).toMatchObject({ status: "technical_failure" });
    expect(classifyProxyResponse(response(503, ""))).toMatchObject({ status: "technical_failure" });
    expect(classifyProxyResponse(response(429, ""))).toMatchObject({ status: "technical_failure" });
    expect(classifyProxyResponse(response(200, "<html>manutenção</html>"))).toMatchObject({ status: "technical_failure" });
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/lib/nfse/proxy-check.test.ts`
Esperado: FAIL, módulo não existe.

- [ ] **Passo 3: Implementar**

```ts
import { ADN_CONTRIBUINTES } from "./adn-client";
import type { HttpResponse, NfseEnvironmentName } from "./sefin-client";
import { gunzipBase64 } from "./xml";

/**
 * Teste de procuração: uma leitura no ADN com o A1 do escritório em nome do
 * CNPJ da empresa. Medido no Tero (10/11/2026): com procuração vem o lote;
 * sem ela, HTTP 400 com E2245. "technical_failure" é tudo que não prova nada
 * sobre a procuração (rede, 5xx, formato desconhecido) e nunca vira recusa.
 */
export interface ProxyOutcome {
  status: "confirmed" | "invalid" | "technical_failure";
  httpStatus: number | null;
  code: string | null;
  message: string | null;
  /** Só na confirmação: para medir se o NSU é o mesmo da leitura com o A1 da empresa. */
  documents: { nsu: number; xml: string }[];
}

const MAX_MESSAGE = 300;

export function proxyTestUrl(environment: NfseEnvironmentName, cnpj: string, afterNsu: number): string {
  if (!/^\d{14}$/.test(cnpj)) throw new Error("O CNPJ do teste precisa ter 14 dígitos.");
  return `${ADN_CONTRIBUINTES[environment]}/DFe/${afterNsu}?lote=true&cnpjConsulta=${cnpj}`;
}

function field(source: unknown, name: string): unknown {
  if (!source || typeof source !== "object") return undefined;
  const key = Object.keys(source).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : (source as Record<string, unknown>)[key];
}

function parseJson(res: HttpResponse): Record<string, unknown> | null {
  try {
    const value = JSON.parse(res.body.toString("utf8")) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function firstError(body: unknown): { code: string | null; message: string | null } {
  const errors = field(body, "Erros");
  const first = Array.isArray(errors) ? errors[0] : undefined;
  const code = field(first, "Codigo");
  const description = field(first, "Descricao");
  return {
    code: typeof code === "string" ? code.slice(0, 30) : null,
    message: typeof description === "string" ? description.slice(0, MAX_MESSAGE) : null,
  };
}

function readDocuments(items: unknown[]): { nsu: number; xml: string }[] | null {
  const documents: { nsu: number; xml: string }[] = [];
  for (const item of items) {
    const nsu = Number(field(item, "NSU"));
    const xml = field(item, "ArquivoXml");
    if (!Number.isSafeInteger(nsu) || typeof xml !== "string") return null;
    try {
      documents.push({ nsu, xml: gunzipBase64(xml) });
    } catch {
      return null;
    }
  }
  return documents;
}

export function classifyProxyResponse(res: HttpResponse): ProxyOutcome {
  const technical = (message: string): ProxyOutcome => ({ status: "technical_failure", httpStatus: res.status || null, code: null, message, documents: [] });
  if (res.status === 0 || res.status === 408 || res.status === 429 || res.status >= 500) {
    return technical(`O Sistema Nacional respondeu HTTP ${res.status}.`);
  }
  const body = parseJson(res);
  const ok = res.status >= 200 && res.status < 300;
  if (res.status === 401 || res.status === 403) {
    const { code, message } = firstError(body);
    return { status: "invalid", httpStatus: res.status, code, message: message ?? "O Sistema Nacional recusou o acesso.", documents: [] };
  }
  if (body === null) {
    return ok ? technical("Resposta do Sistema Nacional em formato inesperado.") : { status: "invalid", httpStatus: res.status, code: null, message: `Recusa sem detalhe (HTTP ${res.status}).`, documents: [] };
  }
  const status = String(field(body, "StatusProcessamento") ?? "").toUpperCase();
  if (status === "NENHUM_DOCUMENTO_LOCALIZADO" && (ok || res.status === 404)) {
    return { status: "confirmed", httpStatus: res.status, code: null, message: "Nenhum documento ainda.", documents: [] };
  }
  if (!ok || status === "REJEICAO") {
    const { code, message } = firstError(body);
    return { status: "invalid", httpStatus: res.status, code, message: message ?? `Recusa sem detalhe (HTTP ${res.status}).`, documents: [] };
  }
  const items = field(body, "LoteDFe");
  const documents = Array.isArray(items) ? readDocuments(items) : null;
  if (!documents) return technical("Lote do Sistema Nacional em formato inesperado.");
  return { status: "confirmed", httpStatus: res.status, code: null, message: `${documents.length} documento(s) no primeiro lote.`, documents };
}
```

- [ ] **Passo 4: Rodar e ver passar**

Rodar: `npx vitest run src/lib/nfse/proxy-check.test.ts`
Esperado: PASS (6 testes).

- [ ] **Passo 5: Commit**

```bash
git add src/lib/nfse/proxy-check.ts src/lib/nfse/proxy-check.test.ts
git commit -m "feat(procuracao): classificacao do teste de procuracao no ADN"
```

---

### Tarefa 3: Banco (duas tabelas novas)

**Arquivos:**
- Modificar: `src/db/schema/domain.ts` (depois de `nfseDfeCursors`, linha ~3583)
- Criar: `src/db/migrations/0101_procuracao.sql` (gerado e completado à mão)

- [ ] **Passo 1: Acrescentar ao schema**

Logo depois do bloco de `nfseDfeCursors`:

```ts
export const nfseCredentialMode = pgEnum("nfse_credential_mode", ["certificate", "proxy"]);
export const nfseProxyStatus = pgEnum("nfse_proxy_status", ["untested", "confirmed", "invalid", "no_emission", "technical_failure"]);

/**
 * Padrão do escritório para ler e emitir (procuração ou certificado de cada
 * empresa) e o pedido de teste de procuração para todas. Uma linha por
 * organização. Decisão de 2026-11-18.
 */
export const nfseCredentialSettings = pgTable("nfse_credential_settings", {
  orgId: text("org_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  defaultMode: nfseCredentialMode("default_mode").notNull().default("certificate"),
  proxyTestRequestedAt: timestamp("proxy_test_requested_at", { withTimezone: true }),
  updatedBy: text("updated_by").references(() => user.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Credencial de cada empresa: modo (nulo = segue o padrão), selo da
 * procuração e com qual credencial o cursor de leitura foi construído.
 */
export const nfseClientCredentials = pgTable(
  "nfse_client_credentials",
  {
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull(),
    mode: nfseCredentialMode("mode"),
    readMode: nfseCredentialMode("read_mode"),
    proxyStatus: nfseProxyStatus("proxy_status").notNull().default("untested"),
    proxyCheckedAt: timestamp("proxy_checked_at", { withTimezone: true }),
    proxyCode: varchar("proxy_code", { length: 30 }),
    proxyMessage: text("proxy_message"),
    proxyTestRequestedAt: timestamp("proxy_test_requested_at", { withTimezone: true }),
    proxySameSequence: boolean("proxy_same_sequence"),
    updatedBy: text("updated_by").references(() => user.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.clientId] }),
    foreignKey({
      name: "nfse_client_credentials_org_client_fk",
      columns: [t.orgId, t.clientId],
      foreignColumns: [clients.orgId, clients.id],
    }).onDelete("cascade"),
  ],
);
```

- [ ] **Passo 2: Gerar a migração**

Rodar: `npx drizzle-kit generate --name procuracao`
Esperado: cria `src/db/migrations/0101_procuracao.sql` com os dois enums e as duas
tabelas. Se o drizzle-kit disser "sem mudanças" (já aconteceu neste projeto), usar
`npx drizzle-kit generate --custom --name procuracao` e escrever o SQL dos enums e
tabelas à mão, igual ao padrão da `0082_nfse-xml-routine.sql`.

- [ ] **Passo 3: Acrescentar RLS e grants ao fim do SQL gerado**

```sql
--> statement-breakpoint
ALTER TABLE "nfse_credential_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "nfse_credential_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "nfse_credential_settings"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "nfse_client_credentials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "nfse_client_credentials" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "nfse_client_credentials"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
-- O guilda_app ganha tudo em tabela nova pelos default privileges: restringir
-- exige REVOKE. Configuração e credencial se ajustam, não se apagam (a
-- cascata da empresa roda como dono).
GRANT SELECT, INSERT, UPDATE ON "nfse_credential_settings" TO guilda_app;--> statement-breakpoint
REVOKE DELETE ON "nfse_credential_settings" FROM guilda_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "nfse_client_credentials" TO guilda_app;--> statement-breakpoint
REVOKE DELETE ON "nfse_client_credentials" FROM guilda_app;
```

- [ ] **Passo 4: Conferir**

Rodar: `npx drizzle-kit migrate && npm run check:rls`
Esperado: migração aplicada; "TODAS AS CHECAGENS PASSARAM", com 79 tabelas no item 1.
Se o Docker local não subir, a conferência fica para o job "Isolamento entre
organizações" do CI. Os testes com PGlite já aplicam todas as migrações.

- [ ] **Passo 5: Commit**

```bash
git add src/db/schema/domain.ts src/db/migrations/0101_procuracao.sql src/db/migrations/meta
git commit -m "feat(procuracao): tabelas do padrao do escritorio e da credencial de cada empresa"
```

---

### Tarefa 4: Repositório das credenciais

**Arquivos:**
- Criar: `src/lib/nfse/credentials-repository.ts`
- Teste: `src/lib/nfse/credentials.db.test.ts`

- [ ] **Passo 1: Escrever o teste (PGlite, como `guilda_app`)**

```ts
/**
 * Credenciais contra um Postgres de verdade (PGlite), como guilda_app: RLS,
 * modo efetivo, cursor zerado na troca e pedidos de teste.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, expect, test, vi } from "vitest";

import * as schema from "@/db/schema";

import { applyMigrations } from "./testing/pglite";

vi.mock("server-only", () => ({}));

const client = new PGlite();
const pgDb = drizzle(client, { schema });
vi.mock("@/db", () => ({ db: pgDb }));

const ORG = "orgA";
const OTHER = "orgB";
const PADARIA = "00000000-0000-4000-8000-000000000001";
const MERCADO = "00000000-0000-4000-8000-000000000002";

beforeAll(async () => {
  await applyMigrations(client);
  await client.exec(`
    INSERT INTO organization (id, name, slug, created_at) VALUES ('${ORG}', 'Escritório', 'esc', now()), ('${OTHER}', 'Outro', 'outro', now());
    INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ('u1', 'Fiscal', 'f@x', true, now(), now());
    INSERT INTO clients (id, org_id, name, tax_regime, cnpj, cnae_code) VALUES
      ('${PADARIA}', '${ORG}', 'Padaria', 'simples', '33000167000101', '6201501'),
      ('${MERCADO}', '${ORG}', 'Mercado', 'simples', '44000167000102', '4711302');
    INSERT INTO nfse_dfe_cursors (org_id, client_id, last_nsu) VALUES ('${ORG}', '${PADARIA}', 80);
  `);
  await client.exec("SET ROLE guilda_app;");
}, 120_000);

afterAll(() => client.close());

test("sem nada gravado: padrão certificado, empresa segue o padrão, selo não testado", async () => {
  const { withOrgTx } = await import("@/db/org-tx");
  const repo = await import("./credentials-repository");
  const policy = await withOrgTx(ORG, (tx) => repo.credentialPolicyIn(tx, ORG));
  expect(policy).toEqual({ defaultMode: "certificate", proxyTestRequestedAt: null });
  expect(await repo.loadClientCredential(ORG, PADARIA)).toEqual({ mode: "certificate", explicitMode: null, proxyStatus: "untested" });
});

test("trocar a credencial zera o cursor e guarda com qual credencial ele foi construído", async () => {
  const { withOrgTx } = await import("@/db/org-tx");
  const repo = await import("./credentials-repository");
  await repo.resetCursorForMode(ORG, PADARIA, "proxy", new Date("2026-11-18T12:00:00Z"));
  const [cursor] = await withOrgTx(ORG, (tx) => tx.select().from(schema.nfseDfeCursors));
  expect(cursor.lastNsu).toBe(0);
  const [credential] = await withOrgTx(ORG, (tx) => tx.select().from(schema.nfseClientCredentials));
  expect(credential).toMatchObject({ clientId: PADARIA, readMode: "proxy", mode: null });
});

test("selo da procuração e pedidos de teste: todas, uma, e limpeza só do que foi pedido antes", async () => {
  const { withOrgTx } = await import("@/db/org-tx");
  const repo = await import("./credentials-repository");
  const before = new Date("2026-11-18T12:00:00Z");
  await withOrgTx(ORG, (tx) => repo.requestProxyTestFor(tx, ORG, { clientId: null, actorId: "u1", now: before }));
  await withOrgTx(ORG, (tx) => repo.requestProxyTestFor(tx, ORG, { clientId: MERCADO, actorId: "u1", now: before }));
  const targets = await repo.listProxyTestTargets(ORG);
  expect(targets.map((t) => t.clientId).sort()).toEqual([MERCADO, PADARIA].sort());
  await repo.saveProxyStatus(ORG, PADARIA, { status: "invalid", code: "E2245", message: "Não há procuração", checkedAt: before, sameSequence: null });
  expect(await repo.loadClientCredential(ORG, PADARIA)).toMatchObject({ proxyStatus: "invalid" });
  await repo.clearProxyTestRequests(ORG, new Date("2026-11-18T12:00:01Z"));
  expect(await repo.listProxyTestTargets(ORG)).toEqual([]);
  // Outra organização não vê nada.
  expect(await withOrgTx(OTHER, (tx) => tx.select().from(schema.nfseClientCredentials))).toHaveLength(0);
});
```

A Padaria tem CNAE de serviço (6201501) e entra pelo pedido "para todas"; o Mercado tem
CNAE de comércio (4711302) e só entra pelo pedido próprio (`SERVICE_DIVISIONS` em
`src/domain/nfse-service.ts` tem a 62 e não tem a 47).

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/lib/nfse/credentials.db.test.ts`
Esperado: FAIL, módulo `./credentials-repository` não existe.

- [ ] **Passo 3: Implementar**

```ts
import "server-only";

import { and, eq, isNotNull, lte, ne, or } from "drizzle-orm";

import { withOrgTx, type OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { effectiveCredentialMode, type CredentialMode, type ProxyStatus } from "@/domain/nfse-credentials";
import { nfseIssuer } from "@/domain/nfse-service";

/**
 * Padrão do escritório, credencial de cada empresa e pedidos de teste de
 * procuração. As funções `...In`/`...For` recebem a transação de quem chama
 * (o app, dentro de asFiscalOperator); as demais abrem a sua (serviço fiscal).
 */

export interface CredentialPolicy {
  defaultMode: CredentialMode;
  proxyTestRequestedAt: Date | null;
}

export async function credentialPolicyIn(tx: OrgTx, orgId: string): Promise<CredentialPolicy> {
  const s = schema.nfseCredentialSettings;
  const [row] = await tx.select({ defaultMode: s.defaultMode, proxyTestRequestedAt: s.proxyTestRequestedAt }).from(s).where(eq(s.orgId, orgId));
  return { defaultMode: row?.defaultMode ?? "certificate", proxyTestRequestedAt: row?.proxyTestRequestedAt ?? null };
}

export interface ClientCredential {
  /** O modo que vale, já com o padrão do escritório. */
  mode: CredentialMode;
  /** O que foi marcado na empresa; null = segue o padrão. */
  explicitMode: CredentialMode | null;
  proxyStatus: ProxyStatus;
}

export async function clientCredentialIn(tx: OrgTx, orgId: string, clientId: string): Promise<ClientCredential> {
  const policy = await credentialPolicyIn(tx, orgId);
  const cc = schema.nfseClientCredentials;
  const [row] = await tx.select({ mode: cc.mode, proxyStatus: cc.proxyStatus }).from(cc).where(and(eq(cc.orgId, orgId), eq(cc.clientId, clientId)));
  return {
    mode: effectiveCredentialMode(row?.mode, policy.defaultMode),
    explicitMode: row?.mode ?? null,
    proxyStatus: row?.proxyStatus ?? "untested",
  };
}

export function loadClientCredential(orgId: string, clientId: string): Promise<ClientCredential> {
  return withOrgTx(orgId, (tx) => clientCredentialIn(tx, orgId, clientId));
}

export async function setDefaultModeIn(tx: OrgTx, orgId: string, input: { mode: CredentialMode; actorId: string; now: Date }): Promise<void> {
  const s = schema.nfseCredentialSettings;
  const values = { defaultMode: input.mode, updatedBy: input.actorId, updatedAt: input.now };
  await tx.insert(s).values({ orgId, ...values }).onConflictDoUpdate({ target: s.orgId, set: values });
}

export async function setClientModeIn(tx: OrgTx, orgId: string, input: { clientId: string; mode: CredentialMode | null; actorId: string; now: Date }): Promise<void> {
  const cc = schema.nfseClientCredentials;
  const values = { mode: input.mode, updatedBy: input.actorId, updatedAt: input.now };
  await tx.insert(cc).values({ orgId, clientId: input.clientId, ...values }).onConflictDoUpdate({ target: [cc.orgId, cc.clientId], set: values });
}

/** clientId null = todas as empresas; senão, só ela. */
export async function requestProxyTestFor(tx: OrgTx, orgId: string, input: { clientId: string | null; actorId: string; now: Date }): Promise<void> {
  if (input.clientId === null) {
    const s = schema.nfseCredentialSettings;
    await tx
      .insert(s)
      .values({ orgId, proxyTestRequestedAt: input.now, updatedBy: input.actorId, updatedAt: input.now })
      .onConflictDoUpdate({ target: s.orgId, set: { proxyTestRequestedAt: input.now } });
    return;
  }
  const cc = schema.nfseClientCredentials;
  await tx
    .insert(cc)
    .values({ orgId, clientId: input.clientId, proxyTestRequestedAt: input.now, updatedBy: input.actorId, updatedAt: input.now })
    .onConflictDoUpdate({ target: [cc.orgId, cc.clientId], set: { proxyTestRequestedAt: input.now } });
}

/** A leitura desta empresa recomeça do zero com a credencial nova. */
export async function resetCursorForMode(orgId: string, clientId: string, mode: CredentialMode, now: Date): Promise<void> {
  await withOrgTx(orgId, async (tx) => {
    const cur = schema.nfseDfeCursors;
    await tx
      .insert(cur)
      .values({ orgId, clientId, lastNsu: 0, updatedAt: now })
      .onConflictDoUpdate({ target: [cur.orgId, cur.clientId], set: { lastNsu: 0, lastError: null, updatedAt: now } });
    const cc = schema.nfseClientCredentials;
    await tx
      .insert(cc)
      .values({ orgId, clientId, readMode: mode, updatedAt: now })
      .onConflictDoUpdate({ target: [cc.orgId, cc.clientId], set: { readMode: mode, updatedAt: now } });
  });
}

export async function saveProxyStatus(
  orgId: string,
  clientId: string,
  input: { status: ProxyStatus; code: string | null; message: string | null; checkedAt: Date; sameSequence?: boolean | null },
): Promise<void> {
  const cc = schema.nfseClientCredentials;
  const values = {
    proxyStatus: input.status,
    proxyCode: input.code?.slice(0, 30) ?? null,
    proxyMessage: input.message?.slice(0, 300) ?? null,
    proxyCheckedAt: input.checkedAt,
    ...(input.sameSequence === undefined ? {} : { proxySameSequence: input.sameSequence }),
    updatedAt: input.checkedAt,
  };
  await withOrgTx(orgId, (tx) =>
    tx.insert(cc).values({ orgId, clientId, ...values }).onConflictDoUpdate({ target: [cc.orgId, cc.clientId], set: values }),
  );
}

export interface ProxyTestTarget {
  clientId: string;
  cnpj: string;
  /** NSU da nota mais antiga já guardada, para medir a sequência; null = nenhuma. */
  oldestStoredNsu: number | null;
}

/**
 * Quem testar: pedido para todas = empresas ativas, não MEI, com CNPJ, de
 * serviço (ou com procuração marcada); mais as que tiveram pedido próprio.
 */
export async function listProxyTestTargets(orgId: string): Promise<ProxyTestTarget[]> {
  return withOrgTx(orgId, async (tx) => {
    const policy = await credentialPolicyIn(tx, orgId);
    const cl = schema.clients;
    const cc = schema.nfseClientCredentials;
    const fp = schema.fiscalClientProfiles;
    const rows = await tx
      .select({ clientId: cl.id, cnpj: cl.cnpj, cnaeCode: cl.cnaeCode, applicability: fp.nfseIssuerApplicability, mode: cc.mode, requestedAt: cc.proxyTestRequestedAt })
      .from(cl)
      .leftJoin(cc, and(eq(cc.orgId, cl.orgId), eq(cc.clientId, cl.id)))
      .leftJoin(fp, and(eq(fp.orgId, cl.orgId), eq(fp.clientId, cl.id)))
      .where(and(eq(cl.orgId, orgId), eq(cl.active, true), ne(cl.taxRegime, "mei"), isNotNull(cl.cnpj)));
    const chosen = rows.filter((row) =>
      row.requestedAt !== null ||
      (policy.proxyTestRequestedAt !== null && (row.mode === "proxy" || nfseIssuer({ applicability: row.applicability, cnaeCode: row.cnaeCode }).issues === true)),
    );
    const n = schema.nfseIssuedNotes;
    const result: ProxyTestTarget[] = [];
    for (const row of chosen) {
      const [oldest] = await tx.select({ nsu: n.nsu }).from(n).where(and(eq(n.orgId, orgId), eq(n.clientId, row.clientId))).orderBy(n.nsu).limit(1);
      result.push({ clientId: row.clientId, cnpj: row.cnpj as string, oldestStoredNsu: oldest?.nsu ?? null });
    }
    return result;
  });
}

/** Limpa só os pedidos feitos até `startedAt`: pedido feito durante o teste fica para a próxima volta. */
export async function clearProxyTestRequests(orgId: string, startedAt: Date): Promise<void> {
  await withOrgTx(orgId, async (tx) => {
    const s = schema.nfseCredentialSettings;
    await tx.update(s).set({ proxyTestRequestedAt: null }).where(and(eq(s.orgId, orgId), lte(s.proxyTestRequestedAt, startedAt)));
    const cc = schema.nfseClientCredentials;
    await tx.update(cc).set({ proxyTestRequestedAt: null }).where(and(eq(cc.orgId, orgId), lte(cc.proxyTestRequestedAt, startedAt)));
  });
}

/** NSU guardado de cada chave desta empresa, para medir a sequência. */
export async function storedNsuByKey(orgId: string, clientId: string, accessKeys: readonly string[]): Promise<Map<string, number>> {
  if (accessKeys.length === 0) return new Map();
  return withOrgTx(orgId, async (tx) => {
    const n = schema.nfseIssuedNotes;
    const rows = await tx
      .select({ accessKey: n.accessKey, nsu: n.nsu })
      .from(n)
      .where(and(eq(n.orgId, orgId), eq(n.clientId, clientId), or(...accessKeys.map((key) => eq(n.accessKey, key)))));
    return new Map(rows.map((row) => [row.accessKey, row.nsu]));
  });
}
```

- [ ] **Passo 4: Rodar e ver passar**

Rodar: `npx vitest run src/lib/nfse/credentials.db.test.ts`
Esperado: PASS (3 testes).

- [ ] **Passo 5: Commit**

```bash
git add src/lib/nfse/credentials-repository.ts src/lib/nfse/credentials.db.test.ts
git commit -m "feat(procuracao): repositorio do padrao, da credencial e do teste"
```

---

### Tarefa 5: Rotina de XML pelo modo efetivo

**Arquivos:**
- Modificar: `src/lib/nfse/xml-repository.ts:120-139` (`listRoutineClients`)
- Modificar: `src/lib/nfse/xml-cycle.ts`
- Teste: `src/lib/nfse/xml.db.test.ts` (ajustar a expectativa existente) e `src/lib/nfse/xml-cycle.test.ts`

- [ ] **Passo 1: `listRoutineClients` devolve o modo efetivo**

Troque a função inteira por:

```ts
export interface RoutineClient {
  clientId: string;
  cnpj: string;
  lastNsu: number;
  historyFromNsu: number | null;
  /** Credencial que vale para esta empresa agora. */
  mode: CredentialMode;
  /** Com qual credencial o cursor foi construído; null = certificado (o de sempre). */
  readMode: CredentialMode | null;
  /** Só no modo certificado. */
  envelope: VaultEnvelope | null;
}

/**
 * Quem a rotina lê: por certificado, quem tem A1 válido e não vencido (como
 * sempre); por procuração, quem é de serviço ou tem a procuração marcada —
 * sem essa trava, virar o padrão leria também o comércio que não emite NFS-e.
 */
export async function listRoutineClients(orgId: string, now: Date): Promise<RoutineClient[]> {
  return withOrgTx(orgId, async (tx) => {
    const policy = await credentialPolicyIn(tx, orgId);
    const c = schema.nfseClientCertificates;
    const cl = schema.clients;
    const cur = schema.nfseDfeCursors;
    const cc = schema.nfseClientCredentials;
    const fp = schema.fiscalClientProfiles;
    const rows = await tx
      .select({
        clientId: cl.id,
        cnpj: cl.cnpj,
        cnaeCode: cl.cnaeCode,
        applicability: fp.nfseIssuerApplicability,
        lastNsu: cur.lastNsu,
        historyFromNsu: cur.historyNsu,
        envelope: c.envelope,
        certStatus: c.status,
        certValidUntil: c.validUntil,
        mode: cc.mode,
        readMode: cc.readMode,
      })
      .from(cl)
      .leftJoin(c, and(eq(c.orgId, cl.orgId), eq(c.clientId, cl.id)))
      .leftJoin(cur, and(eq(cur.orgId, cl.orgId), eq(cur.clientId, cl.id)))
      .leftJoin(cc, and(eq(cc.orgId, cl.orgId), eq(cc.clientId, cl.id)))
      .leftJoin(fp, and(eq(fp.orgId, cl.orgId), eq(fp.clientId, cl.id)))
      .where(and(eq(cl.orgId, orgId), eq(cl.active, true), ne(cl.taxRegime, "mei"), isNotNull(cl.cnpj)))
      .orderBy(cl.name);
    return rows.flatMap((row) => {
      const mode = effectiveCredentialMode(row.mode, policy.defaultMode);
      const base = { clientId: row.clientId, cnpj: row.cnpj as string, lastNsu: row.lastNsu ?? 0, historyFromNsu: row.historyFromNsu ?? null, mode, readMode: row.readMode ?? null };
      if (mode === "proxy") {
        const service = nfseIssuer({ applicability: row.applicability, cnaeCode: row.cnaeCode }).issues === true;
        return service || row.mode === "proxy" ? [{ ...base, envelope: null }] : [];
      }
      const valid = row.certStatus === "valid" && row.certValidUntil !== null && row.certValidUntil > now && row.envelope !== null;
      return valid ? [{ ...base, envelope: row.envelope }] : [];
    });
  });
}
```

Importações a acrescentar em `xml-repository.ts`: `credentialPolicyIn` de
`./credentials-repository`, `effectiveCredentialMode` e `type CredentialMode` de
`@/domain/nfse-credentials`, `nfseIssuer` de `@/domain/nfse-service`.

No `src/lib/nfse/xml.db.test.ts`, a expectativa do primeiro teste muda para:

```ts
expect(await repo.listRoutineClients(ORG, now)).toEqual([
  { clientId: CLIENT, cnpj: "33000167000101", lastNsu: 0, historyFromNsu: null, mode: "certificate", readMode: null, envelope: ENVELOPE },
]);
```

- [ ] **Passo 2: Escrever os testes do ciclo**

No `src/lib/nfse/xml-cycle.test.ts`, acrescente o mock do repositório novo junto dos outros:

```ts
vi.mock("./credentials-repository", () => ({
  resetCursorForMode: vi.fn(),
  saveProxyStatus: vi.fn(),
}));
```

E importe `resetCursorForMode, saveProxyStatus` de `./credentials-repository`. Nos
`mockResolvedValue` existentes de `listRoutineClients`, acrescente
`mode: "certificate", readMode: null` em cada empresa. Depois, os testes novos no
`describe("rodada da rotina de XML no serviço fiscal")`:

```ts
test("empresa por procuração lê com o A1 do escritório, sem abrir certificado, e o cursor recomeça do zero na troca", async () => {
  vi.mocked(listRoutineClients).mockResolvedValue([
    { clientId: "a", cnpj: "33000167000101", lastNsu: 50, historyFromNsu: null, mode: "proxy", readMode: null, envelope: null },
  ]);
  const urls: string[] = [];
  const real = fakeAdn();
  const office: HttpTransport = async (req) => {
    urls.push(req.url);
    return real(req);
  };

  await runXmlRoutineCycle(ORG, vault, "producao", { retryDelaysMs: [0, 0], office });

  expect(createMtlsTransport).not.toHaveBeenCalled();
  expect(resetCursorForMode).toHaveBeenCalledWith(ORG, "a", "proxy", expect.any(Date));
  // Zerado: pede depois do NSU 0, não do 50.
  expect(urls[0]).toContain("/DFe/0?lote=true&cnpjConsulta=33000167000101");
  expect(saveAdnError).not.toHaveBeenCalled();
});

test("procuração recusada (E2245) vira selo e erro da empresa", async () => {
  vi.mocked(listRoutineClients).mockResolvedValue([
    { clientId: "a", cnpj: "33000167000101", lastNsu: 0, historyFromNsu: null, mode: "proxy", readMode: "proxy", envelope: null },
  ]);
  const office: HttpTransport = async () => ({
    status: 400,
    body: Buffer.from(JSON.stringify({ StatusProcessamento: "REJEICAO", Erros: [{ Codigo: "E2245", Descricao: "Não há procuração da inscrição X para a Y" }] })),
    contentType: "application/json",
  });

  await runXmlRoutineCycle(ORG, vault, "producao", { retryDelaysMs: [0, 0], office });

  expect(resetCursorForMode).not.toHaveBeenCalled();
  expect(saveProxyStatus).toHaveBeenCalledWith(ORG, "a", expect.objectContaining({ status: "invalid", code: "E2245" }));
  expect(saveAdnError).toHaveBeenCalledWith(ORG, "a", expect.stringContaining("Procuração recusada"), expect.any(Date));
});

test("por procuração sem o A1 do escritório, a empresa fica com erro claro", async () => {
  vi.mocked(listRoutineClients).mockResolvedValue([
    { clientId: "a", cnpj: "33000167000101", lastNsu: 0, historyFromNsu: null, mode: "proxy", readMode: "proxy", envelope: null },
  ]);

  await runXmlRoutineCycle(ORG, vault, "producao", { retryDelaysMs: [0, 0], office: null });

  expect(saveAdnError).toHaveBeenCalledWith(ORG, "a", expect.stringContaining("A1 do escritório"), expect.any(Date));
});
```

- [ ] **Passo 3: Rodar e ver falhar**

Rodar: `npx vitest run src/lib/nfse/xml-cycle.test.ts`
Esperado: FAIL nos três testes novos (a opção `office` não existe).

- [ ] **Passo 4: Implementar no `xml-cycle.ts`**

Assinatura e corpo novos de `runXmlRoutineCycle` (o resto do arquivo fica igual):

```ts
export async function runXmlRoutineCycle(
  orgId: string,
  vault: VaultKey,
  environment: NfseEnvironmentName,
  options: { retryDelaysMs?: readonly number[]; office?: HttpTransport | null } = {},
): Promise<void> {
  const startedAt = new Date();
  await markXmlRoutineRun(orgId, { startedAt });
  const state = await loadXmlRoutineState(orgId);
  const listed = await listRoutineClients(orgId, startedAt);
  // Trocou de credencial desde a última leitura: recomeça do zero (decisão 4 do desenho).
  const clients = [];
  for (const client of listed) {
    if (needsCursorReset(client.readMode, client.mode)) {
      await resetCursorForMode(orgId, client.clientId, client.mode, startedAt);
      clients.push({ ...client, lastNsu: 0 });
    } else {
      clients.push(client);
    }
  }
  const byId = new Map(clients.map((client) => [client.clientId, client]));

  let current: { clientId: string; transport: HttpTransport } | null = null;
  const transportFor = (clientId: string): HttpTransport => {
    const client = byId.get(clientId);
    if (!client) throw new Error("A empresa não veio na rodada.");
    if (client.mode === "proxy") {
      if (!options.office) throw new Error("O A1 do escritório não está disponível no serviço fiscal.");
      return options.office;
    }
    if (current?.clientId === clientId) return current.transport;
    current = null;
    if (!client.envelope) throw new Error("O certificado da empresa não veio na rodada.");
    current = { clientId, transport: openClientTransport(vault, client.envelope) };
    return current.transport;
  };

  const results = await runXmlRoutine(clients, {
    keepSince: state.keepSince ? new Date(`${state.keepSince}T00:00:00-03:00`) : null,
    fetchBatch: async (client, afterNsu) => {
      try {
        return await withTransientRetry(
          () => fetchAdnBatch(transportFor(client.clientId), environment, { afterNsu, cnpj: client.cnpj }),
          { delaysMs: options.retryDelaysMs },
        );
      } catch (error) {
        if (error instanceof NfseTransientError) {
          throw new NfseTransientError(`${error.message} A próxima leitura continua de onde parou.`);
        }
        // Por procuração, recusa do ADN é a procuração: vira selo da empresa.
        if (error instanceof AdnRejectionError && byId.get(client.clientId)?.mode === "proxy") {
          const code = rejectionCode(error.message);
          await saveProxyStatus(orgId, client.clientId, { status: "invalid", code, message: error.message, checkedAt: new Date() });
          throw new AdnRejectionError(`Procuração recusada pelo Sistema Nacional${code ? ` (${code})` : ""}. Renove a procuração ou use o certificado da empresa.`);
        }
        throw error;
      }
    },
    saveProgress: (progress) => saveAdnProgress(orgId, progress, new Date()),
    saveError: (clientId, message) => saveAdnError(orgId, clientId, message, new Date()),
  });
  current = null;

  await markXmlRoutineRun(orgId, { finishedAt: new Date() });
  const failed = results.filter((result) => !result.ok).length;
  console.log(`Rotina de XML: ${clients.length} empresa(s), ${failed} com erro.`);
}
```

Importações a acrescentar: `AdnRejectionError` de `./adn-client`; `resetCursorForMode,
saveProxyStatus` de `./credentials-repository`; `needsCursorReset, rejectionCode` de
`@/domain/nfse-credentials`. A função `listRoutineClients` já não precisa do `envelopes`
antigo; apague o `Map` de envelopes.

- [ ] **Passo 5: Rodar e ver passar**

Rodar: `npx vitest run src/lib/nfse/xml-cycle.test.ts src/lib/nfse/xml.db.test.ts src/lib/nfse/xml-routine.test.ts`
Esperado: PASS em tudo.

- [ ] **Passo 6: Commit**

```bash
git add src/lib/nfse/xml-repository.ts src/lib/nfse/xml-cycle.ts src/lib/nfse/xml-cycle.test.ts src/lib/nfse/xml.db.test.ts
git commit -m "feat(procuracao): rotina de XML le por procuracao e recomeca o cursor na troca"
```

---

### Tarefa 6: Teste de procuração no serviço fiscal

**Arquivos:**
- Criar: `src/lib/nfse/proxy-test.ts`
- Teste: `src/lib/nfse/proxy-test.test.ts`

- [ ] **Passo 1: Escrever o teste**

```ts
import { beforeEach, describe, expect, test, vi } from "vitest";

import { clearProxyTestRequests, listProxyTestTargets, saveProxyStatus, storedNsuByKey } from "./credentials-repository";
import { runProxyTests } from "./proxy-test";
import type { HttpTransport } from "./sefin-client";
import { testAdnBatchBody } from "./testing/adn";
import { TEST_ACCESS_KEY, testNfseXml } from "./testing/nfse-xml";

vi.mock("server-only", () => ({}));
vi.mock("./credentials-repository", () => ({
  listProxyTestTargets: vi.fn(),
  saveProxyStatus: vi.fn(),
  clearProxyTestRequests: vi.fn(),
  storedNsuByKey: vi.fn(),
}));

const ORG = "org-1";
const PRESTADOR = "11222333000181";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("teste de procuração", () => {
  test("sem pedido, não chama o Sistema Nacional", async () => {
    vi.mocked(listProxyTestTargets).mockResolvedValue([]);
    const office = vi.fn<HttpTransport>();
    expect(await runProxyTests(ORG, office, "producao", { retryDelaysMs: [0, 0] })).toBe(0);
    expect(office).not.toHaveBeenCalled();
    expect(clearProxyTestRequests).not.toHaveBeenCalled();
  });

  test("confirma, lê a partir da nota mais antiga guardada e mede a sequência", async () => {
    vi.mocked(listProxyTestTargets).mockResolvedValue([{ clientId: "a", cnpj: PRESTADOR, oldestStoredNsu: 41 }]);
    vi.mocked(storedNsuByKey).mockResolvedValue(new Map([[TEST_ACCESS_KEY, 41]]));
    const urls: string[] = [];
    const office: HttpTransport = async (req) => {
      urls.push(req.url);
      return { status: 200, body: Buffer.from(testAdnBatchBody([{ nsu: 41, xml: testNfseXml() }])), contentType: "application/json" };
    };

    await runProxyTests(ORG, office, "producao", { retryDelaysMs: [0, 0] });

    expect(urls).toEqual([`https://adn.nfse.gov.br/contribuintes/DFe/40?lote=true&cnpjConsulta=${PRESTADOR}`]);
    expect(saveProxyStatus).toHaveBeenCalledWith(ORG, "a", expect.objectContaining({ status: "confirmed", sameSequence: true }));
    expect(clearProxyTestRequests).toHaveBeenCalledWith(ORG, expect.any(Date));
  });

  test("NSU diferente para a mesma nota fica medido como sequência diferente", async () => {
    vi.mocked(listProxyTestTargets).mockResolvedValue([{ clientId: "a", cnpj: PRESTADOR, oldestStoredNsu: 41 }]);
    vi.mocked(storedNsuByKey).mockResolvedValue(new Map([[TEST_ACCESS_KEY, 41]]));
    const office: HttpTransport = async () => ({ status: 200, body: Buffer.from(testAdnBatchBody([{ nsu: 9041, xml: testNfseXml() }])), contentType: "application/json" });
    await runProxyTests(ORG, office, "producao", { retryDelaysMs: [0, 0] });
    expect(saveProxyStatus).toHaveBeenCalledWith(ORG, "a", expect.objectContaining({ status: "confirmed", sameSequence: false }));
  });

  test("queda de rede vira falha técnica, nunca recusa", async () => {
    vi.mocked(listProxyTestTargets).mockResolvedValue([{ clientId: "a", cnpj: PRESTADOR, oldestStoredNsu: null }]);
    const { NfseTransientError } = await import("./sefin-client");
    const office: HttpTransport = async () => {
      throw new NfseTransientError("O Sistema Nacional fechou a conexão no meio do pedido (ECONNRESET).");
    };
    await runProxyTests(ORG, office, "producao", { retryDelaysMs: [0, 0] });
    expect(saveProxyStatus).toHaveBeenCalledWith(ORG, "a", expect.objectContaining({ status: "technical_failure", sameSequence: null }));
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/lib/nfse/proxy-test.test.ts`
Esperado: FAIL, módulo `./proxy-test` não existe.

- [ ] **Passo 3: Implementar**

```ts
import "server-only";

import { withTransientRetry } from "./adn-client";
import { readAdnDocument } from "./adn-documents";
import { clearProxyTestRequests, listProxyTestTargets, saveProxyStatus, storedNsuByKey } from "./credentials-repository";
import { classifyProxyResponse, proxyTestUrl, type ProxyOutcome } from "./proxy-check";
import type { HttpTransport, NfseEnvironmentName } from "./sefin-client";

/**
 * Testes de procuração pedidos na aba XML: uma leitura no ADN com o A1 do
 * escritório em nome de cada empresa. Lê a partir da nota mais antiga já
 * guardada, para medir se a sequência de NSU é a mesma da leitura com o A1 da
 * empresa (desenho de 2026-11-18). Só lê; não mexe no cursor.
 */
export async function runProxyTests(
  orgId: string,
  office: HttpTransport,
  environment: NfseEnvironmentName,
  options: { retryDelaysMs?: readonly number[] } = {},
): Promise<number> {
  const startedAt = new Date();
  const targets = await listProxyTestTargets(orgId);
  if (targets.length === 0) return 0;
  for (const target of targets) {
    const afterNsu = target.oldestStoredNsu ? target.oldestStoredNsu - 1 : 0;
    let outcome: ProxyOutcome;
    try {
      const res = await withTransientRetry(() => office({ method: "GET", url: proxyTestUrl(environment, target.cnpj, afterNsu) }), { delaysMs: options.retryDelaysMs });
      outcome = classifyProxyResponse(res);
    } catch (error) {
      outcome = { status: "technical_failure", httpStatus: null, code: null, message: error instanceof Error ? error.message : "Falha desconhecida.", documents: [] };
    }
    const sameSequence = outcome.status === "confirmed" ? await measureSequence(orgId, target.clientId, target.cnpj, outcome.documents) : null;
    await saveProxyStatus(orgId, target.clientId, { status: outcome.status, code: outcome.code, message: outcome.message, checkedAt: new Date(), sameSequence });
  }
  await clearProxyTestRequests(orgId, startedAt);
  console.log(`Teste de procuração: ${targets.length} empresa(s).`);
  return targets.length;
}

/** true/false quando alguma nota do lote já está guardada; null quando não dá para comparar. */
async function measureSequence(orgId: string, clientId: string, cnpj: string, documents: { nsu: number; xml: string }[]): Promise<boolean | null> {
  const issued = documents.flatMap((doc) => {
    const reading = readAdnDocument(doc.xml, cnpj);
    return reading.kind === "issued" ? [{ accessKey: reading.accessKey, nsu: doc.nsu }] : [];
  });
  const stored = await storedNsuByKey(orgId, clientId, issued.map((doc) => doc.accessKey));
  const compared = issued.filter((doc) => stored.has(doc.accessKey));
  if (compared.length === 0) return null;
  return compared.every((doc) => stored.get(doc.accessKey) === doc.nsu);
}
```

- [ ] **Passo 4: Rodar e ver passar**

Rodar: `npx vitest run src/lib/nfse/proxy-test.test.ts`
Esperado: PASS (4 testes).

- [ ] **Passo 5: Commit**

```bash
git add src/lib/nfse/proxy-test.ts src/lib/nfse/proxy-test.test.ts
git commit -m "feat(procuracao): teste de procuracao no servico fiscal, medindo a sequencia de NSU"
```

---

### Tarefa 7: Emissão devolve o XML da resposta

**Arquivos:**
- Modificar: `src/lib/nfse/sefin-client.ts` (`EmitResult`, `emit`, `getNfseNumber`)
- Modificar: `src/lib/nfse/processor.ts` (`NfseJobOutcome`)
- Teste: `src/lib/nfse/sefin-client.test.ts`, `src/lib/nfse/processor.test.ts`

- [ ] **Passo 1: Escrever os testes**

No `sefin-client.test.ts` (usa o `fake(responses)` que já existe no arquivo):

```ts
describe("procuração: XML da resposta e consulta por chave recusada", () => {
  test("emit devolve o XML que vem na resposta", async () => {
    const xml = "<NFSe><infNFSe><nNFSe>8</nNFSe></infNFSe></NFSe>";
    const { client } = fake([{ status: 201, body: Buffer.from(JSON.stringify({ chaveAcesso: KEY, nfseXmlGZipB64: gzipBase64(xml) })), contentType: "application/json" }]);
    expect(await client.emit("<DPS/>")).toEqual({ kind: "issued", accessKey: KEY, nfseNumber: "8", xml });
  });

  test("número da nota recusado por procuração (403) vira null, não erro", async () => {
    const { client } = fake([{ status: 403, body: Buffer.from("{}"), contentType: "application/json" }]);
    expect(await client.getNfseNumber(KEY)).toBeNull();
  });
});
```

O `fake(responses)` do arquivo já devolve `{ calls, client }`; importe `gzipBase64` de
`./xml` se o arquivo ainda não importa. No `processor.test.ts`, onde `emit` é simulado devolvendo
`{ kind: "issued", accessKey, nfseNumber }`, acrescente `xml: "<NFSe/>"` e espere
`xml: "<NFSe/>"` no desfecho de um dos testes de emissão.

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/lib/nfse/sefin-client.test.ts src/lib/nfse/processor.test.ts`
Esperado: FAIL nos dois testes novos.

- [ ] **Passo 3: Implementar**

Em `sefin-client.ts`:

```ts
export type EmitResult =
  | { kind: "issued"; accessKey: string; nfseNumber: string | null; xml: string | null }
  | { kind: "rejected"; errors: NfseApiError[] };
```

Dentro de `createSefinClient`, troque `nfseNumberFrom` e o sucesso de `emit` por:

```ts
  /** O XML da nota que vem na própria resposta; por procuração, a consulta pela chave é recusada. */
  function nfseXmlFrom(body: Record<string, unknown>): string | null {
    const xml = stringField(body, "nfseXmlGZipB64");
    return xml ? gunzipBase64(xml) : null;
  }
```

```ts
      if (res.status >= 200 && res.status < 300) {
        const accessKey = stringField(body, "chaveAcesso");
        if (!accessKey) throw new NfseTransientError("Resposta de emissão sem chave de acesso.");
        const xml = nfseXmlFrom(body);
        return { kind: "issued", accessKey, nfseNumber: xml ? firstElementText(xml, "nNFSe") : null, xml };
      }
```

E em `getNfseNumber`:

```ts
    async getNfseNumber(accessKey) {
      const res = await transport({ method: "GET", url: `${base.sefin}/nfse/${accessKey}` });
      // Por procuração o Sistema Nacional recusa a consulta pela chave (medido no Tero).
      if (res.status === 401 || res.status === 403) return null;
      if (res.status >= 200 && res.status < 300) {
        const xml = nfseXmlFrom(parseBody(res));
        return xml ? firstElementText(xml, "nNFSe") : null;
      }
      throw unexpected(res, "Consulta da nota falhou");
    },
```

Em `processor.ts`, o tipo:

```ts
  | { kind: "issued"; accessKey: string; nfseNumber: string | null; environment: 1 | 2; foundByDps?: true; xml?: string | null }
```

O `return { ...result, environment: deps.environment }` já leva o `xml` junto.

- [ ] **Passo 4: Rodar e ver passar**

Rodar: `npx vitest run src/lib/nfse`
Esperado: PASS em todos os testes da pasta.

- [ ] **Passo 5: Commit**

```bash
git add src/lib/nfse/sefin-client.ts src/lib/nfse/sefin-client.test.ts src/lib/nfse/processor.ts src/lib/nfse/processor.test.ts
git commit -m "feat(procuracao): emissao devolve o XML da resposta e aceita a consulta recusada"
```

---

### Tarefa 8: Emissão das notas dos clientes por procuração

**Arquivos:**
- Modificar: `src/lib/client-nfse/service.ts`
- Teste: `src/lib/client-nfse/client-nfse.db.test.ts`

- [ ] **Passo 1: Escrever os testes**

No fim do `client-nfse.db.test.ts`, com uma nota já na fila (os testes anteriores do
arquivo deixam notas pedidas; se a ordem mudar, peça uma com `emitClientNfseNote`
antes):

```ts
test("procuração: emite com o A1 do escritório, guarda o XML da resposta e não abre o cofre", async () => {
  const { withOrgTx } = await import("@/db/org-tx");
  const { runClientNfseQueue } = await import("./service");
  const credentials = await import("@/lib/nfse/credentials-repository");
  const { testNfseXml } = await import("@/lib/nfse/testing/nfse-xml");

  await withOrgTx(ORG, (tx) => credentials.setDefaultModeIn(tx, ORG, { mode: "proxy", actorId: "u1", now: NOW }));
  const [queued] = await withOrgTx(ORG, (tx) => tx.select().from(schema.clientNfseInvoices).where(eq(schema.clientNfseInvoices.status, "queued")));
  expect(queued).toBeDefined();
  const xml = testNfseXml();
  const emitted: string[] = [];
  const office = {
    client: {
      emit: async (signed: string) => { emitted.push(signed); return { kind: "issued" as const, accessKey: "1".repeat(50), nfseNumber: "8", xml }; },
      findAccessKeyByDps: async () => null,
      getNfseNumber: async () => null,
      cancel: async () => ({ kind: "cancelled" as const }),
      getNfseXml: async () => { throw new Error("403"); },
    },
    signingKey: TEST_SIGNING_KEY,
  };
  const vault = { keyId: "0123456789abcdef", publicKeySpki: "AAAA", open: () => { throw new Error("o cofre não deve ser aberto por procuração"); } };

  await runClientNfseQueue(ORG, vault, "restrita", office);

  const [issued] = await withOrgTx(ORG, (tx) => tx.select().from(schema.clientNfseInvoices).where(eq(schema.clientNfseInvoices.id, queued.id)));
  expect(issued).toMatchObject({ status: "issued", nfseNumber: "8" });
  expect(issued.xmlGz).not.toBeNull();
  expect(emitted).toHaveLength(1);
}, 60_000);

test("procuração: nota achada pela DPS sem XML para conferir fica com erro, nunca é adotada", async () => {
  const { withOrgTx } = await import("@/db/org-tx");
  const { runClientNfseQueue } = await import("./service");
  const month = await import("./month");

  const [issued] = await withOrgTx(ORG, (tx) => tx.select().from(schema.clientNfseInvoices).where(eq(schema.clientNfseInvoices.status, "failed")).limit(1));
  expect((await withOrgTx(ORG, (tx) => month.requeueClientNfseInvoice(tx, { ...ACTOR, invoiceId: issued.id }))).ok).toBe(true);
  const office = {
    client: {
      emit: async () => { throw new Error("não deve emitir: a DPS já existe"); },
      findAccessKeyByDps: async () => "2".repeat(50),
      getNfseNumber: async () => null,
      cancel: async () => ({ kind: "cancelled" as const }),
      getNfseXml: async () => { throw new Error("403"); },
    },
    signingKey: TEST_SIGNING_KEY,
  };
  const vault = { keyId: "0123456789abcdef", publicKeySpki: "AAAA", open: () => { throw new Error("não deve abrir"); } };

  await runClientNfseQueue(ORG, vault, "restrita", office);

  const [after] = await withOrgTx(ORG, (tx) => tx.select().from(schema.clientNfseInvoices).where(eq(schema.clientNfseInvoices.id, issued.id)));
  expect(after.status).toBe("failed");
  expect(after.accessKey).toBeNull();
  expect(after.lastError).toMatch(/Não foi possível conferir a nota achada pela DPS/);
}, 60_000);

test("procuração sem permissão de emissão vira selo da empresa", async () => {
  const { withOrgTx } = await import("@/db/org-tx");
  const { runClientNfseQueue } = await import("./service");
  const month = await import("./month");
  const credentials = await import("@/lib/nfse/credentials-repository");

  const [failed] = await withOrgTx(ORG, (tx) => tx.select().from(schema.clientNfseInvoices).where(eq(schema.clientNfseInvoices.status, "failed")).limit(1));
  expect((await withOrgTx(ORG, (tx) => month.requeueClientNfseInvoice(tx, { ...ACTOR, invoiceId: failed.id }))).ok).toBe(true);
  const office = {
    client: {
      emit: async () => ({ kind: "rejected" as const, errors: [{ code: "E2245", message: "Não há procuração da inscrição X para a Y" }] }),
      findAccessKeyByDps: async () => null,
      getNfseNumber: async () => null,
      cancel: async () => ({ kind: "cancelled" as const }),
      getNfseXml: async () => { throw new Error("403"); },
    },
    signingKey: TEST_SIGNING_KEY,
  };
  const vault = { keyId: "0123456789abcdef", publicKeySpki: "AAAA", open: () => { throw new Error("não deve abrir"); } };

  await runClientNfseQueue(ORG, vault, "restrita", office);

  expect(await credentials.loadClientCredential(ORG, failed.clientId)).toMatchObject({ mode: "proxy", proxyStatus: "no_emission" });
}, 60_000);
```

`TEST_SIGNING_KEY` vem de `@/lib/nfse/testing/certificate`: gere uma vez no topo do
arquivo com `createTestCertificate({ commonName: "ESCRITORIO:11222333000181", password: "x" })`
e use `{ privateKeyPem, certificatePem }` dele.

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/lib/client-nfse/client-nfse.db.test.ts`
Esperado: FAIL nos três testes novos (`runClientNfseQueue` não aceita o quarto argumento).

- [ ] **Passo 3: Implementar em `service.ts`**

Tipos e abertura da conexão:

```ts
/** O A1 do escritório, para emitir por procuração. Vem do serviço fiscal. */
export interface OfficeIssuer {
  client: SefinClient;
  signingKey: NfseSigningKey;
}

interface IssuerConnection {
  client: SefinClient;
  signingKey: NfseSigningKey;
  viaProxy: boolean;
}
```

No começo de `openIssuer`, antes de ler o certificado da empresa (acrescente o
parâmetro `office: OfficeIssuer | null`):

```ts
  const credential = await loadClientCredential(orgId, claim.clientId);
  if (credential.mode === "proxy") {
    const problem = proxyEmissionProblem(credential.proxyStatus);
    if (problem) return problem;
    if (!office) return "O A1 do escritório não está disponível no serviço fiscal.";
    return { client: office.client, signingKey: office.signingKey, viaProxy: true };
  }
```

E no `return` do caminho do certificado, acrescente `viaProxy: false`.

`runClientNfseQueue` ganha `office: OfficeIssuer | null = null` e passa para
`openIssuer(orgId, claim, vault, environment, office)`. O bloco depois do
`runNfseJob` vira:

```ts
      if (outcome.kind === "issued") {
        // Três fontes, nesta ordem: a resposta da emissão, a consulta pela chave
        // (recusada por procuração) e o XML que a rotina da aba XML já guardou.
        xml = outcome.xml ?? null;
        if (!xml) {
          try {
            xml = await connection.client.getNfseXml(outcome.accessKey);
          } catch {
            xml = null;
          }
        }
        if (!xml) xml = await storedNoteXml(orgId, outcome.accessKey);
        if (!outcome.nfseNumber && xml) outcome = { ...outcome, nfseNumber: firstElementText(xml, "nNFSe") };
        // A nota ACHADA pela DPS pode ser de outro sistema e precisa ser conferida.
        // Sem XML, não adota no escuro: erro, e o Tentar de novo confere depois.
        if (outcome.kind === "issued" && outcome.foundByDps && !xml) {
          outcome = {
            kind: "failed",
            message: "Não foi possível conferir a nota achada pela DPS. Tente de novo depois da próxima leitura dos XML.",
            errors: [],
          };
        }
      }
      if (outcome.kind === "issued") {
        const request = { providerCnpj: claim.providerCnpj, takerDocument: claim.takerCnpj, amountCents: claim.amountCents, requestedAt: claim.requestedAt };
        const found = xml && outcome.foundByDps ? nfseXmlMismatch(xml, request) : null;
        // ... (o resto do bloco de troca de série continua igual)
      }
      if (outcome.kind === "failed" && connection.viaProxy && isProxyAuthorizationError(outcome.errors)) {
        await saveProxyStatus(orgId, claim.clientId, { status: "no_emission", code: outcome.errors[0]?.code ?? null, message: outcome.message, checkedAt: new Date() });
      }
```

E a função auxiliar no mesmo arquivo:

```ts
/** XML que a rotina da aba XML já guardou desta nota; null = ainda não leu. */
async function storedNoteXml(orgId: string, accessKey: string): Promise<string | null> {
  const n = schema.nfseIssuedNotes;
  const [row] = await withOrgTx(orgId, (tx) => tx.select({ xmlGz: n.xmlGz }).from(n).where(and(eq(n.orgId, orgId), eq(n.accessKey, accessKey))));
  return row ? gunzipSync(Buffer.from(row.xmlGz)).toString("utf8") : null;
}
```

Importações: `loadClientCredential, saveProxyStatus` de
`@/lib/nfse/credentials-repository`; `isProxyAuthorizationError, proxyEmissionProblem`
de `@/domain/nfse-credentials`.

Atenção a quem executa: `connection` é `IssuerConnection | string`; os acessos a
`connection.viaProxy` e `connection.client` ficam dentro do `else` em que ela já é
`IssuerConnection`, como o código atual.

- [ ] **Passo 4: Rodar e ver passar**

Rodar: `npx vitest run src/lib/client-nfse`
Esperado: PASS em todos.

- [ ] **Passo 5: Commit**

```bash
git add src/lib/client-nfse/service.ts src/lib/client-nfse/client-nfse.db.test.ts
git commit -m "feat(procuracao): notas dos clientes emitem com o A1 do escritorio e a conferencia nao se pula"
```

---

### Tarefa 9: Prontidão do emissor e releitura do histórico pelo modo efetivo

**Arquivos:**
- Modificar: `src/lib/client-nfse/month.ts:88-147` (`loadIssuerReadiness`)
- Modificar: `src/lib/client-nfse/loaders.ts` (`canReadHistory` e o cartão do emissor)
- Teste: `src/lib/client-nfse/client-nfse.db.test.ts`

- [ ] **Passo 1: Escrever o teste**

```ts
test("procuração: emissor sem certificado fica pronto; procuração recusada bloqueia com o motivo", async () => {
  const { withOrgTx } = await import("@/db/org-tx");
  const month = await import("./month");
  const credentials = await import("@/lib/nfse/credentials-repository");

  await withOrgTx(ORG, (tx) => credentials.setDefaultModeIn(tx, ORG, { mode: "proxy", actorId: "u1", now: NOW }));
  const readiness = await withOrgTx(ORG, (tx) => month.loadIssuerReadiness(tx, { orgId: ORG, now: NOW }));
  const mercado = [...readiness.values()].find((row) => row.clientId === MERCADO)!;
  expect(mercado.problem).toBeNull();

  await credentials.saveProxyStatus(ORG, MERCADO, { status: "invalid", code: "E2245", message: "x", checkedAt: NOW });
  const after = await withOrgTx(ORG, (tx) => month.loadIssuerReadiness(tx, { orgId: ORG, now: NOW }));
  expect([...after.values()].find((row) => row.clientId === MERCADO)!.problem).toMatch(/Procuração recusada/);

  await withOrgTx(ORG, (tx) => credentials.setDefaultModeIn(tx, ORG, { mode: "certificate", actorId: "u1", now: NOW }));
}, 60_000);
```

(`MERCADO` é emissor nos dados do arquivo: o `beforeAll` cadastra a ACADEMIA e o MERCADO
em `client_nfse_issuers`.)

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/lib/client-nfse/client-nfse.db.test.ts -t "emissor sem certificado"`
Esperado: FAIL (o problema diz "Sem certificado A1").

- [ ] **Passo 3: Implementar**

Em `loadIssuerReadiness`, acrescente ao `select` o modo e o selo da credencial e o
padrão do escritório:

```ts
  const policy = await credentialPolicyIn(tx, input.orgId);
  const cc = schema.nfseClientCredentials;
```

No `select`: `credentialMode: cc.mode, proxyStatus: cc.proxyStatus`. No `from`:
`.leftJoin(cc, and(eq(cc.orgId, i.orgId), eq(cc.clientId, i.clientId)))`.

Troque a cascata das mensagens de certificado por uma função e a escolha pelo modo:

```ts
function certificateProblem(row: { certStatus: string | null; certCnpj: string | null; cnpj: string | null; certValidUntil: Date | null }, now: Date): string | null {
  if (!row.certStatus) return "Sem certificado A1. Envie o certificado nesta empresa.";
  if (row.certStatus === "pending") return "Certificado ainda em conferência.";
  if (row.certStatus !== "valid" || row.certCnpj !== row.cnpj) return "Certificado com problema. Troque o certificado nesta empresa.";
  if (row.certValidUntil && row.certValidUntil <= now) return "Certificado vencido.";
  return null;
}
```

```ts
    const mode = effectiveCredentialMode(row.credentialMode, policy.defaultMode);
    const credentialProblem = mode === "proxy" ? proxyEmissionProblem(row.proxyStatus ?? "untested") : certificateProblem(row, input.now);
    const problem = !row.issuerActive
      ? "Empresa desativada nas Notas dos clientes."
      : !row.clientActive
        ? "Empresa inativa no cadastro."
        : row.taxRegime === "mei"
          ? "MEI não emite por aqui."
          : !row.cnpj
            ? "Empresa sem CNPJ no cadastro."
            : !template
              ? `Modelo fiscal incompleto: ${parsed.error?.issues[0]?.message ?? "revise o cadastro"}`
              : credentialProblem;
```

Em `loaders.ts`:
- `canReadHistory`: troque `certificate?.status === "valid"` por
  `credential.mode === "proxy" ? credential.proxyStatus !== "invalid" : certificate?.status === "valid"`,
  com `const credential = await clientCredentialIn(tx, input.orgId, issuer.clientId)`
  (use o `clientId` do emissor que a função já carrega).
- No cartão do emissor (`ClientNfseIssuerView`), acrescente
  `credential: { mode: CredentialMode; proxyStatus: ProxyStatus }`. Para preencher,
  carregue `credentialPolicyIn` uma vez e as linhas de `nfseClientCredentials` da
  organização num `Map` por `clientId`, como já é feito com os certificados.

- [ ] **Passo 4: Rodar e ver passar**

Rodar: `npx vitest run src/lib/client-nfse`
Esperado: PASS.

- [ ] **Passo 5: Commit**

```bash
git add src/lib/client-nfse/month.ts src/lib/client-nfse/loaders.ts src/lib/client-nfse/client-nfse.db.test.ts
git commit -m "feat(procuracao): emissor pronto pela procuracao e releitura do historico sem certificado"
```

---

### Tarefa 10: Serviço fiscal entrega o A1 do escritório

**Arquivos:**
- Modificar: `scripts/fiscal-service.ts`

- [ ] **Passo 1: Implementar**

Em `main()`, crie o transporte do escritório uma vez e reaproveite no cliente:

```ts
  const officeTransport = certificate
    ? createMtlsTransport({ privateKeyPem: certificate.privateKeyPem, chainPem: certificate.chainPem })
    : null;
  const client = certificate && officeTransport ? createSefinClient(environment, officeTransport) : null;
  const office = certificate && client
    ? { client, signingKey: { privateKeyPem: certificate.privateKeyPem, certificatePem: certificate.certificatePem } }
    : null;
```

Dentro do laço, no ramo `else if (client && !certificateError)`, antes do bloco do cofre:

```ts
          if (officeTransport) {
            try {
              await runProxyTests(orgId, officeTransport, environment);
            } catch {
              console.error("Falha no teste de procuração; nova tentativa no próximo ciclo.");
            }
          }
```

E troque as duas chamadas:

```ts
                void runXmlRoutineCycle(orgId, vault, environment, { office: officeTransport })
```

```ts
              await runClientNfseQueue(orgId, vault, environment, office);
```

Importe `runProxyTests` de `../src/lib/nfse/proxy-test`.

- [ ] **Passo 2: Conferir tipos**

Rodar: `npx tsc --noEmit`
Esperado: sem erros.

- [ ] **Passo 3: Commit**

```bash
git add scripts/fiscal-service.ts
git commit -m "feat(procuracao): servico fiscal entrega o A1 do escritorio a leitura, emissao e teste"
```

---

### Tarefa 11: Ações do app

**Arquivos:**
- Modificar: `src/lib/office-fees/fiscal-operator.ts`
- Modificar: `src/app/(app)/clans/[id]/nfse-xml-actions.ts`

- [ ] **Passo 1: Mensagem própria para ação de admin**

Em `asFiscalOperator`, troque a opção por:

```ts
  options: { adminOnly?: boolean; adminOnlyMessage?: string } = {},
```

```ts
  if (options.adminOnly && !isAdminRole(ctx.role)) return err(options.adminOnlyMessage ?? "Só admins configuram o modelo da nota.");
```

- [ ] **Passo 2: Ações novas no fim de `nfse-xml-actions.ts`**

```ts
const modeSchema = z.enum(CREDENTIAL_MODES);

/** Padrão do escritório para ler e emitir. Só admin. */
export async function setDefaultCredentialMode(input: { clanId: string; mode: CredentialMode }): Promise<ActionResult<null>> {
  const parsed = z.object({ clanId: z.uuid("Clã inválido."), mode: modeSchema }).safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Pedido inválido.");
  const result = await asFiscalOperator(
    parsed.data.clanId,
    async (tx, ctx) => {
      await setDefaultModeIn(tx, ctx.orgId, { mode: parsed.data.mode, actorId: ctx.userId, now: new Date() });
      return { ok: true, data: null };
    },
    { adminOnly: true, adminOnlyMessage: "Só admins mudam o padrão do escritório." },
  );
  if (result.ok) revalidateClan();
  return result;
}

/** Exceção da empresa: procuração, certificado ou null (segue o padrão). */
export async function setClientCredentialMode(input: z.input<typeof clientSchema> & { mode: CredentialMode | null }): Promise<ActionResult<null>> {
  const parsed = clientSchema.extend({ mode: modeSchema.nullable() }).safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Pedido inválido.");
  const { clanId, clientId, mode } = parsed.data;
  const result = await asFiscalOperator(clanId, async (tx, ctx) => {
    const [company] = await tx
      .select({ taxRegime: schema.clients.taxRegime })
      .from(schema.clients)
      .where(and(eq(schema.clients.orgId, ctx.orgId), eq(schema.clients.id, clientId)));
    if (!company) return err("Empresa não encontrada.");
    if (company.taxRegime === "mei") return err("Empresas MEI são controladas na aba MEI.");
    await setClientModeIn(tx, ctx.orgId, { clientId, mode, actorId: ctx.userId, now: new Date() });
    return { ok: true, data: null };
  });
  if (result.ok) revalidateClan();
  return result;
}

/** Pede o teste de procuração: sem clientId, para todas as empresas de serviço. */
export async function requestProxyTest(input: { clanId: string; clientId?: string }): Promise<ActionResult<null>> {
  const parsed = z.object({ clanId: z.uuid("Clã inválido."), clientId: z.uuid("Empresa inválida.").optional() }).safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Pedido inválido.");
  const result = await asFiscalOperator(parsed.data.clanId, async (tx, ctx) => {
    await requestProxyTestFor(tx, ctx.orgId, { clientId: parsed.data.clientId ?? null, actorId: ctx.userId, now: new Date() });
    return { ok: true, data: null };
  });
  if (result.ok) revalidateClan();
  return result;
}
```

Importações: `CREDENTIAL_MODES, type CredentialMode` de `@/domain/nfse-credentials`;
`requestProxyTestFor, setClientModeIn, setDefaultModeIn` de
`@/lib/nfse/credentials-repository`.

- [ ] **Passo 3: Conferir tipos e lint**

Rodar: `npx tsc --noEmit && npx eslint "src/app/(app)/clans/[id]/nfse-xml-actions.ts" src/lib/office-fees/fiscal-operator.ts`
Esperado: sem erros.

- [ ] **Passo 4: Commit**

```bash
git add src/lib/office-fees/fiscal-operator.ts "src/app/(app)/clans/[id]/nfse-xml-actions.ts"
git commit -m "feat(procuracao): acoes do padrao do escritorio, da excecao e do teste"
```

---

### Tarefa 12: Visões da aba XML com a credencial

**Arquivos:**
- Modificar: `src/lib/nfse/xml-requests.ts`

- [ ] **Passo 1: Implementar**

Acrescente a visão do painel e o campo por empresa:

```ts
export interface XmlCredentialsView {
  defaultMode: CredentialMode;
  testRequested: boolean;
  /** A1 do escritório, como o serviço fiscal registrou na última volta. */
  office: { validUntil: string | null; error: string | null };
}

export async function loadXmlCredentialsView(tx: OrgTx, orgId: string): Promise<XmlCredentialsView> {
  const policy = await credentialPolicyIn(tx, orgId);
  const s = schema.nfseSettings;
  const [settings] = await tx.select({ validUntil: s.certificateValidUntil, error: s.serviceError }).from(s).where(eq(s.orgId, orgId));
  const cc = schema.nfseClientCredentials;
  const [pending] = await tx.select({ id: cc.clientId }).from(cc).where(and(eq(cc.orgId, orgId), isNotNull(cc.proxyTestRequestedAt))).limit(1);
  return {
    defaultMode: policy.defaultMode,
    testRequested: policy.proxyTestRequestedAt !== null || Boolean(pending),
    office: { validUntil: settings?.validUntil?.toISOString() ?? null, error: settings?.error ?? null },
  };
}
```

Em `XmlCompanyView`, acrescente:

```ts
  credential: {
    mode: CredentialMode;
    explicitMode: CredentialMode | null;
    proxyStatus: ProxyStatus;
    proxyCheckedAt: string | null;
    proxyMessage: string | null;
    testRequested: boolean;
  };
```

Em `loadXmlCompanies`, carregue a política e as credenciais uma vez:

```ts
  const policy = await credentialPolicyIn(tx, input.orgId);
  const cc = schema.nfseClientCredentials;
  const credentials = new Map(
    (await tx.select().from(cc).where(eq(cc.orgId, input.orgId))).map((row) => [row.clientId, row]),
  );
```

E no `map` final:

```ts
      credential: (() => {
        const saved = credentials.get(row.clientId);
        return {
          mode: effectiveCredentialMode(saved?.mode, policy.defaultMode),
          explicitMode: saved?.mode ?? null,
          proxyStatus: saved?.proxyStatus ?? "untested",
          proxyCheckedAt: saved?.proxyCheckedAt?.toISOString() ?? null,
          proxyMessage: saved?.proxyMessage ?? null,
          testRequested: Boolean(saved?.proxyTestRequestedAt),
        };
      })(),
```

(`row` aqui é a linha da empresa no `map` que já existe em `loadXmlCompanies`.)

- [ ] **Passo 2: Conferir tipos**

Rodar: `npx tsc --noEmit`
Esperado: erro só em `xml-notes-board.tsx`/`xml-notes-tab.tsx`, que a Tarefa 13 resolve.

- [ ] **Passo 3: Commit junto com a Tarefa 13** (as duas mudam o contrato da tela).

---

### Tarefa 13: Tela da aba XML

**Arquivos:**
- Criar: `src/app/(app)/clans/[id]/xml-credentials.tsx`
- Modificar: `src/app/(app)/clans/[id]/xml-notes-tab.tsx`, `xml-notes-board.tsx`, `page.tsx`

- [ ] **Passo 1: Componentes novos (`xml-credentials.tsx`)**

```tsx
"use client";

import { KeyRound, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { CREDENTIAL_MODE_LABELS, PROXY_STATUS_LABELS, type CredentialMode } from "@/domain/nfse-credentials";
import type { XmlCompanyView, XmlCredentialsView } from "@/lib/nfse/xml-requests";
import { cn } from "@/lib/utils";

import { requestProxyTest, setClientCredentialMode, setDefaultCredentialMode } from "./nfse-xml-actions";

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

/** Passo "Credenciais": padrão do escritório, A1 do escritório e o teste em lote. */
export function CredentialsPanel({
  clanId,
  credentials,
  companies,
  isAdmin,
  canManage,
}: {
  clanId: string;
  credentials: XmlCredentialsView;
  companies: readonly XmlCompanyView[];
  isAdmin: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const counts = { confirmed: 0, invalid: 0, no_emission: 0, untested: 0, technical_failure: 0 };
  for (const company of companies) counts[company.credential.proxyStatus] += 1;

  function run(action: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error ?? "Não foi possível.");
        return;
      }
      toast.success(success);
      router.refresh();
    });
  }

  return (
    <section className="grid gap-3 rounded-md border bg-card/40 p-4" aria-label="Credenciais">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2"><KeyRound className="size-4 text-primary" aria-hidden /> Credenciais</h3>
        {credentials.office.error ? (
          <span className="text-sm text-destructive">A1 do escritório: {credentials.office.error}</span>
        ) : credentials.office.validUntil ? (
          <span className="text-sm text-muted-foreground">A1 do escritório válido até {dateLabel(credentials.office.validUntil)}</span>
        ) : (
          <span className="text-sm text-warning">O serviço fiscal ainda não informou o A1 do escritório.</span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Ler e emitir por</span>
        <span className="inline-flex border border-border/70" role="group" aria-label="Padrão do escritório">
          {(["proxy", "certificate"] as const).map((mode) => {
            const selected = credentials.defaultMode === mode;
            return (
              <button
                key={mode}
                type="button"
                aria-pressed={selected}
                disabled={!isAdmin || pending || selected}
                onClick={() => run(() => setDefaultCredentialMode({ clanId, mode }), `Padrão do escritório: ${CREDENTIAL_MODE_LABELS[mode]}.`)}
                className={cn(
                  "touch-target min-h-9 px-3 transition-colors hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default",
                  mode === "proxy" && "border-r border-border/70",
                  selected && "bg-primary/10 text-primary",
                )}
              >
                {mode === "proxy" ? "Procuração" : "Certificado de cada empresa"}
              </button>
            );
          })}
        </span>
        {!isAdmin ? <span className="text-xs text-muted-foreground">(só admins mudam o padrão)</span> : null}
      </div>
      <p className="font-mono text-xs tabular-nums text-muted-foreground">
        {counts.confirmed} confirmada(s) · {counts.invalid + counts.no_emission} recusada(s) · {counts.untested} não testada(s) · {counts.technical_failure} com falha no teste
      </p>
      {canManage ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={pending || credentials.testRequested} onClick={() => run(() => requestProxyTest({ clanId }), "Teste pedido. O serviço fiscal testa na próxima volta.")}>
            <RefreshCw className={cn(credentials.testRequested && "animate-spin")} aria-hidden />
            {credentials.testRequested ? "Testando a procuração…" : "Testar procuração de todas"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/** Selo da procuração na linha da empresa, com "Testar" desta. */
export function ProxyStatusLine({ clanId, company, canManage }: { clanId: string; company: XmlCompanyView; canManage: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { proxyStatus, proxyCheckedAt, proxyMessage, testRequested } = company.credential;
  const tone = proxyStatus === "confirmed" ? "text-success" : proxyStatus === "invalid" || proxyStatus === "no_emission" ? "text-destructive" : "text-muted-foreground";
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className={tone} title={proxyMessage ?? undefined}>
        {PROXY_STATUS_LABELS[proxyStatus]}
        {proxyCheckedAt ? ` · ${dateLabel(proxyCheckedAt)}` : ""}
      </span>
      {canManage ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending || testRequested}
          onClick={() =>
            startTransition(async () => {
              const result = await requestProxyTest({ clanId, clientId: company.clientId });
              if (!result.ok) {
                toast.error(result.error);
                return;
              }
              router.refresh();
            })
          }
        >
          {testRequested ? "Testando…" : "Testar"}
        </Button>
      ) : null}
    </span>
  );
}

/** "Padrão · Procuração · Certificado da empresa" no detalhe da linha. */
export function CredentialModeField({ clanId, company, canManage }: { clanId: string; company: XmlCompanyView; canManage: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const options: { value: CredentialMode | null; label: string }[] = [
    { value: null, label: "Padrão" },
    { value: "proxy", label: "Procuração" },
    { value: "certificate", label: "Certificado da empresa" },
  ];
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">Ler e emitir por</span>
      {canManage ? (
        <span className="inline-flex border border-border/70" role="group" aria-label={`Credencial de ${company.name}`}>
          {options.map((option, index) => {
            const selected = company.credential.explicitMode === option.value;
            return (
              <button
                key={option.label}
                type="button"
                aria-pressed={selected}
                disabled={pending || selected}
                onClick={() =>
                  startTransition(async () => {
                    const result = await setClientCredentialMode({ clanId, clientId: company.clientId, mode: option.value });
                    if (!result.ok) {
                      toast.error(result.error);
                      return;
                    }
                    toast.success(`${company.name}: ${option.label.toLowerCase()}. A leitura dela recomeça do zero na próxima rodada.`);
                    router.refresh();
                  })
                }
                className={cn(
                  "touch-target min-h-8 px-2.5 transition-colors hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default",
                  index < options.length - 1 && "border-r border-border/70",
                  selected && "bg-primary/10 text-primary",
                )}
              >
                {option.label}
              </button>
            );
          })}
        </span>
      ) : (
        <span>{company.credential.explicitMode ? CREDENTIAL_MODE_LABELS[company.credential.explicitMode] : "Padrão"}</span>
      )}
      <span className="text-muted-foreground">(vale agora: {CREDENTIAL_MODE_LABELS[company.credential.mode]})</span>
    </span>
  );
}
```

- [ ] **Passo 2: Ligar no `xml-notes-tab.tsx` e no `page.tsx`**

`XmlNotesTab` ganha `isAdmin: boolean`, carrega
`credentials: await loadXmlCredentialsView(tx, orgId)` junto do resto e passa
`credentials` e `isAdmin` ao `XmlNotesBoard`. Em `page.tsx`, no `<XmlNotesTab …/>`,
acrescente `isAdmin={isAdminRole(role)}` (como já é feito no `OfficeFeeTab`).

- [ ] **Passo 3: Mudanças no `xml-notes-board.tsx`**

1. Props: `credentials: XmlCredentialsView` e `isAdmin: boolean`.
2. `SyncStatus` mostra a leitura também por procuração. Troque a primeira linha por:
   ```tsx
   const { state } = stateOf(company.certificate, now);
   const canRead = company.credential.mode === "proxy" ? company.credential.proxyStatus !== "invalid" : state === "valid" || state === "expiring";
   if (!canRead) return null;
   ```
3. "Com problema" inclui a procuração recusada:
   ```tsx
   const proxyRefused = company.credential.mode === "proxy" && (company.credential.proxyStatus === "invalid" || company.credential.proxyStatus === "no_emission");
   return (company.credential.mode === "certificate" && (state === "invalid" || state === "expired")) || proxyRefused || Boolean(company.sync?.lastError);
   ```
4. O filtro `missing` vira "Sem credencial":
   ```tsx
   const missingCredential = (company: XmlCompanyView) =>
     company.credential.mode === "proxy" ? company.credential.proxyStatus === "invalid" : !company.certificate;
   ```
   e use `missingCredential(company)` nos dois lugares em que hoje está
   `!company.certificate`. O rótulo do filtro passa a `"Sem credencial"`.
5. O primeiro passo vira "Credenciais":
   ```tsx
   {
     key: "certificates",
     label: "Credenciais",
     detail: credentials.defaultMode === "proxy"
       ? `${serviceCompanies.filter((c) => c.credential.proxyStatus === "confirmed").length} de ${serviceCompanies.length} com procuração confirmada`
       : `${ready} de ${serviceCompanies.length} certificados prontos${summary.pending > 0 ? ` · ${summary.pending} conferindo` : ""}`,
     done: credentials.defaultMode === "proxy"
       ? serviceCompanies.length > 0 && serviceCompanies.every((c) => c.credential.mode !== "proxy" || c.credential.proxyStatus === "confirmed")
       : ready > 0 && ready === serviceCompanies.length && summary.pending === 0,
   },
   ```
6. Logo depois da lista de passos (`</ol>`), o painel:
   ```tsx
   <CredentialsPanel clanId={clanId} credentials={credentials} companies={serviceCompanies} isAdmin={isAdmin} canManage={canManage} />
   ```
7. Na linha da empresa, troque `<span><CertificateStatus …/></span>` por:
   ```tsx
   <span>{company.credential.mode === "proxy" ? <ProxyStatusLine clanId={clanId} company={company} canManage={canManage} /> : <CertificateStatus certificate={company.certificate} now={now} />}</span>
   ```
8. No `<details>` da linha, antes do `ServiceToggle`:
   `<CredentialModeField clanId={clanId} company={company} canManage={canManage} />`.
   O resumo do `<summary>` passa a "Cadastro, credencial e código Domínio".
9. `useXmlAutoRefresh(running || checking || credentials.testRequested)`: a tela se
   atualiza sozinha enquanto o teste roda.

Importações: `CredentialsPanel, CredentialModeField, ProxyStatusLine` de
`./xml-credentials`; `type XmlCredentialsView` de `@/lib/nfse/xml-requests`.

- [ ] **Passo 4: Conferir**

Rodar: `npx tsc --noEmit && npx eslint "src/app/(app)/clans/[id]" src/lib/nfse`
Esperado: sem erros.

- [ ] **Passo 5: Conferir renderizado (regra do projeto: tela nova só sobe medida)**

Com o banco local de pé: `npm run build`, `guilda-prod` pelo `preview_start` e login
de demonstração. Na aba XML do Fiscal, confira no desktop e a 375 px:
- o painel Credenciais;
- o padrão alternando (só admin);
- "Testar procuração de todas" mudando para "Testando…";
- a linha de uma empresa por procuração com o selo;
- o detalhe com "Ler e emitir por";
- o filtro "Sem credencial";
- nenhuma largura vazando no celular.

Se o Docker não subir, registre que a conferência visual fica para a homologação.

- [ ] **Passo 6: Commit (com a Tarefa 12)**

```bash
git add src/lib/nfse/xml-requests.ts "src/app/(app)/clans/[id]/xml-credentials.tsx" "src/app/(app)/clans/[id]/xml-notes-board.tsx" "src/app/(app)/clans/[id]/xml-notes-tab.tsx" "src/app/(app)/clans/[id]/page.tsx"
git commit -m "feat(procuracao): passo Credenciais na aba XML, selo por empresa e teste em lote"
```

---

### Tarefa 14: "Emite por" nas Notas dos clientes

**Arquivos:**
- Modificar: `src/app/(app)/clans/[id]/client-nfse-workspace.tsx:249-252`

- [ ] **Passo 1: Implementar**

No bloco de botões do cartão (onde está `ClientCertificateDialog`), antes dos botões:

```tsx
<span className="self-center text-xs text-muted-foreground">
  Emite por {issuer.credential.mode === "proxy" ? `procuração (${PROXY_STATUS_LABELS[issuer.credential.proxyStatus].replace(/^Procuração /, "")})` : "certificado da empresa"}
</span>
```

E o `ClientCertificateDialog` só aparece quando `issuer.credential.mode === "certificate"`;
por procuração o certificado da empresa não é usado e o botão confundiria. Importe
`PROXY_STATUS_LABELS` de `@/domain/nfse-credentials`.

- [ ] **Passo 2: Conferir**

Rodar: `npx tsc --noEmit && npx eslint "src/app/(app)/clans/[id]/client-nfse-workspace.tsx"`
Esperado: sem erros.

- [ ] **Passo 3: Commit**

```bash
git add "src/app/(app)/clans/[id]/client-nfse-workspace.tsx"
git commit -m "feat(procuracao): cartao da empresa diz por qual credencial ela emite"
```

---

### Tarefa 15: Registro e verificação final

**Arquivos:**
- Modificar: `CLAUDE.md` (seção "XML das NFS-e prestadas das empresas")

- [ ] **Passo 1: Registrar a decisão no `CLAUDE.md`**, logo depois do parágrafo do NSU:

```markdown
**Procuração (2026-11-18)**: a aba XML e as Notas dos clientes leem e emitem pelo A1
do escritório (o mesmo do `guilda-fiscal`, dos honorários) ou pelo A1 de cada empresa.
O escritório tem um padrão (`nfse_credential_settings`, só admin muda) e a empresa
pode ser exceção (`nfse_client_credentials.mode`; nulo segue o padrão). Sem troca
silenciosa: procuração recusada vira selo e erro na empresa. Trocar a credencial zera
o cursor (`read_mode`), porque não está medido que a sequência de NSU é a mesma; o
teste de procuração mede (`proxy_same_sequence`). Por procuração, a consulta da nota
pela chave é recusada: o XML vem da resposta da emissão, e a nota achada pela DPS sem
XML para conferir vira erro, nunca adoção. Desenho em
`docs/superpowers/specs/2026-11-18-procuracao-design.md`.
```

- [ ] **Passo 2: Verificação completa**

Rodar, nesta ordem:
- `npx vitest run --maxWorkers=1`: esperado, todos passando.
- `npx tsc --noEmit`: sem erros.
- `npm run lint`: sem erros (o aviso do `.tmp` não conta).
- `npm run build`: sucesso. Se der `EPERM` no `.next`, apague a pasta `.next` e repita.
- `npm run check:rls` (com o banco local): "TODAS AS CHECAGENS PASSARAM".

- [ ] **Passo 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: decisao da procuracao no CLAUDE.md"
```

---

## Implantação (com o Bruno, depois do código)

1. Push na `develop`, CI verde (incluindo "Isolamento entre organizações") e release para
   a produção com o padrão em "Certificado": nada muda.
2. O Bruno clica em "Testar procuração de todas" na aba XML e confere os selos.
3. Conferir `proxy_same_sequence` das empresas confirmadas e registrar o resultado no
   Cerebro e no Tero.
4. O Bruno vira o padrão para "Procuração". As empresas sem procuração viram exceção ou
   recebem a procuração; as que trocaram de credencial releem do zero uma vez.
5. Primeira emissão real por procuração: uma nota de uma empresa só.
