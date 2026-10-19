# XML das NFS-e prestadas — plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development
> (recomendado) ou superpowers:executing-plans para executar este plano tarefa a
> tarefa. Os passos usam caixas (`- [ ]`) para acompanhamento.

**Objetivo:** a Guilda guarda sozinha, numa pasta por empresa e por mês, os XML
das NFS-e que cada empresa-cliente emitiu, lidos do Sistema Nacional com o
certificado A1 da própria empresa, por uma rotina configurável.

**Arquitetura:** o Fiscal envia o certificado A1 da empresa cifrado no navegador
com a chave pública do serviço fiscal (`guilda-fiscal`); o banco guarda só o
envelope. O serviço fiscal abre o envelope, confere o certificado e, quando a
rotina está na hora, lê a distribuição do ADN (`GET /contribuintes/DFe/{NSU}`)
de cada empresa e grava as notas prestadas (XML compactado) e os
cancelamentos. O app lê do banco para mostrar contagens e montar os downloads
(.zip ou XML único). O app nunca vê certificado nem senha.

**Stack:** Next.js 16 (App Router, Server Actions), Drizzle + Postgres com RLS
(`withOrgTx`), Zod 4, Vitest, PGlite para testes de banco, node-forge (PKCS#12),
WebCrypto (navegador) + `node:crypto` (serviço), fflate (zip).

**Desenho aprovado:** `docs/superpowers/specs/2026-10-19-xml-nfse-prestadas-design.md`.
Leia antes de começar. Leia também o `CLAUDE.md` do projeto (regras
inegociáveis, seção "Notas de honorário pela API nacional") e
`docs/design-system.md` antes de qualquer tela.

---

## Regras para quem executa (valem para todo agente)

1. **Git:** todo trabalho vai para a branch `develop`, sem branch nem PR. A
   `main` é produção e **só recebe PR aprovado pelo Bruno** ("pode mesclar"):
   nenhum agente mescla na `main` nem dispara deploy de produção. Commits em
   português sem acento, terminando com a linha
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
2. **Antes de cada push:** `npx tsc --noEmit -p .`, `npm run lint`,
   `npx vitest run` e `npm run build` limpos. Commit só se o build passar. O
   build no OneDrive às vezes falha com EPERM ou código 134 transitório: apague
   `.next` (`rm -rf .next`) e rode de novo antes de concluir que quebrou.
3. **Máquina com pouca memória** (às vezes < 200 MB livres): rode **um comando
   pesado por vez** (tsc, lint, vitest completo, build). Nunca dois agentes
   rodando build/teste ao mesmo tempo. Prefira `npx vitest run <arquivo>`
   durante o desenvolvimento.
4. **Segredos:** nenhum agente gera, pede, lê ou imprime certificado real,
   senha, `NFSE_VAULT_PRIVATE_KEY` de produção ou `FISCAL_SERVICE_TOKEN`. Esses
   passos são do Bruno. Testes usam `createTestCertificate()` e chaves geradas
   no próprio teste. Nenhum log imprime envelope, senha, certificado ou XML.
5. **Banco:** toda tabela de domínio tem `org_id`, RLS (`ENABLE` + `FORCE` +
   política `org_isolation`) e passa por `withOrgTx`. O `guilda_app` ganha
   privilégio total em tabela nova pelos default privileges: **restringir exige
   REVOKE**. `drizzle-kit generate` às vezes diz "sem mudanças" errado: confira
   o SQL gerado.
6. **Saída do `rtk`:** o hook reescreve comandos e filtra saída (esconde commits
   de merge no `git log`). Para ver a saída crua, use `rtk proxy <comando>`.
7. **Tela nova só sobe depois de medida renderizada** (celular e desktop). Se
   o agente não tiver navegador, ele registra a verificação visual como
   pendência para o Claude principal, que confere na homologação.
8. Comentários e textos de UI em português, no tom do código existente.

---

## Mapa de arquivos

Criar:

- `src/lib/nfse/xml-dom.ts` — helpers de leitura de XML (extraídos de `danfse-data.ts`).
- `src/domain/nfse-xml.ts` (+ `.test.ts`) — regras puras: agenda da rotina, mês de emissão, nomes de pasta e arquivo, estado do certificado.
- `src/lib/nfse/vault.ts` (+ `.test.ts`) — chave do cofre e abertura do envelope (`node:crypto`).
- `src/lib/nfse/vault-browser.ts` — cifragem do envelope (WebCrypto, roda no navegador e no Node 22).
- `scripts/nfse-vault-key.mjs` — gera a `NFSE_VAULT_PRIVATE_KEY` (o Bruno roda).
- `src/db/migrations/0082_nfse-xml-routine.sql` (gerado + RLS) e snapshot.
- `src/lib/nfse/testing/pglite.ts` — aplicar migrações no PGlite (extraído de `queue.db.test.ts`).
- `src/lib/nfse/testing/adn.ts` — fixtures de evento e de resposta do ADN.
- `src/lib/nfse/adn-documents.ts` (+ `.test.ts`) — classifica documento do ADN.
- `src/lib/nfse/adn-client.ts` (+ `.test.ts`) — `GET /contribuintes/DFe/{NSU}`.
- `src/lib/nfse/certificate-check.ts` (+ `.test.ts`) — confere o certificado de uma empresa.
- `src/lib/nfse/xml-routine.ts` (+ `.test.ts`) — rodada da rotina (dependências injetadas).
- `src/lib/nfse/xml-repository.ts` — persistência do lado do serviço fiscal.
- `src/lib/nfse/xml-cycle.ts` — junta tudo para o serviço fiscal.
- `src/lib/nfse/xml.db.test.ts` — banco de verdade (PGlite) como `guilda_app`.
- `src/lib/office-fees/fiscal-operator.ts` — `asFiscalOperator` compartilhado.
- `src/lib/nfse/xml-requests.ts` — leituras do lado do app.
- `src/lib/nfse/xml-archive.ts` (+ `.test.ts`) — monta .zip ou XML único.
- `src/app/(app)/clans/[id]/nfse-xml-actions.ts` — Server Actions.
- `src/app/api/nfse/xml/route.ts` — download.
- `src/app/(app)/clans/[id]/client-certificate-dialog.tsx` — certificado e pasta da empresa.
- `src/app/(app)/clans/[id]/xml-routine-panel.tsx` — rotina no Controle mensal.

Modificar:

- `src/lib/nfse/danfse-data.ts` — usar `xml-dom.ts`.
- `src/lib/nfse/queue.db.test.ts` — usar `testing/pglite.ts`.
- `src/db/schema/domain.ts` — tabelas novas e colunas em `nfse_settings`.
- `scripts/fiscal-service.ts` — cofre, conferência e rotina.
- `src/app/(app)/clans/[id]/nfse-actions.ts` — importar `asFiscalOperator`.
- `src/app/(app)/clans/[id]/portfolio-tab.tsx` e `portfolio-board.tsx` — certificado na Carteira.
- `src/app/(app)/clans/[id]/fiscal-control-tab.tsx` e `fiscal-control-board.tsx` — rotina, contagem e downloads.
- `CLAUDE.md`, `docs/environments.md` — documentação.

---

## Entrega 1 — Fundação e cofre de certificados

### Tarefa 1: helpers de XML compartilhados

**Arquivos:** criar `src/lib/nfse/xml-dom.ts`; modificar `src/lib/nfse/danfse-data.ts`.

- [ ] **Passo 1: criar `src/lib/nfse/xml-dom.ts`**

```ts
import { DOMParser, type Element } from "@xmldom/xmldom";

/** Primeiro filho com esse nome local (ignora o prefixo de namespace). */
export function child(parent: Element | null, name: string): Element | null {
  for (let node = parent?.firstChild ?? null; node; node = node.nextSibling) {
    if (node.nodeType === 1 && (node as Element).localName === name) return node as Element;
  }
  return null;
}

/** Caminho de filhos separados por "/": "DPS/infDPS/prest". */
export function at(root: Element | null, path: string): Element | null {
  return path.split("/").reduce<Element | null>((element, name) => child(element, name), root);
}

/** Texto do elemento no caminho, com espaços normalizados; vazio vira null. */
export function read(root: Element | null, path: string): string | null {
  const text = at(root, path)?.textContent?.replace(/\s+/g, " ").trim();
  return text ? text : null;
}

/** Elemento raiz; XML inválido vira null. */
export function parseXmlRoot(xml: string): Element | null {
  try {
    return new DOMParser().parseFromString(xml, "text/xml").documentElement as Element | null;
  } catch {
    return null;
  }
}
```

- [ ] **Passo 2: trocar as definições locais em `danfse-data.ts`**

Apagar as funções `child`, `at` e `read` da seção "leitura" de
`src/lib/nfse/danfse-data.ts` e o import de `DOMParser`; importar
`import { at, child, parseXmlRoot, read } from "./xml-dom";` (manter
`import type { Element } from "@xmldom/xmldom";`). Em `readDanfse`, trocar o
bloco `try { root = new DOMParser()... } catch { throw ... }` por:

```ts
  const root = parseXmlRoot(nfseXml);
```

(o erro "O XML recebido não é de uma NFS-e." continua saindo logo abaixo
quando a raiz não é `NFSe`).

- [ ] **Passo 3: rodar os testes do DANFSe**

Run: `npx vitest run src/lib/nfse/danfse-data.test.ts src/lib/nfse/danfse-pdf.test.ts`
Expected: PASS (6 testes).

- [ ] **Passo 4: commit**

```bash
git add src/lib/nfse/xml-dom.ts src/lib/nfse/danfse-data.ts
git commit -m "refactor: helpers de leitura de XML da NFS-e compartilhados"
```

### Tarefa 2: regras puras da rotina e do certificado

**Arquivos:** criar `src/domain/nfse-xml.ts` e `src/domain/nfse-xml.test.ts`.

- [ ] **Passo 1: escrever o teste**

```ts
import { describe, expect, test } from "vitest";

import {
  certificateState,
  cnpjRootMatches,
  emissionMonthRange,
  emissionRangeLabel,
  isXmlRoutineDue,
  lastScheduledRun,
  XML_ROUTINE_DEFAULTS,
  xmlCompanyFolder,
  xmlNoteFileName,
} from "./nfse-xml";

const at = (iso: string) => new Date(iso);

describe("agenda da rotina de XML", () => {
  test("todo dia às 06:00 em Brasília", () => {
    expect(lastScheduledRun(XML_ROUTINE_DEFAULTS, at("2026-10-19T12:00:00-03:00"))).toEqual(at("2026-10-19T06:00:00-03:00"));
    expect(lastScheduledRun(XML_ROUTINE_DEFAULTS, at("2026-10-19T05:59:00-03:00"))).toEqual(at("2026-10-18T06:00:00-03:00"));
    // Virada de mês e de ano.
    expect(lastScheduledRun(XML_ROUTINE_DEFAULTS, at("2027-01-01T02:00:00-03:00"))).toEqual(at("2026-12-31T06:00:00-03:00"));
  });

  test("só no dia 5 de cada mês, às 08:30", () => {
    const monthly = { enabled: true, frequency: "monthly" as const, dayOfMonth: 5, time: "08:30" };
    expect(lastScheduledRun(monthly, at("2026-10-19T12:00:00-03:00"))).toEqual(at("2026-10-05T08:30:00-03:00"));
    expect(lastScheduledRun(monthly, at("2026-10-05T08:29:00-03:00"))).toEqual(at("2026-09-05T08:30:00-03:00"));
    expect(lastScheduledRun(monthly, at("2026-01-03T00:00:00-03:00"))).toEqual(at("2025-12-05T08:30:00-03:00"));
  });

  test("está na hora quando a última rodada é anterior ao último horário agendado", () => {
    const now = at("2026-10-19T06:01:00-03:00");
    const base = { schedule: XML_ROUTINE_DEFAULTS, runRequestedAt: null, now };
    expect(isXmlRoutineDue({ ...base, lastRunStartedAt: null })).toBe(true);
    expect(isXmlRoutineDue({ ...base, lastRunStartedAt: at("2026-10-18T06:00:05-03:00") })).toBe(true);
    expect(isXmlRoutineDue({ ...base, lastRunStartedAt: at("2026-10-19T06:00:05-03:00") })).toBe(false);
  });

  test("desligada não roda sozinha, mas 'rodar agora' roda", () => {
    const schedule = { ...XML_ROUTINE_DEFAULTS, enabled: false };
    const now = at("2026-10-19T12:00:00-03:00");
    const lastRunStartedAt = at("2026-10-01T06:00:00-03:00");
    expect(isXmlRoutineDue({ schedule, lastRunStartedAt, runRequestedAt: null, now })).toBe(false);
    expect(isXmlRoutineDue({ schedule, lastRunStartedAt, runRequestedAt: at("2026-10-19T11:59:00-03:00"), now })).toBe(true);
    // Pedido já atendido (a rodada começou depois dele) não roda de novo.
    expect(
      isXmlRoutineDue({ schedule, lastRunStartedAt: at("2026-10-19T11:59:30-03:00"), runRequestedAt: at("2026-10-19T11:59:00-03:00"), now }),
    ).toBe(false);
  });
});

describe("mês de emissão", () => {
  test("setembro vai de 01/09 00:00 a 01/10 00:00, em Brasília", () => {
    const range = emissionMonthRange(2026, 9);
    expect(range.start).toEqual(at("2026-09-01T00:00:00-03:00"));
    expect(range.end).toEqual(at("2026-10-01T00:00:00-03:00"));
    expect(at("2026-09-30T23:59:59-03:00") < range.end).toBe(true);
    expect(at("2026-10-01T00:00:00-03:00") < range.end).toBe(false);
    expect(emissionMonthRange(2026, 12).end).toEqual(at("2027-01-01T00:00:00-03:00"));
  });

  test("rótulo do botão", () => {
    expect(emissionRangeLabel(2026, 9)).toBe("emitidas de 01/09 a 30/09");
    expect(emissionRangeLabel(2028, 2)).toBe("emitidas de 01/02 a 29/02");
  });
});

describe("nomes no arquivo", () => {
  test("pasta da empresa: nome sem acento + raiz do CNPJ", () => {
    expect(xmlCompanyFolder("Padaria Pão & Cia Ltda", "33000167000101")).toBe("padaria-pao-cia-ltda-33000167");
    expect(xmlCompanyFolder("  ", null)).toBe("empresa");
  });

  test("arquivo da nota: número com seis dígitos, ou o NSU sem número", () => {
    expect(xmlNoteFileName("123", 9)).toBe("000123.xml");
    expect(xmlNoteFileName(null, 9)).toBe("nsu-9.xml");
  });
});

describe("certificado da empresa", () => {
  const now = at("2026-10-19T12:00:00-03:00");
  test("situações", () => {
    expect(certificateState({ status: null, validUntil: null, now }).state).toBe("missing");
    expect(certificateState({ status: "pending", validUntil: null, now }).state).toBe("pending");
    expect(certificateState({ status: "invalid", validUntil: null, now }).state).toBe("invalid");
    expect(certificateState({ status: "valid", validUntil: at("2027-03-19T00:00:00-03:00"), now }).state).toBe("valid");
    expect(certificateState({ status: "valid", validUntil: at("2026-11-01T00:00:00-03:00"), now })).toEqual({ state: "expiring", daysLeft: 12 });
    expect(certificateState({ status: "valid", validUntil: at("2026-10-01T00:00:00-03:00"), now }).state).toBe("expired");
  });

  test("raiz do CNPJ", () => {
    expect(cnpjRootMatches("33000167000101", "33000167000282")).toBe(true);
    expect(cnpjRootMatches("33000167000101", "11222333000181")).toBe(false);
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `npx vitest run src/domain/nfse-xml.test.ts`
Expected: FAIL ("Failed to resolve import ./nfse-xml").

- [ ] **Passo 3: implementar `src/domain/nfse-xml.ts`**

```ts
/**
 * Regras puras do XML das NFS-e prestadas das empresas. Desenho em
 * docs/superpowers/specs/2026-10-19-xml-nfse-prestadas-design.md.
 */

export const XML_ROUTINE_FREQUENCIES = ["daily", "monthly"] as const;
export type XmlRoutineFrequency = (typeof XML_ROUTINE_FREQUENCIES)[number];

export interface XmlRoutineSchedule {
  enabled: boolean;
  frequency: XmlRoutineFrequency;
  /** 1 a 28, só no mensal (29–31 não existem em todo mês). */
  dayOfMonth: number | null;
  /** "HH:MM" em Brasília. */
  time: string;
}

export const XML_ROUTINE_DEFAULTS: XmlRoutineSchedule = {
  enabled: true,
  frequency: "daily",
  dayOfMonth: null,
  time: "06:00",
};

export const XML_ROUTINE_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Brasília não tem horário de verão desde 2019: UTC-3 fixo, como em src/lib/nfse/time.ts. */
const BRASILIA_OFFSET_MS = 3 * 60 * 60 * 1000;

function brasiliaDate(date: Date): { year: number; month: number; day: number } {
  const shifted = new Date(date.getTime() - BRASILIA_OFFSET_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

/** Instante de um horário de Brasília. Date.UTC normaliza dia 0 e mês 0 (mês e ano anteriores). */
function brasiliaInstant(year: number, month: number, day: number, hours = 0, minutes = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hours, minutes) + BRASILIA_OFFSET_MS);
}

/** O último horário agendado que já chegou. */
export function lastScheduledRun(schedule: XmlRoutineSchedule, now: Date): Date {
  const [hours, minutes] = schedule.time.split(":").map(Number);
  const today = brasiliaDate(now);
  if (schedule.frequency === "daily") {
    const candidate = brasiliaInstant(today.year, today.month, today.day, hours, minutes);
    return candidate <= now ? candidate : brasiliaInstant(today.year, today.month, today.day - 1, hours, minutes);
  }
  const day = schedule.dayOfMonth ?? 1;
  const candidate = brasiliaInstant(today.year, today.month, day, hours, minutes);
  return candidate <= now ? candidate : brasiliaInstant(today.year, today.month - 1, day, hours, minutes);
}

/**
 * Está na hora de rodar? "Rodar agora" pedido depois da última rodada vale
 * mesmo com a rotina desligada; fora isso, roda quando a última rodada é
 * anterior ao último horário agendado.
 */
export function isXmlRoutineDue(input: {
  schedule: XmlRoutineSchedule;
  lastRunStartedAt: Date | null;
  runRequestedAt: Date | null;
  now: Date;
}): boolean {
  const { schedule, lastRunStartedAt, runRequestedAt, now } = input;
  if (runRequestedAt && (!lastRunStartedAt || runRequestedAt > lastRunStartedAt)) return true;
  if (!schedule.enabled) return false;
  return !lastRunStartedAt || lastRunStartedAt < lastScheduledRun(schedule, now);
}

/** Notas emitidas no mês, em Brasília: [start, end). */
export function emissionMonthRange(year: number, month: number): { start: Date; end: Date } {
  return { start: brasiliaInstant(year, month, 1), end: brasiliaInstant(year, month + 1, 1) };
}

/** "emitidas de 01/09 a 30/09". */
export function emissionRangeLabel(year: number, month: number): string {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, "0");
  return `emitidas de 01/${mm} a ${lastDay}/${mm}`;
}

function slug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Pasta da empresa no .zip: nome sem acento + raiz do CNPJ (desempata nomes iguais). */
export function xmlCompanyFolder(name: string, cnpj: string | null): string {
  const base = slug(name) || "empresa";
  return cnpj ? `${base}-${cnpj.slice(0, 8)}` : base;
}

export function xmlNoteFileName(nfseNumber: string | null, nsu: number): string {
  return nfseNumber ? `${nfseNumber.padStart(6, "0")}.xml` : `nsu-${nsu}.xml`;
}

export const CERTIFICATE_WARNING_DAYS = 30;
export type CertificateStatus = "pending" | "valid" | "invalid";
export type CertificateState = "missing" | "pending" | "invalid" | "expired" | "expiring" | "valid";

/** "Vencido" não é gravado: sai da validade na hora de mostrar. */
export function certificateState(input: {
  status: CertificateStatus | null;
  validUntil: Date | null;
  now: Date;
}): { state: CertificateState; daysLeft: number | null } {
  if (!input.status) return { state: "missing", daysLeft: null };
  if (input.status !== "valid" || !input.validUntil) {
    return { state: input.status === "valid" ? "invalid" : input.status, daysLeft: null };
  }
  const daysLeft = Math.floor((input.validUntil.getTime() - input.now.getTime()) / 86_400_000);
  if (input.validUntil <= input.now) return { state: "expired", daysLeft };
  return { state: daysLeft < CERTIFICATE_WARNING_DAYS ? "expiring" : "valid", daysLeft };
}

/** A API aceita certificado de mesma raiz (os 8 primeiros dígitos). */
export function cnpjRootMatches(a: string, b: string): boolean {
  return /^\d{14}$/.test(a) && /^\d{14}$/.test(b) && a.slice(0, 8) === b.slice(0, 8);
}
```

- [ ] **Passo 4: rodar e ver passar**

Run: `npx vitest run src/domain/nfse-xml.test.ts`
Expected: PASS.

- [ ] **Passo 5: commit**

```bash
git add src/domain/nfse-xml.ts src/domain/nfse-xml.test.ts
git commit -m "feat: regras da rotina de XML e do certificado das empresas"
```

### Tarefa 3: cofre (envelope cifrado)

**Arquivos:** criar `src/lib/nfse/vault.ts`, `src/lib/nfse/vault-browser.ts`,
`src/lib/nfse/vault.test.ts`, `scripts/nfse-vault-key.mjs`.

- [ ] **Passo 1: escrever o teste**

```ts
import { generateKeyPairSync } from "node:crypto";

import { describe, expect, test } from "vitest";

import { loadVaultKey, VaultError, vaultEnvelopeSchema } from "./vault";
import { sealCertificate } from "./vault-browser";

function testVaultKey(): string {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" }) as string).toString("base64");
}

describe("cofre de certificados", () => {
  test("o envelope cifrado pelo navegador (WebCrypto) abre no serviço", async () => {
    const vault = loadVaultKey(testVaultKey());
    const pfx = new Uint8Array([1, 2, 3, 250, 251]);
    const envelope = await sealCertificate({ publicKeySpki: vault.publicKeySpki, keyId: vault.keyId, pfx, password: "senha ç" });
    expect(vaultEnvelopeSchema.parse(envelope)).toEqual(envelope);
    expect(vault.open(envelope)).toEqual({ pfx: Buffer.from(pfx).toString("base64"), password: "senha ç" });
  });

  test("outra chave e envelope adulterado são recusados", async () => {
    const vault = loadVaultKey(testVaultKey());
    const other = loadVaultKey(testVaultKey());
    const envelope = await sealCertificate({ publicKeySpki: vault.publicKeySpki, keyId: vault.keyId, pfx: new Uint8Array([7]), password: "x" });
    expect(() => other.open(envelope)).toThrow(VaultError);
    const bytes = Buffer.from(envelope.ciphertext, "base64");
    bytes[0] ^= 1;
    expect(() => vault.open({ ...envelope, ciphertext: bytes.toString("base64") })).toThrow(VaultError);
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `npx vitest run src/lib/nfse/vault.test.ts`
Expected: FAIL (módulos não existem).

- [ ] **Passo 3: implementar `src/lib/nfse/vault.ts`**

```ts
import {
  constants,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  privateDecrypt,
} from "node:crypto";

import { z } from "zod";

/**
 * Cofre dos certificados A1 das empresas: o navegador cifra { pfx, senha }
 * com AES-256-GCM e embrulha a chave AES com a pública do serviço fiscal
 * (RSA-OAEP, SHA-256). Só o serviço fiscal tem a privada
 * (NFSE_VAULT_PRIVATE_KEY); o app e o banco só veem o envelope.
 */

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export const vaultEnvelopeSchema = z.object({
  v: z.literal(1),
  keyId: z.string().regex(/^[0-9a-f]{16}$/),
  wrappedKey: z.string().max(1024).regex(BASE64),
  iv: z.string().max(32).regex(BASE64),
  // Um .pfx tem poucos KB; 200 mil caracteres de base64 sobram.
  ciphertext: z.string().min(1).max(200_000).regex(BASE64),
});
export type VaultEnvelope = z.infer<typeof vaultEnvelopeSchema>;

export interface VaultSecret {
  /** O .pfx em base64, como o loadNfseCertificate recebe. */
  pfx: string;
  password: string;
}

export class VaultError extends Error {}

export interface VaultKey {
  keyId: string;
  /** Chave pública SPKI (DER) em base64, publicada em nfse_settings. */
  publicKeySpki: string;
  open(envelope: VaultEnvelope): VaultSecret;
}

const GCM_TAG_BYTES = 16;

/** Recebe a NFSE_VAULT_PRIVATE_KEY: a privada PEM (PKCS#8) em base64. */
export function loadVaultKey(privateKeyBase64: string): VaultKey {
  const privateKey = createPrivateKey(Buffer.from(privateKeyBase64, "base64").toString("utf8"));
  const spki = createPublicKey(privateKey).export({ type: "spki", format: "der" });
  const keyId = createHash("sha256").update(spki).digest("hex").slice(0, 16);
  return {
    keyId,
    publicKeySpki: spki.toString("base64"),
    open(envelope) {
      if (envelope.keyId !== keyId) {
        throw new VaultError("O certificado foi cifrado com outra chave do serviço fiscal. Envie de novo.");
      }
      try {
        const aesKey = privateDecrypt(
          { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
          Buffer.from(envelope.wrappedKey, "base64"),
        );
        // O WebCrypto põe a tag do GCM no fim do texto cifrado.
        const data = Buffer.from(envelope.ciphertext, "base64");
        const decipher = createDecipheriv("aes-256-gcm", aesKey, Buffer.from(envelope.iv, "base64"));
        decipher.setAuthTag(data.subarray(data.length - GCM_TAG_BYTES));
        const plain = Buffer.concat([decipher.update(data.subarray(0, data.length - GCM_TAG_BYTES)), decipher.final()]);
        const secret = JSON.parse(plain.toString("utf8")) as Partial<VaultSecret>;
        if (typeof secret.pfx !== "string" || typeof secret.password !== "string") throw new Error("conteúdo");
        return { pfx: secret.pfx, password: secret.password };
      } catch {
        throw new VaultError("Não foi possível abrir o envelope do certificado. Envie de novo.");
      }
    },
  };
}
```

- [ ] **Passo 4: implementar `src/lib/nfse/vault-browser.ts`**

```ts
import type { VaultEnvelope } from "./vault";

/**
 * Lado do navegador do cofre (WebCrypto). Também roda no Node 22, o que
 * deixa o teste usar exatamente o mesmo código que a tela.
 */

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function sealCertificate(input: {
  publicKeySpki: string;
  keyId: string;
  pfx: Uint8Array;
  password: string;
}): Promise<VaultEnvelope> {
  const { subtle } = globalThis.crypto;
  const rsa = await subtle.importKey("spki", fromBase64(input.publicKeySpki), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["wrapKey"]);
  const aes = await subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify({ pfx: toBase64(input.pfx), password: input.password }));
  const ciphertext = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv }, aes, plain));
  const wrappedKey = new Uint8Array(await subtle.wrapKey("raw", aes, rsa, { name: "RSA-OAEP" }));
  return { v: 1, keyId: input.keyId, wrappedKey: toBase64(wrappedKey), iv: toBase64(iv), ciphertext: toBase64(ciphertext) };
}
```

- [ ] **Passo 5: criar `scripts/nfse-vault-key.mjs`** (o Bruno roda; nenhum agente roda para produção)

```js
// Gera a NFSE_VAULT_PRIVATE_KEY do guilda-fiscal: uma chave RSA de 3072 bits
// em PEM (PKCS#8), em base64. Rode, copie a linha para a variável no
// Easypanel e não guarde em mais lugar nenhum.
//   node scripts/nfse-vault-key.mjs
import { generateKeyPairSync } from "node:crypto";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 3072 });
process.stdout.write(`${Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" })).toString("base64")}\n`);
```

- [ ] **Passo 6: rodar e ver passar**

Run: `npx vitest run src/lib/nfse/vault.test.ts`
Expected: PASS.

- [ ] **Passo 7: commit**

```bash
git add src/lib/nfse/vault.ts src/lib/nfse/vault-browser.ts src/lib/nfse/vault.test.ts scripts/nfse-vault-key.mjs
git commit -m "feat: cofre dos certificados A1 das empresas (envelope cifrado no navegador)"
```

### Tarefa 4: esquema e migração 0082

**Arquivos:** modificar `src/db/schema/domain.ts`; gerar
`src/db/migrations/0082_nfse-xml-routine.sql`; criar
`src/lib/nfse/testing/pglite.ts`; modificar `src/lib/nfse/queue.db.test.ts`.

- [ ] **Passo 1: tipos e tabelas no esquema**

Em `src/db/schema/domain.ts`, acrescentar `customType` e `primaryKey` ao
import de `drizzle-orm/pg-core` se ainda não estiverem. Em `nfse_settings`,
depois de `serviceError`:

```ts
    // Chave pública do cofre de certificados das empresas, publicada pelo serviço fiscal.
    vaultKeyId: varchar("vault_key_id", { length: 16 }),
    vaultPublicKey: text("vault_public_key"),
```

Depois de `nfseInvoiceEvents`, acrescentar:

```ts
const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => "bytea",
});

export const nfseCertificateStatus = pgEnum("nfse_certificate_status", ["pending", "valid", "invalid"]);
export const nfseXmlRoutineFrequency = pgEnum("nfse_xml_routine_frequency", ["daily", "monthly"]);

/**
 * Certificado A1 de uma empresa-cliente, só como envelope cifrado no
 * navegador (src/lib/nfse/vault.ts). Quem abre é o serviço fiscal, que grava
 * a conferência (situação, CNPJ e validade). Decisão de 2026-10-19.
 */
export const nfseClientCertificates = pgTable(
  "nfse_client_certificates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull(),
    envelope: jsonb("envelope")
      .$type<{ v: 1; keyId: string; wrappedKey: string; iv: string; ciphertext: string }>()
      .notNull(),
    status: nfseCertificateStatus("status").notNull().default("pending"),
    statusMessage: text("status_message"),
    certificateCnpj: varchar("certificate_cnpj", { length: 14 }),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    uploadedBy: text("uploaded_by")
      .notNull()
      .references(() => user.id),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "nfse_client_certificates_org_client_fk",
      columns: [t.orgId, t.clientId],
      foreignColumns: [clients.orgId, clients.id],
    }).onDelete("cascade"),
    uniqueIndex("nfse_client_certificates_org_client_uidx").on(t.orgId, t.clientId),
    check(
      "nfse_client_certificates_valid_check",
      sql`${t.status} <> 'valid' OR (${t.validUntil} IS NOT NULL AND ${t.certificateCnpj} IS NOT NULL)`,
    ),
  ],
);

/** Configuração da rotina de XML: uma linha por organização. */
export const nfseXmlRoutines = pgTable(
  "nfse_xml_routines",
  {
    orgId: text("org_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(true),
    frequency: nfseXmlRoutineFrequency("frequency").notNull().default("daily"),
    dayOfMonth: smallint("day_of_month"),
    runTime: varchar("run_time", { length: 5 }).notNull().default("06:00"),
    keepSince: date("keep_since", { mode: "string" }),
    runRequestedAt: timestamp("run_requested_at", { withTimezone: true }),
    lastRunStartedAt: timestamp("last_run_started_at", { withTimezone: true }),
    lastRunFinishedAt: timestamp("last_run_finished_at", { withTimezone: true }),
    updatedBy: text("updated_by").references(() => user.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "nfse_xml_routines_day_check",
      sql`(${t.frequency} = 'daily' AND ${t.dayOfMonth} IS NULL) OR (${t.frequency} = 'monthly' AND ${t.dayOfMonth} BETWEEN 1 AND 28)`,
    ),
    check("nfse_xml_routines_time_check", sql`${t.runTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
  ],
);

/** Até onde a rotina leu a distribuição do ADN de cada empresa. */
export const nfseDfeCursors = pgTable(
  "nfse_dfe_cursors",
  {
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull(),
    lastNsu: bigint("last_nsu", { mode: "number" }).notNull().default(0),
    initialSyncAt: timestamp("initial_sync_at", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastError: text("last_error"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.clientId] }),
    foreignKey({
      name: "nfse_dfe_cursors_org_client_fk",
      columns: [t.orgId, t.clientId],
      foreignColumns: [clients.orgId, clients.id],
    }).onDelete("cascade"),
    check("nfse_dfe_cursors_nsu_check", sql`${t.lastNsu} >= 0`),
  ],
);

/**
 * A pasta de XML de cada empresa: as NFS-e que ela emitiu, com o XML
 * compactado (gzip). Aqui o XML fica guardado, ao contrário das notas de
 * honorário (decisão do Bruno de 2026-10-19).
 */
export const nfseIssuedNotes = pgTable(
  "nfse_issued_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull(),
    accessKey: varchar("access_key", { length: 50 }).notNull(),
    nsu: bigint("nsu", { mode: "number" }).notNull(),
    nfseNumber: varchar("nfse_number", { length: 20 }),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    competence: date("competence", { mode: "string" }),
    xmlGz: bytea("xml_gz").notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelNsu: bigint("cancel_nsu", { mode: "number" }),
    cancelXmlGz: bytea("cancel_xml_gz"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "nfse_issued_notes_org_client_fk",
      columns: [t.orgId, t.clientId],
      foreignColumns: [clients.orgId, clients.id],
    }).onDelete("cascade"),
    uniqueIndex("nfse_issued_notes_org_key_uidx").on(t.orgId, t.accessKey),
    index("nfse_issued_notes_org_client_issued_idx").on(t.orgId, t.clientId, t.issuedAt),
    check("nfse_issued_notes_key_check", sql`${t.accessKey} ~ '^[0-9]{50}$'`),
  ],
);
```

- [ ] **Passo 2: gerar a migração**

Run: `npx drizzle-kit generate --name nfse-xml-routine`
Expected: cria `src/db/migrations/0082_nfse-xml-routine.sql`, o snapshot e a
entrada no journal. **Abra o SQL e confira** que traz os dois enums, as quatro
tabelas, as FKs compostas e as duas colunas de `nfse_settings`. Se as FKs
compostas aparecerem antes de algum índice único de que dependam, mova o
índice para antes (aconteceu na 0080).

- [ ] **Passo 3: acrescentar RLS e permissões no fim da 0082**

```sql
--> statement-breakpoint
-- XML das NFS-e prestadas (decisao de 2026-10-19): isolamento por organizacao.
ALTER TABLE "nfse_client_certificates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "nfse_client_certificates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "nfse_client_certificates"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "nfse_xml_routines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "nfse_xml_routines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "nfse_xml_routines"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "nfse_dfe_cursors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "nfse_dfe_cursors" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "nfse_dfe_cursors"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "nfse_issued_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "nfse_issued_notes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "nfse_issued_notes"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
-- O guilda_app ganha tudo em tabela nova pelos default privileges
-- (docker/*/init/01-roles): GRANT sozinho nao restringe nada.
-- Certificado se troca e se remove. Configuracao e cursor nao se apagam.
-- Nota guardada nao se apaga e so recebe o cancelamento. Cascata das FKs roda
-- como dono.
REVOKE DELETE ON "nfse_xml_routines" FROM guilda_app;--> statement-breakpoint
REVOKE DELETE ON "nfse_dfe_cursors" FROM guilda_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "nfse_issued_notes" FROM guilda_app;--> statement-breakpoint
GRANT UPDATE ("cancelled_at", "cancel_nsu", "cancel_xml_gz") ON "nfse_issued_notes" TO guilda_app;
```

- [ ] **Passo 4: extrair o harness do PGlite para `src/lib/nfse/testing/pglite.ts`**

```ts
import { readFileSync } from "node:fs";
import path from "node:path";

import type { PGlite } from "@electric-sql/pglite";

/**
 * Prepara um PGlite como os ambientes reais: role guilda_app com os default
 * privileges (docker/dev/init/01-roles.sql) e todas as migrações. Depois do
 * seed, o teste roda `SET ROLE guilda_app;`.
 */
export async function applyMigrations(client: PGlite): Promise<void> {
  const dir = path.resolve(process.cwd(), "src/db/migrations");
  const journal = JSON.parse(readFileSync(path.join(dir, "meta/_journal.json"), "utf8")) as { entries: { tag: string }[] };
  await client.exec(`
    CREATE ROLE guilda_app NOLOGIN NOSUPERUSER;
    GRANT USAGE ON SCHEMA public TO guilda_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO guilda_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO guilda_app;
  `);
  for (const entry of journal.entries) {
    for (const statement of readFileSync(path.join(dir, `${entry.tag}.sql`), "utf8").split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }
}
```

Em `src/lib/nfse/queue.db.test.ts`, trocar o trecho do `beforeAll` que cria
o role e aplica o journal por `await applyMigrations(client);` (import de
`./testing/pglite`), mantendo o seed e o `SET ROLE guilda_app;`. Tirar os
imports que sobrarem (`readFileSync`, `path`).

- [ ] **Passo 5: rodar o teste de banco existente (agora com a 0082)**

Run: `npx vitest run src/lib/nfse/queue.db.test.ts`
Expected: PASS (a 0082 aplica limpo no PGlite).

- [ ] **Passo 6: rodar o verificador de RLS do projeto**

Run: `node scripts/check-rls.mjs`
Expected: sem tabela de domínio sem RLS. (Se o script exigir banco rodando e
não houver, registre e siga; o teste de banco da Tarefa 8 cobre o RLS.)

- [ ] **Passo 7: commit**

```bash
git add src/db/schema/domain.ts src/db/migrations src/lib/nfse/testing/pglite.ts src/lib/nfse/queue.db.test.ts
git commit -m "feat: tabelas do cofre, da rotina e da pasta de XML das empresas (0082)"
```

### Tarefa 5: conferência do certificado de uma empresa

**Arquivos:** criar `src/lib/nfse/certificate-check.ts` e `.test.ts`.

- [ ] **Passo 1: escrever o teste**

```ts
import { generateKeyPairSync } from "node:crypto";

import { describe, expect, test } from "vitest";

import { checkClientCertificate } from "./certificate-check";
import { createTestCertificate } from "./testing/certificate";
import { loadVaultKey } from "./vault";
import { sealCertificate } from "./vault-browser";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const vault = loadVaultKey(Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" }) as string).toString("base64"));

async function envelopeFor(pfxBase64: string, password: string) {
  return sealCertificate({ publicKeySpki: vault.publicKeySpki, keyId: vault.keyId, pfx: Buffer.from(pfxBase64, "base64"), password });
}

describe("conferência do certificado da empresa", () => {
  const cert = createTestCertificate({ commonName: "PADARIA LTDA:33000167000101" });

  test("válido: CNPJ e validade", async () => {
    const result = checkClientCertificate({ vault, envelope: await envelopeFor(cert.pfxBase64, cert.password), clientCnpj: "33000167000282" });
    expect(result).toEqual({ status: "valid", cnpj: "33000167000101", validUntil: new Date("2027-01-01T00:00:00Z") });
  });

  test("senha errada, outro CNPJ e empresa sem CNPJ", async () => {
    expect(checkClientCertificate({ vault, envelope: await envelopeFor(cert.pfxBase64, "errada"), clientCnpj: "33000167000101" })).toMatchObject({
      status: "invalid",
      message: expect.stringContaining("senha errada"),
    });
    expect(checkClientCertificate({ vault, envelope: await envelopeFor(cert.pfxBase64, cert.password), clientCnpj: "11222333000181" })).toMatchObject({
      status: "invalid",
      message: expect.stringContaining("33.000.167/0001-01"),
    });
    expect(checkClientCertificate({ vault, envelope: await envelopeFor(cert.pfxBase64, cert.password), clientCnpj: null })).toMatchObject({
      status: "invalid",
    });
  });
});
```

- [ ] **Passo 2: rodar e ver falhar** — `npx vitest run src/lib/nfse/certificate-check.test.ts` → FAIL.

- [ ] **Passo 3: implementar `src/lib/nfse/certificate-check.ts`**

```ts
import { formatCnpj } from "@/domain/cnpj";
import { cnpjRootMatches } from "@/domain/nfse-xml";

import { loadNfseCertificate, NfseCertificateError } from "./certificate";
import { type VaultEnvelope, VaultError, type VaultKey } from "./vault";

export type CertificateCheck =
  | { status: "valid"; cnpj: string; validUntil: Date }
  | { status: "invalid"; message: string };

/** Abre o envelope, abre o A1 e confere a raiz do CNPJ com a do cadastro. */
export function checkClientCertificate(input: {
  vault: Pick<VaultKey, "open">;
  envelope: VaultEnvelope;
  clientCnpj: string | null;
}): CertificateCheck {
  if (!input.clientCnpj) return { status: "invalid", message: "A empresa está sem CNPJ no cadastro." };
  let secret;
  try {
    secret = input.vault.open(input.envelope);
  } catch (error) {
    return { status: "invalid", message: error instanceof VaultError ? error.message : "Envelope inválido. Envie de novo." };
  }
  let certificate;
  try {
    certificate = loadNfseCertificate(secret.pfx, secret.password);
  } catch (error) {
    return {
      status: "invalid",
      message: error instanceof NfseCertificateError ? error.message : "O arquivo não é um certificado A1.",
    };
  }
  if (!cnpjRootMatches(certificate.cnpj, input.clientCnpj)) {
    return { status: "invalid", message: `O certificado é de outro CNPJ (${formatCnpj(certificate.cnpj)}).` };
  }
  return { status: "valid", cnpj: certificate.cnpj, validUntil: certificate.validUntil };
}
```

- [ ] **Passo 4: rodar e ver passar.** **Passo 5: commit** — `feat: conferencia do certificado A1 da empresa`.

---

## Entrega 2 — A rotina

### Tarefa 6: classificar documento do ADN

**Arquivos:** criar `src/lib/nfse/testing/adn.ts`, `src/lib/nfse/adn-documents.ts`, `src/lib/nfse/adn-documents.test.ts`.

- [ ] **Passo 1: fixtures em `src/lib/nfse/testing/adn.ts`**

```ts
import { gzipBase64, NFSE_NAMESPACE } from "../xml";

/** Evento do Sistema Nacional (TCEvento) com o pedido de cancelamento dentro. */
export function testEventXml(accessKey: string, code = "e101101"): string {
  return (
    `<evento xmlns="${NFSE_NAMESPACE}" versao="1.01"><infEvento Id="EVT${accessKey}${code.slice(1)}001">` +
    `<verAplic>SefinNac</verAplic><ambGer>2</ambGer><nSeqEvento>1</nSeqEvento>` +
    `<dhProc>2026-10-20T10:00:00-03:00</dhProc><nDFSe>99</nDFSe>` +
    `<pedRegEvento versao="1.01"><infPedReg Id="PRE${accessKey}${code.slice(1)}">` +
    `<tpAmb>1</tpAmb><verAplic>Guilda-1.0</verAplic><dhEvento>2026-10-20T09:59:00-03:00</dhEvento>` +
    `<CNPJAutor>11222333000181</CNPJAutor><chNFSe>${accessKey}</chNFSe>` +
    `<${code}><xDesc>Cancelamento de NFS-e</xDesc><cMotivo>1</cMotivo><xMotivo>Erro na emissão da nota</xMotivo></${code}>` +
    `</infPedReg></pedRegEvento></infEvento></evento>`
  );
}

/** Corpo JSON de GET /contribuintes/DFe/{NSU}?lote=true. */
export function testAdnBatchBody(documents: { nsu: number; xml: string; type?: string }[]): string {
  return JSON.stringify({
    StatusProcessamento: documents.length > 0 ? "DOCUMENTOS_LOCALIZADOS" : "NENHUM_DOCUMENTO_LOCALIZADO",
    LoteDFe: documents.map((doc) => ({
      NSU: doc.nsu,
      ChaveAcesso: null,
      TipoDocumento: doc.type ?? "NFSE",
      ArquivoXml: gzipBase64(doc.xml),
      DataHoraGeracao: "2026-10-20T10:00:00",
    })),
  });
}
```

- [ ] **Passo 2: teste `src/lib/nfse/adn-documents.test.ts`**

```ts
import { describe, expect, test } from "vitest";

import { readAdnDocument } from "./adn-documents";
import { testEventXml } from "./testing/adn";
import { TEST_ACCESS_KEY, testNfseXml } from "./testing/nfse-xml";

// Na fixture, o prestador é 11222333000181 e o tomador 33000167000101.
describe("documentos da distribuição do ADN", () => {
  test("NFS-e que a empresa emitiu entra, com número, emissão e competência", () => {
    expect(readAdnDocument(testNfseXml(), "11222333000181")).toEqual({
      kind: "issued",
      accessKey: TEST_ACCESS_KEY,
      nfseNumber: "107",
      issuedAt: new Date("2026-10-15T11:02:31-03:00"),
      competence: "2026-10-15",
    });
  });

  test("NFS-e em que a empresa é tomadora fica de fora", () => {
    expect(readAdnDocument(testNfseXml(), "33000167000101")).toEqual({ kind: "ignored" });
  });

  test("cancelamento, por substituição, deferido e de ofício contam; indeferido não", () => {
    for (const code of ["e101101", "e105102", "e105104", "e305101"]) {
      expect(readAdnDocument(testEventXml(TEST_ACCESS_KEY, code), "11222333000181")).toEqual({
        kind: "cancellation",
        accessKey: TEST_ACCESS_KEY,
        cancelledAt: new Date("2026-10-20T10:00:00-03:00"),
      });
    }
    expect(readAdnDocument(testEventXml(TEST_ACCESS_KEY, "e105105"), "11222333000181")).toEqual({ kind: "ignored" });
  });

  test("XML estranho fica de fora", () => {
    expect(readAdnDocument("não é xml", "11222333000181")).toEqual({ kind: "ignored" });
  });
});
```

- [ ] **Passo 3: rodar e ver falhar.**

- [ ] **Passo 4: implementar `src/lib/nfse/adn-documents.ts`**

```ts
import { at, child, parseXmlRoot, read } from "./xml-dom";

/**
 * Eventos que cancelam a nota (tiposEventos_v1.01.xsd): cancelamento,
 * cancelamento por substituição, cancelamento deferido por análise fiscal e
 * cancelamento de ofício. O indeferido (e105105) não cancela.
 */
export const CANCELLATION_EVENTS = ["e101101", "e105102", "e105104", "e305101"] as const;

export type AdnDocumentReading =
  | { kind: "issued"; accessKey: string; nfseNumber: string | null; issuedAt: Date; competence: string | null }
  | { kind: "cancellation"; accessKey: string; cancelledAt: Date | null }
  | { kind: "ignored" };

const ACCESS_KEY = /^\d{50}$/;

function toDate(value: string | null): Date | null {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

/** Prestada = o prestador da DPS é a empresa (mesmo quando quem emitiu foi o tomador). */
export function readAdnDocument(xml: string, clientCnpj: string): AdnDocumentReading {
  const root = parseXmlRoot(xml);
  if (root?.localName === "NFSe") {
    const inf = child(root, "infNFSe");
    const accessKey = (inf?.getAttribute("Id") ?? "").replace(/^NFS/, "");
    const issuedAt = toDate(read(inf, "dhProc"));
    if (!ACCESS_KEY.test(accessKey) || !issuedAt || read(inf, "DPS/infDPS/prest/CNPJ") !== clientCnpj) {
      return { kind: "ignored" };
    }
    return { kind: "issued", accessKey, nfseNumber: read(inf, "nNFSe"), issuedAt, competence: read(inf, "DPS/infDPS/dCompet") };
  }
  if (root?.localName === "evento") {
    const request = at(root, "infEvento/pedRegEvento/infPedReg");
    const accessKey = read(request, "chNFSe");
    if (!accessKey || !ACCESS_KEY.test(accessKey) || !CANCELLATION_EVENTS.some((code) => child(request, code))) {
      return { kind: "ignored" };
    }
    return { kind: "cancellation", accessKey, cancelledAt: toDate(read(root, "infEvento/dhProc")) };
  }
  return { kind: "ignored" };
}
```

- [ ] **Passo 5: rodar e ver passar.** **Passo 6: commit** — `feat: leitura dos documentos da distribuicao do ADN`.

### Tarefa 7: cliente da distribuição do ADN

**Arquivos:** criar `src/lib/nfse/adn-client.ts` e `.test.ts`.

- [ ] **Passo 1: teste**

```ts
import { describe, expect, test } from "vitest";

import { AdnRejectionError, fetchAdnBatch } from "./adn-client";
import type { HttpRequest, HttpResponse } from "./sefin-client";
import { NfseTransientError } from "./sefin-client";
import { testAdnBatchBody } from "./testing/adn";

function fake(responses: HttpResponse[]) {
  const calls: HttpRequest[] = [];
  return {
    calls,
    transport: async (req: HttpRequest) => {
      calls.push(req);
      const next = responses.shift();
      if (!next) throw new Error("sem resposta preparada");
      return next;
    },
  };
}

const json = (status: number, body: string): HttpResponse => ({ status, body: Buffer.from(body), contentType: "application/json" });

describe("distribuição do ADN para contribuintes", () => {
  test("pede o lote a partir do NSU, com o CNPJ consultado, e descompacta os XML", async () => {
    const { calls, transport } = fake([json(200, testAdnBatchBody([{ nsu: 5, xml: "<NFSe/>" }, { nsu: 6, xml: "<evento/>" }]))]);
    const batch = await fetchAdnBatch(transport, "producao", { fromNsu: 5, cnpj: "33000167000101" });
    expect(calls[0]).toMatchObject({
      method: "GET",
      url: "https://adn.nfse.gov.br/contribuintes/DFe/5?lote=true&cnpjConsulta=33000167000101",
    });
    expect(batch).toEqual({ documents: [{ nsu: 5, xml: "<NFSe/>" }, { nsu: 6, xml: "<evento/>" }], done: false });
  });

  test("nenhum documento encerra a leitura", async () => {
    const { transport } = fake([json(200, testAdnBatchBody([])), json(404, "{}")]);
    expect(await fetchAdnBatch(transport, "producao", { fromNsu: 9, cnpj: "33000167000101" })).toEqual({ documents: [], done: true });
    expect(await fetchAdnBatch(transport, "producao", { fromNsu: 9, cnpj: "33000167000101" })).toEqual({ documents: [], done: true });
  });

  test("instabilidade é transitória; recusa vem com o motivo", async () => {
    const { transport } = fake([
      json(503, ""),
      json(403, "{}"),
      json(400, JSON.stringify({ StatusProcessamento: "REJEICAO", Erros: [{ Codigo: "E2230", Descricao: "CNPJ sem relação" }] })),
    ]);
    await expect(fetchAdnBatch(transport, "producao", { fromNsu: 1, cnpj: "33000167000101" })).rejects.toThrow(NfseTransientError);
    await expect(fetchAdnBatch(transport, "producao", { fromNsu: 1, cnpj: "33000167000101" })).rejects.toThrow(/certificado/);
    await expect(fetchAdnBatch(transport, "producao", { fromNsu: 1, cnpj: "33000167000101" })).rejects.toThrow(AdnRejectionError);
  });
});
```

- [ ] **Passo 2: rodar e ver falhar.**

- [ ] **Passo 3: implementar `src/lib/nfse/adn-client.ts`**

```ts
import { type HttpTransport, type NfseEnvironmentName, NfseTransientError } from "./sefin-client";
import { gunzipBase64 } from "./xml";

/**
 * Distribuição de DF-e do ADN para contribuintes (Manual dos Contribuintes —
 * APIs do ADN, v1.0 de 12/02/2026): documentos em que a empresa é emitente,
 * tomadora ou intermediária, em ordem de NSU, até 50 por chamada com
 * lote=true. O caminho é "contribuintes", no plural.
 */
export const ADN_CONTRIBUINTES: Record<NfseEnvironmentName, string> = {
  producao: "https://adn.nfse.gov.br/contribuintes",
  restrita: "https://adn.producaorestrita.nfse.gov.br/contribuintes",
};

export interface AdnDocument {
  nsu: number;
  xml: string;
}

export interface AdnBatch {
  documents: AdnDocument[];
  done: boolean;
}

export class AdnRejectionError extends Error {}

/** Campo pelo nome, sem ligar para maiúsculas: o Swagger e a API já divergiram. */
function field(source: unknown, name: string): unknown {
  if (!source || typeof source !== "object") return undefined;
  const key = Object.keys(source).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : (source as Record<string, unknown>)[key];
}

function rejectionMessage(body: unknown, status: number): string {
  if (status === 401 || status === 403) return "O Sistema Nacional recusou o certificado da empresa.";
  const errors = field(body, "Erros");
  const described = (Array.isArray(errors) ? errors : [])
    .map((item) => [field(item, "Codigo"), field(item, "Descricao")].filter((part) => typeof part === "string" && part).join(" — "))
    .filter(Boolean);
  return described.length > 0 ? described.join(" · ") : `O Sistema Nacional recusou a consulta (HTTP ${status}).`;
}

export async function fetchAdnBatch(
  transport: HttpTransport,
  environment: NfseEnvironmentName,
  input: { fromNsu: number; cnpj: string },
): Promise<AdnBatch> {
  const url = `${ADN_CONTRIBUINTES[environment]}/DFe/${input.fromNsu}?lote=true&cnpjConsulta=${input.cnpj}`;
  const res = await transport({ method: "GET", url });
  if (res.status === 0 || res.status === 408 || res.status === 429 || res.status >= 500) {
    throw new NfseTransientError(`O Sistema Nacional respondeu ${res.status}.`);
  }
  let body: unknown = {};
  try {
    body = JSON.parse(res.body.toString("utf8"));
  } catch {
    body = {};
  }
  const status = String(field(body, "StatusProcessamento") ?? "");
  const items = field(body, "LoteDFe");
  if (status === "NENHUM_DOCUMENTO_LOCALIZADO" || (res.status === 404 && !Array.isArray(items))) {
    return { documents: [], done: true };
  }
  if (res.status < 200 || res.status >= 300 || status === "REJEICAO") {
    throw new AdnRejectionError(rejectionMessage(body, res.status));
  }
  const documents = (Array.isArray(items) ? items : []).flatMap((item) => {
    const nsu = Number(field(item, "NSU"));
    const xml = field(item, "ArquivoXml");
    return Number.isSafeInteger(nsu) && typeof xml === "string" ? [{ nsu, xml: gunzipBase64(xml) }] : [];
  });
  return { documents, done: documents.length === 0 };
}
```

- [ ] **Passo 4: rodar e ver passar.** **Passo 5: commit** — `feat: cliente da distribuicao do ADN por NSU`.

> **Conferência obrigatória antes do teste real (Tarefa 18):** os nomes
> `StatusProcessamento`, `LoteDFe`, `NSU`, `ArquivoXml`, `Erros`, `Codigo`,
> `Descricao` e o valor `NENHUM_DOCUMENTO_LOCALIZADO` vêm de implementações de
> terceiros e do manual; o parser não liga para maiúsculas, mas confira no
> Swagger (`https://adn.producaorestrita.nfse.gov.br/contribuintes/docs/index.html`)
> e ajuste fixture e parser juntos se divergir.

### Tarefa 8: a rodada (dependências injetadas)

**Arquivos:** criar `src/lib/nfse/xml-routine.ts` e `.test.ts`.

- [ ] **Passo 1: teste**

```ts
import { describe, expect, test, vi } from "vitest";

import type { AdnBatch } from "./adn-client";
import { testEventXml } from "./testing/adn";
import { TEST_ACCESS_KEY, testNfseXml } from "./testing/nfse-xml";
import { type ClientProgress, runXmlRoutine, type XmlRoutineClient } from "./xml-routine";

const PRESTADOR = "11222333000181";

function deps(batches: Record<string, AdnBatch[]>, overrides: { keepSince?: Date | null } = {}) {
  const saved: ClientProgress[] = [];
  const errors: { clientId: string; message: string }[] = [];
  return {
    saved,
    errors,
    deps: {
      keepSince: overrides.keepSince ?? null,
      fetchBatch: vi.fn(async (client: XmlRoutineClient) => {
        const next = batches[client.clientId]?.shift();
        if (!next) throw new Error("Sistema Nacional não respondeu.");
        return next;
      }),
      saveProgress: async (progress: ClientProgress) => {
        saved.push(progress);
      },
      saveError: async (clientId: string, message: string) => {
        errors.push({ clientId, message });
      },
    },
  };
}

describe("rodada da rotina de XML", () => {
  test("guarda as prestadas e os cancelamentos, lote a lote, e encerra no lote vazio", async () => {
    const { saved, deps: d } = deps({
      a: [
        { documents: [{ nsu: 1, xml: testNfseXml() }, { nsu: 2, xml: "<outro/>" }], done: false },
        { documents: [{ nsu: 3, xml: testEventXml(TEST_ACCESS_KEY) }], done: false },
        { documents: [], done: true },
      ],
    });
    const results = await runXmlRoutine([{ clientId: "a", cnpj: PRESTADOR, lastNsu: 0 }], d);
    expect(results).toEqual([{ clientId: "a", ok: true }]);
    expect(d.fetchBatch.mock.calls.map((call) => call[1])).toEqual([1, 3, 4]);
    expect(saved.map((p) => [p.issued.length, p.cancellations.length, p.lastNsu, p.finished])).toEqual([
      [1, 0, 2, false],
      [0, 1, 3, false],
      [0, 0, 3, true],
    ]);
    expect(saved[0].issued[0]).toMatchObject({ accessKey: TEST_ACCESS_KEY, nsu: 1, nfseNumber: "107" });
    expect(saved[1].cancellations[0]).toMatchObject({ accessKey: TEST_ACCESS_KEY, nsu: 3 });
  });

  test("'guardar a partir de' deixa de fora a nota anterior, mas avança o NSU", async () => {
    const { saved, deps: d } = deps(
      { a: [{ documents: [{ nsu: 1, xml: testNfseXml() }], done: false }, { documents: [], done: true }] },
      { keepSince: new Date("2026-11-01T00:00:00-03:00") },
    );
    await runXmlRoutine([{ clientId: "a", cnpj: PRESTADOR, lastNsu: 0 }], d);
    expect(saved[0]).toMatchObject({ issued: [], lastNsu: 1 });
  });

  test("uma empresa que falha não para as outras", async () => {
    const { errors, deps: d } = deps({ b: [{ documents: [], done: true }] });
    const results = await runXmlRoutine(
      [
        { clientId: "a", cnpj: PRESTADOR, lastNsu: 0 },
        { clientId: "b", cnpj: PRESTADOR, lastNsu: 7 },
      ],
      d,
    );
    expect(results).toEqual([
      { clientId: "a", ok: false, message: "Sistema Nacional não respondeu." },
      { clientId: "b", ok: true },
    ]);
    expect(errors).toEqual([{ clientId: "a", message: "Sistema Nacional não respondeu." }]);
  });

  test("lote que não avança o NSU é erro, não laço infinito", async () => {
    const { errors, deps: d } = deps({ a: [{ documents: [{ nsu: 5, xml: "<x/>" }], done: false }] });
    await runXmlRoutine([{ clientId: "a", cnpj: PRESTADOR, lastNsu: 5 }], d);
    expect(errors[0].message).toMatch(/NSU/);
  });
});
```

- [ ] **Passo 2: rodar e ver falhar.**

- [ ] **Passo 3: implementar `src/lib/nfse/xml-routine.ts`**

```ts
import type { AdnBatch } from "./adn-client";
import { readAdnDocument } from "./adn-documents";

export interface XmlRoutineClient {
  clientId: string;
  cnpj: string;
  lastNsu: number;
}

export interface IssuedToStore {
  accessKey: string;
  nsu: number;
  nfseNumber: string | null;
  issuedAt: Date;
  competence: string | null;
  xml: string;
}

export interface CancellationToStore {
  accessKey: string;
  nsu: number;
  cancelledAt: Date | null;
  xml: string;
}

/** Um lote lido de uma empresa. O NSU só avança junto com o que foi gravado. */
export interface ClientProgress {
  clientId: string;
  issued: IssuedToStore[];
  cancellations: CancellationToStore[];
  lastNsu: number;
  finished: boolean;
}

export interface XmlRoutineDeps {
  fetchBatch(client: XmlRoutineClient, fromNsu: number): Promise<AdnBatch>;
  saveProgress(progress: ClientProgress): Promise<void>;
  saveError(clientId: string, message: string): Promise<void>;
  /** "Guardar notas a partir de": nota emitida antes fica de fora. */
  keepSince: Date | null;
  /** Lotes por empresa numa rodada; o resto fica para a próxima (padrão 400 = 20 mil documentos). */
  maxBatchesPerClient?: number;
}

async function syncClient(client: XmlRoutineClient, deps: XmlRoutineDeps): Promise<void> {
  let lastNsu = client.lastNsu;
  for (let round = 0; round < (deps.maxBatchesPerClient ?? 400); round++) {
    const batch = await deps.fetchBatch(client, lastNsu + 1);
    if (batch.done) {
      await deps.saveProgress({ clientId: client.clientId, issued: [], cancellations: [], lastNsu, finished: true });
      return;
    }
    const highest = Math.max(...batch.documents.map((doc) => doc.nsu));
    if (highest <= lastNsu) throw new Error(`O Sistema Nacional devolveu o NSU ${highest} de novo; leitura interrompida.`);
    const issued: IssuedToStore[] = [];
    const cancellations: CancellationToStore[] = [];
    for (const doc of batch.documents) {
      const reading = readAdnDocument(doc.xml, client.cnpj);
      if (reading.kind === "issued" && (!deps.keepSince || reading.issuedAt >= deps.keepSince)) {
        issued.push({ ...reading, nsu: doc.nsu, xml: doc.xml });
      } else if (reading.kind === "cancellation") {
        cancellations.push({ accessKey: reading.accessKey, nsu: doc.nsu, cancelledAt: reading.cancelledAt, xml: doc.xml });
      }
    }
    lastNsu = highest;
    await deps.saveProgress({ clientId: client.clientId, issued, cancellations, lastNsu, finished: false });
  }
}

/** Uma empresa por vez (poucos pedidos ao Sistema Nacional); falha de uma não para as outras. */
export async function runXmlRoutine(
  clients: readonly XmlRoutineClient[],
  deps: XmlRoutineDeps,
): Promise<{ clientId: string; ok: boolean; message?: string }[]> {
  const results: { clientId: string; ok: boolean; message?: string }[] = [];
  for (const client of clients) {
    try {
      await syncClient(client, deps);
      results.push({ clientId: client.clientId, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha desconhecida.";
      await deps.saveError(client.clientId, message);
      results.push({ clientId: client.clientId, ok: false, message });
    }
  }
  return results;
}
```

- [ ] **Passo 4: rodar e ver passar.** **Passo 5: commit** — `feat: rodada da rotina de XML das empresas`.

### Tarefa 9: persistência do serviço fiscal + teste de banco

**Arquivos:** criar `src/lib/nfse/xml-repository.ts` e `src/lib/nfse/xml.db.test.ts`.

- [ ] **Passo 1: implementar `src/lib/nfse/xml-repository.ts`**

```ts
import "server-only";

import { gzipSync } from "node:zlib";

import { and, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { XML_ROUTINE_DEFAULTS, type XmlRoutineSchedule } from "@/domain/nfse-xml";

import type { CertificateCheck } from "./certificate-check";
import type { VaultEnvelope } from "./vault";
import type { ClientProgress } from "./xml-routine";

const gz = (xml: string) => gzipSync(Buffer.from(xml, "utf8"));

/** Publica a chave pública do cofre quando ela muda (troca da NFSE_VAULT_PRIVATE_KEY). */
export async function publishVaultKey(orgId: string, key: { keyId: string; publicKeySpki: string }): Promise<void> {
  const t = schema.nfseSettings;
  await withOrgTx(orgId, (tx) =>
    tx
      .update(t)
      .set({ vaultKeyId: key.keyId, vaultPublicKey: key.publicKeySpki })
      .where(and(eq(t.orgId, orgId), sql`${t.vaultKeyId} IS DISTINCT FROM ${key.keyId}`)),
  );
}

export async function listPendingCertificates(
  orgId: string,
): Promise<{ id: string; uploadedAt: Date; clientCnpj: string | null; envelope: VaultEnvelope }[]> {
  const c = schema.nfseClientCertificates;
  return withOrgTx(orgId, (tx) =>
    tx
      .select({ id: c.id, uploadedAt: c.uploadedAt, clientCnpj: schema.clients.cnpj, envelope: c.envelope })
      .from(c)
      .innerJoin(schema.clients, and(eq(schema.clients.orgId, c.orgId), eq(schema.clients.id, c.clientId)))
      .where(and(eq(c.orgId, orgId), eq(c.status, "pending"))),
  );
}

/** Grava a conferência só se o certificado ainda é o mesmo envio (um reenvio no meio vence). */
export async function saveCertificateCheck(
  orgId: string,
  input: { id: string; uploadedAt: Date; result: CertificateCheck; now: Date },
): Promise<void> {
  const c = schema.nfseClientCertificates;
  const values =
    input.result.status === "valid"
      ? { status: "valid" as const, statusMessage: null, certificateCnpj: input.result.cnpj, validUntil: input.result.validUntil }
      : { status: "invalid" as const, statusMessage: input.result.message.slice(0, 500), certificateCnpj: null, validUntil: null };
  await withOrgTx(orgId, (tx) =>
    tx
      .update(c)
      .set({ ...values, checkedAt: input.now })
      .where(and(eq(c.orgId, orgId), eq(c.id, input.id), eq(c.uploadedAt, input.uploadedAt), eq(c.status, "pending"))),
  );
}

export interface XmlRoutineState {
  schedule: XmlRoutineSchedule;
  keepSince: string | null;
  runRequestedAt: Date | null;
  lastRunStartedAt: Date | null;
}

export async function loadXmlRoutineState(orgId: string): Promise<XmlRoutineState> {
  const r = schema.nfseXmlRoutines;
  const [row] = await withOrgTx(orgId, (tx) => tx.select().from(r).where(eq(r.orgId, orgId)));
  if (!row) return { schedule: XML_ROUTINE_DEFAULTS, keepSince: null, runRequestedAt: null, lastRunStartedAt: null };
  return {
    schedule: { enabled: row.enabled, frequency: row.frequency, dayOfMonth: row.dayOfMonth, time: row.runTime },
    keepSince: row.keepSince,
    runRequestedAt: row.runRequestedAt,
    lastRunStartedAt: row.lastRunStartedAt,
  };
}

export async function markXmlRoutineRun(orgId: string, mark: { startedAt: Date } | { finishedAt: Date }): Promise<void> {
  const r = schema.nfseXmlRoutines;
  const set = "startedAt" in mark ? { lastRunStartedAt: mark.startedAt } : { lastRunFinishedAt: mark.finishedAt };
  await withOrgTx(orgId, (tx) =>
    tx.insert(r).values({ orgId, ...set }).onConflictDoUpdate({ target: r.orgId, set }),
  );
}

/** Empresas ativas com CNPJ e certificado válido e não vencido, com o cursor. */
export async function listRoutineClients(
  orgId: string,
  now: Date,
): Promise<{ clientId: string; cnpj: string; lastNsu: number; envelope: VaultEnvelope }[]> {
  const c = schema.nfseClientCertificates;
  const cl = schema.clients;
  const cur = schema.nfseDfeCursors;
  const rows = await withOrgTx(orgId, (tx) =>
    tx
      .select({ clientId: c.clientId, cnpj: cl.cnpj, lastNsu: cur.lastNsu, envelope: c.envelope })
      .from(c)
      .innerJoin(cl, and(eq(cl.orgId, c.orgId), eq(cl.id, c.clientId)))
      .leftJoin(cur, and(eq(cur.orgId, c.orgId), eq(cur.clientId, c.clientId)))
      .where(and(eq(c.orgId, orgId), eq(c.status, "valid"), gt(c.validUntil, now), eq(cl.active, true), isNotNull(cl.cnpj)))
      .orderBy(cl.name),
  );
  return rows.map((row) => ({ clientId: row.clientId, cnpj: row.cnpj as string, lastNsu: row.lastNsu ?? 0, envelope: row.envelope }));
}

/** Grava um lote e avança o cursor na mesma transação (rodada interrompida retoma sem duplicar). */
export async function saveAdnProgress(orgId: string, progress: ClientProgress, now: Date): Promise<void> {
  const n = schema.nfseIssuedNotes;
  const cur = schema.nfseDfeCursors;
  await withOrgTx(orgId, async (tx) => {
    if (progress.issued.length > 0) {
      await tx
        .insert(n)
        .values(
          progress.issued.map((note) => ({
            orgId,
            clientId: progress.clientId,
            accessKey: note.accessKey,
            nsu: note.nsu,
            nfseNumber: note.nfseNumber,
            issuedAt: note.issuedAt,
            competence: note.competence,
            xmlGz: gz(note.xml),
          })),
        )
        .onConflictDoNothing({ target: [n.orgId, n.accessKey] });
    }
    for (const cancellation of progress.cancellations) {
      await tx
        .update(n)
        .set({ cancelledAt: cancellation.cancelledAt ?? now, cancelNsu: cancellation.nsu, cancelXmlGz: gz(cancellation.xml) })
        .where(and(eq(n.orgId, orgId), eq(n.clientId, progress.clientId), eq(n.accessKey, cancellation.accessKey), isNull(n.cancelledAt)));
    }
    const finished = progress.finished ? { lastSyncedAt: now, initialSyncAt: sql`COALESCE(${cur.initialSyncAt}, ${now.toISOString()}::timestamptz)` } : {};
    await tx
      .insert(cur)
      .values({ orgId, clientId: progress.clientId, lastNsu: progress.lastNsu, lastError: null, updatedAt: now, ...(progress.finished ? { lastSyncedAt: now, initialSyncAt: now } : {}) })
      .onConflictDoUpdate({
        target: [cur.orgId, cur.clientId],
        set: { lastNsu: sql`GREATEST(${cur.lastNsu}, excluded.last_nsu)`, lastError: null, updatedAt: now, ...finished },
      });
  });
}

export async function saveAdnError(orgId: string, clientId: string, message: string, now: Date): Promise<void> {
  const cur = schema.nfseDfeCursors;
  const lastError = message.slice(0, 500);
  await withOrgTx(orgId, (tx) =>
    tx
      .insert(cur)
      .values({ orgId, clientId, lastError, updatedAt: now })
      .onConflictDoUpdate({ target: [cur.orgId, cur.clientId], set: { lastError, updatedAt: now } }),
  );
}
```

- [ ] **Passo 2: teste de banco `src/lib/nfse/xml.db.test.ts`**

```ts
/**
 * Pasta de XML e cofre contra um Postgres de verdade (PGlite), como
 * guilda_app: RLS, nota que não se apaga, só o cancelamento muda, cursor que
 * só avança.
 */
import { gunzipSync } from "node:zlib";

import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
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
const CLIENT = "00000000-0000-4000-8000-000000000001";
const KEY = "4".repeat(50);
const ENVELOPE = { v: 1 as const, keyId: "0123456789abcdef", wrappedKey: "AAAA", iv: "AAAA", ciphertext: "AAAA" };

beforeAll(async () => {
  await applyMigrations(client);
  await client.exec(`
    INSERT INTO organization (id, name, slug, created_at) VALUES ('${ORG}', 'Escritório', 'esc', now()), ('${OTHER}', 'Outro', 'outro', now());
    INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ('u1', 'Fiscal', 'f@x', true, now(), now());
    INSERT INTO clients (id, org_id, name, tax_regime, cnpj) VALUES ('${CLIENT}', '${ORG}', 'Padaria', 'simples', '33000167000101');
    INSERT INTO nfse_settings (org_id, provider_cnpj, dps_series) VALUES ('${ORG}', '11222333000181', '1');
  `);
  await client.exec("SET ROLE guilda_app;");
}, 120_000);

afterAll(() => client.close());

test("certificado: pendente, conferido, listado para a rotina; chave pública publicada", async () => {
  const { withOrgTx } = await import("@/db/org-tx");
  const repo = await import("./xml-repository");
  await withOrgTx(ORG, (tx) => tx.insert(schema.nfseClientCertificates).values({ orgId: ORG, clientId: CLIENT, envelope: ENVELOPE, uploadedBy: "u1" }));
  const [pending] = await repo.listPendingCertificates(ORG);
  expect(pending).toMatchObject({ clientCnpj: "33000167000101", envelope: ENVELOPE });
  const now = new Date("2026-10-19T12:00:00Z");
  await repo.saveCertificateCheck(ORG, { id: pending.id, uploadedAt: pending.uploadedAt, result: { status: "valid", cnpj: "33000167000101", validUntil: new Date("2027-03-19T00:00:00Z") }, now });
  expect(await repo.listPendingCertificates(ORG)).toEqual([]);
  expect(await repo.listRoutineClients(ORG, now)).toEqual([{ clientId: CLIENT, cnpj: "33000167000101", lastNsu: 0, envelope: ENVELOPE }]);
  // Vencido sai da rotina.
  expect(await repo.listRoutineClients(ORG, new Date("2027-04-01T00:00:00Z"))).toEqual([]);
  await repo.publishVaultKey(ORG, { keyId: "fedcba9876543210", publicKeySpki: "AAAA" });
  const [settings] = await withOrgTx(ORG, (tx) => tx.select({ keyId: schema.nfseSettings.vaultKeyId }).from(schema.nfseSettings));
  expect(settings.keyId).toBe("fedcba9876543210");
});

test("pasta: lote gravado uma vez só, cancelamento tardio, cursor só avança", async () => {
  const { withOrgTx } = await import("@/db/org-tx");
  const repo = await import("./xml-repository");
  const now = new Date("2026-10-19T12:00:00Z");
  const issued = { accessKey: KEY, nsu: 3, nfseNumber: "107", issuedAt: new Date("2026-09-30T23:59:00-03:00"), competence: "2026-09-30", xml: "<NFSe>107</NFSe>" };
  await repo.saveAdnProgress(ORG, { clientId: CLIENT, issued: [issued], cancellations: [], lastNsu: 3, finished: false }, now);
  await repo.saveAdnProgress(ORG, { clientId: CLIENT, issued: [issued], cancellations: [], lastNsu: 2, finished: true }, now);
  await repo.saveAdnProgress(ORG, { clientId: CLIENT, issued: [], cancellations: [{ accessKey: KEY, nsu: 9, cancelledAt: null, xml: "<evento/>" }], lastNsu: 9, finished: true }, now);
  const notes = await withOrgTx(ORG, (tx) => tx.select().from(schema.nfseIssuedNotes));
  expect(notes).toHaveLength(1);
  expect(gunzipSync(notes[0].xmlGz).toString("utf8")).toBe("<NFSe>107</NFSe>");
  expect(notes[0]).toMatchObject({ cancelNsu: 9, cancelledAt: now });
  const [cursor] = await withOrgTx(ORG, (tx) => tx.select().from(schema.nfseDfeCursors));
  expect(cursor).toMatchObject({ lastNsu: 9, lastError: null });
  expect(cursor.initialSyncAt).toEqual(now);

  // Outra organização não vê nada (RLS).
  expect(await withOrgTx(OTHER, (tx) => tx.select().from(schema.nfseIssuedNotes))).toEqual([]);
  // Nota não se apaga e o XML não muda.
  await expect(withOrgTx(ORG, (tx) => tx.execute(sql`DELETE FROM nfse_issued_notes`))).rejects.toThrow();
  await expect(withOrgTx(ORG, (tx) => tx.execute(sql`UPDATE nfse_issued_notes SET xml_gz = '\\x00'`))).rejects.toThrow();
});

test("rotina: estado padrão, início e fim da rodada", async () => {
  const repo = await import("./xml-repository");
  expect((await repo.loadXmlRoutineState(ORG)).schedule).toEqual({ enabled: true, frequency: "daily", dayOfMonth: null, time: "06:00" });
  const startedAt = new Date("2026-10-19T09:00:00Z");
  await repo.markXmlRoutineRun(ORG, { startedAt });
  await repo.markXmlRoutineRun(ORG, { finishedAt: new Date("2026-10-19T09:05:00Z") });
  expect((await repo.loadXmlRoutineState(ORG)).lastRunStartedAt).toEqual(startedAt);
});
```

- [ ] **Passo 3: rodar** — `npx vitest run src/lib/nfse/xml.db.test.ts` → PASS. Se o
  `saveAdnProgress` falhar no `COALESCE` do `initialSyncAt`, simplifique para
  ler o cursor antes e decidir em JS; o teste diz o comportamento esperado.

- [ ] **Passo 4: commit** — `feat: persistencia do cofre, da rotina e da pasta de XML`.

### Tarefa 10: o ciclo no serviço fiscal

**Arquivos:** criar `src/lib/nfse/xml-cycle.ts`; modificar `scripts/fiscal-service.ts`.

- [ ] **Passo 1: implementar `src/lib/nfse/xml-cycle.ts`**

```ts
import "server-only";

import { isXmlRoutineDue } from "@/domain/nfse-xml";

import { fetchAdnBatch } from "./adn-client";
import { loadNfseCertificate } from "./certificate";
import { checkClientCertificate } from "./certificate-check";
import { createMtlsTransport, type HttpTransport, type NfseEnvironmentName } from "./sefin-client";
import type { VaultKey } from "./vault";
import {
  listPendingCertificates,
  listRoutineClients,
  loadXmlRoutineState,
  markXmlRoutineRun,
  publishVaultKey,
  saveAdnError,
  saveAdnProgress,
  saveCertificateCheck,
} from "./xml-repository";
import { runXmlRoutine } from "./xml-routine";

/** A cada ciclo do serviço: publicar a chave e conferir os certificados enviados. */
export async function serviceVaultTick(orgId: string, vault: VaultKey): Promise<void> {
  await publishVaultKey(orgId, vault);
  for (const pending of await listPendingCertificates(orgId)) {
    const result = checkClientCertificate({ vault, envelope: pending.envelope, clientCnpj: pending.clientCnpj });
    await saveCertificateCheck(orgId, { id: pending.id, uploadedAt: pending.uploadedAt, result, now: new Date() });
    console.log(`Certificado ${pending.id}: ${result.status}.`);
  }
}

export async function isXmlRoutineDueNow(orgId: string, now: Date): Promise<boolean> {
  const state = await loadXmlRoutineState(orgId);
  return isXmlRoutineDue({ ...state, now });
}

/** Uma rodada inteira. O certificado de cada empresa é aberto em memória só para ela. */
export async function runXmlRoutineCycle(orgId: string, vault: VaultKey, environment: NfseEnvironmentName): Promise<void> {
  const startedAt = new Date();
  await markXmlRoutineRun(orgId, { startedAt });
  const state = await loadXmlRoutineState(orgId);
  const clients = await listRoutineClients(orgId, startedAt);
  const transports = new Map<string, HttpTransport>();
  const envelopes = new Map(clients.map((client) => [client.clientId, client.envelope]));
  const results = await runXmlRoutine(clients, {
    keepSince: state.keepSince ? new Date(`${state.keepSince}T00:00:00-03:00`) : null,
    fetchBatch: async (client, fromNsu) => {
      let transport = transports.get(client.clientId);
      if (!transport) {
        const secret = vault.open(envelopes.get(client.clientId)!);
        const certificate = loadNfseCertificate(secret.pfx, secret.password);
        transport = createMtlsTransport({ privateKeyPem: certificate.privateKeyPem, chainPem: certificate.chainPem });
        transports.set(client.clientId, transport);
      }
      return fetchAdnBatch(transport, environment, { fromNsu, cnpj: client.cnpj });
    },
    saveProgress: (progress) => saveAdnProgress(orgId, progress, new Date()),
    saveError: (clientId, message) => saveAdnError(orgId, clientId, message, new Date()),
  });
  await markXmlRoutineRun(orgId, { finishedAt: new Date() });
  const failed = results.filter((result) => !result.ok).length;
  console.log(`Rotina de XML: ${clients.length} empresa(s), ${failed} com erro.`);
}
```

- [ ] **Passo 2: ligar no `scripts/fiscal-service.ts`**

Acrescentar os imports:

```ts
import { loadVaultKey, type VaultKey } from "../src/lib/nfse/vault";
import { isXmlRoutineDueNow, runXmlRoutineCycle, serviceVaultTick } from "../src/lib/nfse/xml-cycle";
```

Logo depois de `openCertificate()`, uma função para o cofre:

```ts
/** Sem NFSE_VAULT_PRIVATE_KEY, o cofre e a rotina de XML ficam desligados (a emissão segue). */
function openVault(): VaultKey | null {
  const value = process.env.NFSE_VAULT_PRIVATE_KEY ?? "";
  if (!value) {
    console.warn("NFSE_VAULT_PRIVATE_KEY ausente: certificados das empresas e rotina de XML desligados.");
    return null;
  }
  try {
    return loadVaultKey(value);
  } catch {
    console.error("NFSE_VAULT_PRIVATE_KEY inválida: certificados das empresas e rotina de XML desligados.");
    return null;
  }
}
```

Em `main()`, antes do `while (true)`: `const vault = openVault(); let xmlRoutineRunning = false;`.
Dentro do laço, no ramo em que `settings?.template && settings.providerCnpj === certificate.cnpj`,
depois do `for` da fila de notas:

```ts
            if (vault) {
              await serviceVaultTick(orgId, vault);
              // A rodada pode levar minutos: corre por fora para não atrasar a emissão.
              if (!xmlRoutineRunning && (await isXmlRoutineDueNow(orgId, new Date()))) {
                xmlRoutineRunning = true;
                void runXmlRoutineCycle(orgId, vault, environment)
                  .catch((error) => console.error("Falha na rotina de XML:", describeError(error)))
                  .finally(() => {
                    xmlRoutineRunning = false;
                  });
              }
            }
```

Atualizar o comentário do topo do arquivo: o serviço também guarda o cofre dos
certificados das empresas e roda a rotina de XML.

- [ ] **Passo 3: verificar que o serviço sobe com `tsx`** (sem certificado, ele só avisa)

Run: `timeout 20 node --conditions=react-server --import=tsx scripts/fiscal-service.ts`
Expected: mensagens de "sem certificado"/"NFSE_VAULT_PRIVATE_KEY ausente", sem
erro de import. (Falha de banco sem `DATABASE_URL` é esperada aqui.)

- [ ] **Passo 4: commit** — `feat: servico fiscal confere certificados das empresas e roda a rotina de XML`.

---

## Entrega 3 — Telas e download

### Tarefa 11: `asFiscalOperator` compartilhado

**Arquivos:** criar `src/lib/office-fees/fiscal-operator.ts`; modificar `src/app/(app)/clans/[id]/nfse-actions.ts`.

- [ ] **Passo 1:** mover a função `asFiscalOperator` e o tipo `MemberContext` de
  `nfse-actions.ts` para `src/lib/office-fees/fiscal-operator.ts` (com
  `import "server-only";` no topo, exportando os dois), sem mudar o corpo. Em
  `nfse-actions.ts`, importar de lá e apagar a cópia.
- [ ] **Passo 2:** `npx tsc --noEmit -p .` limpo e `npx vitest run src/lib/nfse` PASS.
- [ ] **Passo 3: commit** — `refactor: asFiscalOperator compartilhado pelas actions do Fiscal`.

### Tarefa 12: leituras do lado do app

**Arquivos:** criar `src/lib/nfse/xml-requests.ts`.

- [ ] **Passo 1: implementar**

```ts
import "server-only";

import { gunzipSync } from "node:zlib";

import { and, asc, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import {
  certificateState,
  type CertificateStatus,
  emissionMonthRange,
  XML_ROUTINE_DEFAULTS,
  xmlCompanyFolder,
  xmlNoteFileName,
  type XmlRoutineSchedule,
} from "@/domain/nfse-xml";

import type { ArchiveCompany, ArchiveMissing } from "./xml-archive";

export interface ClientCertificateView {
  status: CertificateStatus;
  statusMessage: string | null;
  certificateCnpj: string | null;
  validUntil: string | null;
  uploadedAt: string;
}

export async function loadClientCertificates(tx: OrgTx, orgId: string): Promise<Map<string, ClientCertificateView>> {
  const c = schema.nfseClientCertificates;
  const rows = await tx
    .select({ clientId: c.clientId, status: c.status, statusMessage: c.statusMessage, certificateCnpj: c.certificateCnpj, validUntil: c.validUntil, uploadedAt: c.uploadedAt })
    .from(c)
    .where(eq(c.orgId, orgId));
  return new Map(
    rows.map((row) => [
      row.clientId,
      { status: row.status, statusMessage: row.statusMessage, certificateCnpj: row.certificateCnpj, validUntil: row.validUntil?.toISOString() ?? null, uploadedAt: row.uploadedAt.toISOString() },
    ]),
  );
}

/** Chave pública do cofre; null quando o serviço fiscal ainda não publicou (ou não existe, como na homologação). */
export async function loadVaultPublicKey(tx: OrgTx, orgId: string): Promise<{ keyId: string; publicKeySpki: string } | null> {
  const [row] = await tx
    .select({ keyId: schema.nfseSettings.vaultKeyId, publicKeySpki: schema.nfseSettings.vaultPublicKey })
    .from(schema.nfseSettings)
    .where(eq(schema.nfseSettings.orgId, orgId));
  return row?.keyId && row.publicKeySpki ? { keyId: row.keyId, publicKeySpki: row.publicKeySpki } : null;
}

export interface XmlRoutineView {
  schedule: XmlRoutineSchedule;
  /** "AAAA-MM" ou null = histórico inteiro. */
  keepSince: string | null;
  lastRunStartedAt: string | null;
  lastRunFinishedAt: string | null;
  runRequested: boolean;
  vaultReady: boolean;
  problems: { clientName: string; message: string }[];
}

export async function loadXmlRoutineView(tx: OrgTx, orgId: string, now: Date): Promise<XmlRoutineView> {
  const r = schema.nfseXmlRoutines;
  const [row] = await tx.select().from(r).where(eq(r.orgId, orgId));
  const certificates = await tx
    .select({ name: schema.clients.name, status: schema.nfseClientCertificates.status, validUntil: schema.nfseClientCertificates.validUntil })
    .from(schema.nfseClientCertificates)
    .innerJoin(schema.clients, and(eq(schema.clients.orgId, schema.nfseClientCertificates.orgId), eq(schema.clients.id, schema.nfseClientCertificates.clientId)))
    .where(eq(schema.nfseClientCertificates.orgId, orgId));
  const cursorErrors = await tx
    .select({ name: schema.clients.name, lastError: schema.nfseDfeCursors.lastError })
    .from(schema.nfseDfeCursors)
    .innerJoin(schema.clients, and(eq(schema.clients.orgId, schema.nfseDfeCursors.orgId), eq(schema.clients.id, schema.nfseDfeCursors.clientId)))
    .where(and(eq(schema.nfseDfeCursors.orgId, orgId), isNotNull(schema.nfseDfeCursors.lastError)));
  const problems = [
    ...certificates.flatMap((cert) => {
      const { state } = certificateState({ status: cert.status, validUntil: cert.validUntil, now });
      if (state === "expired") return [{ clientName: cert.name, message: "certificado vencido" }];
      if (state === "invalid") return [{ clientName: cert.name, message: "certificado com problema" }];
      return [];
    }),
    ...cursorErrors.map((cursor) => ({ clientName: cursor.name, message: (cursor.lastError ?? "").slice(0, 120) })),
  ];
  return {
    schedule: row ? { enabled: row.enabled, frequency: row.frequency, dayOfMonth: row.dayOfMonth, time: row.runTime } : XML_ROUTINE_DEFAULTS,
    keepSince: row?.keepSince?.slice(0, 7) ?? null,
    lastRunStartedAt: row?.lastRunStartedAt?.toISOString() ?? null,
    lastRunFinishedAt: row?.lastRunFinishedAt?.toISOString() ?? null,
    runRequested: Boolean(row?.runRequestedAt && (!row.lastRunStartedAt || row.runRequestedAt > row.lastRunStartedAt)),
    vaultReady: Boolean(await loadVaultPublicKey(tx, orgId)),
    problems,
  };
}

/** Quantas notas cada empresa emitiu no mês (e quantas foram canceladas). */
export async function countIssuedNotes(
  tx: OrgTx,
  input: { orgId: string; clientIds: string[]; year: number; month: number },
): Promise<Map<string, { total: number; cancelled: number }>> {
  if (input.clientIds.length === 0) return new Map();
  const n = schema.nfseIssuedNotes;
  const { start, end } = emissionMonthRange(input.year, input.month);
  const rows = await tx
    .select({
      clientId: n.clientId,
      total: sql<number>`count(*)::int`,
      cancelled: sql<number>`count(*) FILTER (WHERE ${n.cancelledAt} IS NOT NULL)::int`,
    })
    .from(n)
    .where(and(eq(n.orgId, input.orgId), inArray(n.clientId, input.clientIds), gte(n.issuedAt, start), lt(n.issuedAt, end)))
    .groupBy(n.clientId);
  return new Map(rows.map((row) => [row.clientId, { total: row.total, cancelled: row.cancelled }]));
}

/** Os meses da pasta de uma empresa, do mais recente ao mais antigo (mês de emissão em Brasília). */
export async function loadClientXmlMonths(
  tx: OrgTx,
  input: { orgId: string; clientId: string },
): Promise<{ year: number; month: number; total: number; cancelled: number }[]> {
  const n = schema.nfseIssuedNotes;
  const monthKey = sql<string>`to_char((${n.issuedAt} AT TIME ZONE 'UTC') - interval '3 hours', 'YYYY-MM')`;
  const rows = await tx
    .select({
      month: monthKey,
      total: sql<number>`count(*)::int`,
      cancelled: sql<number>`count(*) FILTER (WHERE ${n.cancelledAt} IS NOT NULL)::int`,
    })
    .from(n)
    .where(and(eq(n.orgId, input.orgId), eq(n.clientId, input.clientId)))
    .groupBy(monthKey)
    .orderBy(sql`1 DESC`);
  return rows.map((row) => ({ year: Number(row.month.slice(0, 4)), month: Number(row.month.slice(5, 7)), total: row.total, cancelled: row.cancelled }));
}

/**
 * O que vai no download do mês: as empresas do Controle mensal daquela
 * competência (ou só uma) com as notas do período, e, no do mês inteiro, o
 * LEIA-ME das que têm "Importar notas" marcado e ficaram sem XML.
 */
export async function loadXmlArchiveInput(
  tx: OrgTx,
  input: { orgId: string; year: number; month: number; clientId?: string; now: Date },
): Promise<{ companies: ArchiveCompany[]; missing: ArchiveMissing[] }> {
  const fcp = schema.fiscalControlPeriods;
  const cl = schema.clients;
  // Uma empresa (pasta dela, ou a linha do controle): direto do cadastro, esteja
  // ou não no controle daquele mês. O mês inteiro: as empresas do controle.
  const controlRows: { clientId: string; name: string; cnpj: string | null; nfsApplicability: string | null }[] = input.clientId
    ? await tx
        .select({ clientId: cl.id, name: cl.name, cnpj: cl.cnpj, nfsApplicability: sql<string | null>`NULL` })
        .from(cl)
        .where(and(eq(cl.orgId, input.orgId), eq(cl.id, input.clientId)))
    : await tx
        .select({ clientId: fcp.clientId, name: cl.name, cnpj: cl.cnpj, nfsApplicability: schema.fiscalClientProfiles.nfsApplicability })
        .from(fcp)
        .innerJoin(cl, and(eq(cl.orgId, fcp.orgId), eq(cl.id, fcp.clientId)))
        .leftJoin(schema.fiscalClientProfiles, and(eq(schema.fiscalClientProfiles.orgId, fcp.orgId), eq(schema.fiscalClientProfiles.id, fcp.profileId)))
        .where(and(eq(fcp.orgId, input.orgId), eq(fcp.periodYear, input.year), eq(fcp.periodMonth, input.month)))
        .orderBy(asc(cl.name));
  const clientIds = controlRows.map((row) => row.clientId);
  if (clientIds.length === 0) return { companies: [], missing: [] };

  const n = schema.nfseIssuedNotes;
  const { start, end } = emissionMonthRange(input.year, input.month);
  const notes = await tx
    .select({ clientId: n.clientId, nsu: n.nsu, nfseNumber: n.nfseNumber, xmlGz: n.xmlGz, cancelXmlGz: n.cancelXmlGz })
    .from(n)
    .where(and(eq(n.orgId, input.orgId), inArray(n.clientId, clientIds), gte(n.issuedAt, start), lt(n.issuedAt, end)))
    .orderBy(asc(n.nfseNumber), asc(n.nsu));
  const certificates = await loadClientCertificates(tx, input.orgId);
  const cursors = new Map(
    (
      await tx
        .select({ clientId: schema.nfseDfeCursors.clientId, initialSyncAt: schema.nfseDfeCursors.initialSyncAt, lastError: schema.nfseDfeCursors.lastError })
        .from(schema.nfseDfeCursors)
        .where(and(eq(schema.nfseDfeCursors.orgId, input.orgId), inArray(schema.nfseDfeCursors.clientId, clientIds)))
    ).map((row) => [row.clientId, row]),
  );

  const companies: ArchiveCompany[] = [];
  const missing: ArchiveMissing[] = [];
  for (const row of controlRows) {
    const mine = notes.filter((note) => note.clientId === row.clientId);
    if (mine.length > 0) {
      companies.push({
        folder: xmlCompanyFolder(row.name, row.cnpj),
        notes: mine.map((note) => ({
          fileName: xmlNoteFileName(note.nfseNumber, note.nsu),
          xml: gunzipSync(note.xmlGz).toString("utf8"),
          cancellation: note.cancelXmlGz ? gunzipSync(note.cancelXmlGz).toString("utf8") : null,
        })),
      });
      continue;
    }
    if (row.nfsApplicability !== "required" && !input.clientId) continue;
    const certificate = certificates.get(row.clientId);
    const cursor = cursors.get(row.clientId);
    const { state } = certificateState({ status: certificate?.status ?? null, validUntil: certificate?.validUntil ? new Date(certificate.validUntil) : null, now: input.now });
    const reason =
      state === "missing" ? "sem certificado cadastrado"
      : state === "pending" ? "certificado ainda em conferência"
      : state === "invalid" ? `certificado com problema: ${certificate?.statusMessage ?? "envie de novo"}`
      : state === "expired" ? "certificado vencido"
      : !cursor?.initialSyncAt ? (cursor?.lastError ? `a primeira leitura falhou: ${cursor.lastError}` : "primeira leitura ainda não feita")
      : cursor.lastError ? `a última rodada falhou: ${cursor.lastError}`
      : "nenhuma nota emitida no período";
    missing.push({ companyName: row.name, reason });
  }
  return { companies, missing };
}
```

- [ ] **Passo 2:** `npx tsc --noEmit -p .` (depende de `xml-archive.ts`: faça a Tarefa 13 antes de rodar, ou junto).
- [ ] **Passo 3: commit** junto com a Tarefa 13.

### Tarefa 13: montagem do .zip ou do XML único

**Arquivos:** criar `src/lib/nfse/xml-archive.ts` e `.test.ts`.

- [ ] **Passo 1: teste**

```ts
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, test } from "vitest";

import { buildXmlArchive } from "./xml-archive";

const note = (fileName: string, cancellation: string | null = null) => ({ fileName, xml: `<NFSe>${fileName}</NFSe>`, cancellation });

describe("arquivo de XML para baixar", () => {
  test("mês inteiro: pasta por empresa, canceladas à parte e LEIA-ME", () => {
    const archive = buildXmlArchive({
      baseName: "nfse-prestadas-2026-09",
      rangeLabel: "emitidas de 01/09 a 30/09",
      singleCompany: false,
      companies: [{ folder: "padaria-33000167", notes: [note("000107.xml"), note("000108.xml", "<evento/>")] }],
      missing: [{ companyName: "Mercado", reason: "certificado vencido" }],
    });
    expect(archive.kind).toBe("zip");
    expect(archive.fileName).toBe("nfse-prestadas-2026-09.zip");
    const files = unzipSync(archive.body);
    expect(Object.keys(files).sort()).toEqual([
      "LEIA-ME.txt",
      "padaria-33000167/000107.xml",
      "padaria-33000167/canceladas/000108-cancelamento.xml",
      "padaria-33000167/canceladas/000108.xml",
    ]);
    expect(strFromU8(files["LEIA-ME.txt"])).toContain("Mercado: certificado vencido");
  });

  test("uma empresa com uma nota não cancelada: o próprio XML", () => {
    const archive = buildXmlArchive({
      baseName: "nfse-prestadas-2026-09",
      rangeLabel: "emitidas de 01/09 a 30/09",
      singleCompany: true,
      companies: [{ folder: "padaria-33000167", notes: [note("000107.xml")] }],
      missing: [],
    });
    expect(archive).toMatchObject({ kind: "xml", fileName: "padaria-33000167-000107.xml" });
    expect(strFromU8(archive.body)).toBe("<NFSe>000107.xml</NFSe>");
  });

  test("uma empresa com cancelada ou com mais notas: .zip com o nome dela", () => {
    const archive = buildXmlArchive({
      baseName: "nfse-prestadas-2026-09",
      rangeLabel: "emitidas de 01/09 a 30/09",
      singleCompany: true,
      companies: [{ folder: "padaria-33000167", notes: [note("000107.xml", "<evento/>")] }],
      missing: [],
    });
    expect(archive).toMatchObject({ kind: "zip", fileName: "nfse-prestadas-2026-09-padaria-33000167.zip" });
  });

  test("nada no período: .zip só com o LEIA-ME", () => {
    const archive = buildXmlArchive({ baseName: "nfse-prestadas-2026-09", rangeLabel: "emitidas de 01/09 a 30/09", singleCompany: false, companies: [], missing: [] });
    expect(Object.keys(unzipSync(archive.body))).toEqual(["LEIA-ME.txt"]);
  });
});
```

- [ ] **Passo 2: rodar e ver falhar.**

- [ ] **Passo 3: implementar `src/lib/nfse/xml-archive.ts`**

```ts
import { strToU8, zipSync } from "fflate";

export interface ArchiveNote {
  fileName: string;
  xml: string;
  /** XML do evento de cancelamento; preenchido = nota cancelada. */
  cancellation: string | null;
}

export interface ArchiveCompany {
  folder: string;
  notes: ArchiveNote[];
}

export interface ArchiveMissing {
  companyName: string;
  reason: string;
}

export type XmlArchive = { kind: "xml" | "zip"; fileName: string; body: Uint8Array };

/** Uma empresa com uma nota não cancelada vem como o próprio XML (a regra do PDF); o resto, .zip. */
export function buildXmlArchive(input: {
  baseName: string;
  rangeLabel: string;
  singleCompany: boolean;
  companies: ArchiveCompany[];
  missing: ArchiveMissing[];
}): XmlArchive {
  const [only] = input.companies;
  if (input.singleCompany && input.companies.length === 1 && input.missing.length === 0 && only.notes.length === 1 && !only.notes[0].cancellation) {
    return { kind: "xml", fileName: `${only.folder}-${only.notes[0].fileName}`, body: strToU8(only.notes[0].xml) };
  }
  const files: Record<string, Uint8Array> = {};
  for (const company of input.companies) {
    for (const note of company.notes) {
      if (note.cancellation) {
        files[`${company.folder}/canceladas/${note.fileName}`] = strToU8(note.xml);
        files[`${company.folder}/canceladas/${note.fileName.replace(/\.xml$/, "-cancelamento.xml")}`] = strToU8(note.cancellation);
      } else {
        files[`${company.folder}/${note.fileName}`] = strToU8(note.xml);
      }
    }
  }
  if (input.missing.length > 0) {
    const lines = input.missing.map((item) => `${item.companyName}: ${item.reason}`);
    files["LEIA-ME.txt"] = strToU8(`NFS-e prestadas ${input.rangeLabel}.\n\nEmpresas sem XML neste arquivo:\n\n${lines.join("\n")}\n`);
  } else if (Object.keys(files).length === 0) {
    files["LEIA-ME.txt"] = strToU8(`Nenhuma NFS-e prestada ${input.rangeLabel}.\n`);
  }
  const fileName = input.singleCompany && only ? `${input.baseName}-${only.folder}.zip` : `${input.baseName}.zip`;
  return { kind: "zip", fileName, body: zipSync(files, { level: 6 }) };
}
```

- [ ] **Passo 4: rodar e ver passar.** `npx tsc --noEmit -p .` limpo.

- [ ] **Passo 5: commit** — `feat: leituras da pasta de XML e montagem do download`.

### Tarefa 14: Server Actions

**Arquivos:** criar `src/app/(app)/clans/[id]/nfse-xml-actions.ts`.

- [ ] **Passo 1: implementar**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import * as schema from "@/db/schema";
import { XML_ROUTINE_FREQUENCIES, XML_ROUTINE_TIME_PATTERN } from "@/domain/nfse-xml";
import { err, type ActionResult } from "@/lib/action-context";
import { vaultEnvelopeSchema } from "@/lib/nfse/vault";
import { loadClientXmlMonths, loadVaultPublicKey } from "@/lib/nfse/xml-requests";
import { asFiscalOperator } from "@/lib/office-fees/fiscal-operator";
import { and, eq } from "drizzle-orm";

const clientSchema = z.object({ clanId: z.uuid("Clã inválido."), clientId: z.uuid("Empresa inválida.") });

function revalidateClan() {
  revalidatePath("/clans/[id]", "page");
}

/** Recebe só o envelope cifrado no navegador: certificado e senha nunca chegam aqui. */
export async function uploadClientCertificate(input: z.input<typeof clientSchema> & { envelope: unknown }): Promise<ActionResult<null>> {
  const parsed = clientSchema.extend({ envelope: vaultEnvelopeSchema }).safeParse(input);
  if (!parsed.success) return err("Envio do certificado inválido. Recarregue a página e tente de novo.");
  const { clanId, clientId, envelope } = parsed.data;
  const result = await asFiscalOperator(clanId, async (tx, ctx) => {
    const [company] = await tx
      .select({ id: schema.clients.id })
      .from(schema.clients)
      .where(and(eq(schema.clients.orgId, ctx.orgId), eq(schema.clients.id, clientId)));
    if (!company) return err("Empresa não encontrada.");
    const vault = await loadVaultPublicKey(tx, ctx.orgId);
    if (!vault) return err("O serviço fiscal ainda não está pronto para receber certificados.");
    if (vault.keyId !== envelope.keyId) return err("A chave do serviço fiscal mudou. Recarregue a página e envie de novo.");
    const c = schema.nfseClientCertificates;
    const fresh = { envelope, status: "pending" as const, statusMessage: null, certificateCnpj: null, validUntil: null, checkedAt: null, uploadedBy: ctx.userId, uploadedAt: new Date() };
    await tx
      .insert(c)
      .values({ orgId: ctx.orgId, clientId, ...fresh })
      .onConflictDoUpdate({ target: [c.orgId, c.clientId], set: fresh });
    return { ok: true, data: null };
  });
  if (result.ok) revalidateClan();
  return result;
}

export async function removeClientCertificate(input: z.input<typeof clientSchema>): Promise<ActionResult<null>> {
  const parsed = clientSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Pedido inválido.");
  const { clanId, clientId } = parsed.data;
  const result = await asFiscalOperator(clanId, async (tx, ctx) => {
    const c = schema.nfseClientCertificates;
    await tx.delete(c).where(and(eq(c.orgId, ctx.orgId), eq(c.clientId, clientId)));
    return { ok: true, data: null };
  });
  if (result.ok) revalidateClan();
  return result;
}

export async function listClientXmlMonths(
  input: z.input<typeof clientSchema>,
): Promise<ActionResult<{ year: number; month: number; total: number; cancelled: number }[]>> {
  const parsed = clientSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Pedido inválido.");
  return asFiscalOperator(parsed.data.clanId, async (tx, ctx) => ({
    ok: true,
    data: await loadClientXmlMonths(tx, { orgId: ctx.orgId, clientId: parsed.data.clientId }),
  }));
}

const routineSchema = z
  .object({
    clanId: z.uuid("Clã inválido."),
    enabled: z.boolean(),
    frequency: z.enum(XML_ROUTINE_FREQUENCIES),
    dayOfMonth: z.number().int().min(1).max(28).nullable(),
    time: z.string().regex(XML_ROUTINE_TIME_PATTERN, "Horário no formato 06:00."),
    keepSince: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mês no formato AAAA-MM.").nullable(),
  })
  .refine((value) => (value.frequency === "monthly") === (value.dayOfMonth !== null), {
    message: "Escolha o dia do mês (1 a 28) para a rotina mensal.",
    path: ["dayOfMonth"],
  });

export async function saveXmlRoutineSettings(input: z.input<typeof routineSchema>): Promise<ActionResult<null>> {
  const parsed = routineSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Configuração inválida.");
  const { clanId, enabled, frequency, dayOfMonth, time, keepSince } = parsed.data;
  const result = await asFiscalOperator(clanId, async (tx, ctx) => {
    const r = schema.nfseXmlRoutines;
    const values = { enabled, frequency, dayOfMonth, runTime: time, keepSince: keepSince ? `${keepSince}-01` : null, updatedBy: ctx.userId, updatedAt: new Date() };
    await tx.insert(r).values({ orgId: ctx.orgId, ...values }).onConflictDoUpdate({ target: r.orgId, set: values });
    return { ok: true, data: null };
  });
  if (result.ok) revalidateClan();
  return result;
}

export async function requestXmlRoutineRun(input: { clanId: string }): Promise<ActionResult<null>> {
  const parsed = z.object({ clanId: z.uuid("Clã inválido.") }).safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Pedido inválido.");
  const result = await asFiscalOperator(parsed.data.clanId, async (tx, ctx) => {
    const r = schema.nfseXmlRoutines;
    const now = new Date();
    await tx.insert(r).values({ orgId: ctx.orgId, runRequestedAt: now }).onConflictDoUpdate({ target: r.orgId, set: { runRequestedAt: now } });
    return { ok: true, data: null };
  });
  if (result.ok) revalidateClan();
  return result;
}
```

(Ajuste a ordem dos imports ao lint do projeto; confirme o formato exato de
`ActionResult` em `src/lib/action-context.ts` e use o mesmo `{ ok: true, data }`
das outras actions.)

- [ ] **Passo 2:** `npx tsc --noEmit -p .` e `npm run lint` limpos.
- [ ] **Passo 3: commit** — `feat: actions do certificado das empresas e da rotina de XML`.

### Tarefa 15: rota de download

**Arquivos:** criar `src/app/api/nfse/xml/route.ts`.

- [ ] **Passo 1: implementar** (no molde de `src/app/api/nfse/pdfs/route.ts`)

```ts
import { z } from "zod";

import { withOrgTx } from "@/db/org-tx";
import { canManageFiscalOperations } from "@/domain/guild-permissions";
import { emissionRangeLabel } from "@/domain/nfse-xml";
import { requireMemberContext } from "@/lib/action-context";
import { buildXmlArchive } from "@/lib/nfse/xml-archive";
import { loadXmlArchiveInput } from "@/lib/nfse/xml-requests";
import { requireFiscalClan } from "@/lib/office-fees/fiscal-clan";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  clanId: z.uuid(),
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  clientId: z.uuid().optional(),
});

function text(status: number, message: string): Response {
  return new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

/** XML das NFS-e prestadas do mês, da pasta guardada pela rotina. Sai do banco; não passa pelo serviço fiscal. */
export async function GET(request: Request): Promise<Response> {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return text(400, "Pedido inválido.");
  const query = parsed.data;
  const ctx = await requireMemberContext();
  if (!ctx.ok) return text(401, ctx.error);

  const loaded = await withOrgTx(ctx.orgId, async (tx) => {
    const fiscal = await requireFiscalClan(tx, { orgId: ctx.orgId, clanId: query.clanId, userId: ctx.userId, role: ctx.role });
    if (!fiscal || !canManageFiscalOperations(fiscal.facts)) return null;
    return loadXmlArchiveInput(tx, { orgId: ctx.orgId, year: query.year, month: query.month, clientId: query.clientId, now: new Date() });
  });
  if (!loaded) return text(403, "Sem permissão para os XML do Fiscal.");

  const month = String(query.month).padStart(2, "0");
  const archive = buildXmlArchive({
    baseName: `nfse-prestadas-${query.year}-${month}`,
    rangeLabel: emissionRangeLabel(query.year, query.month),
    singleCompany: Boolean(query.clientId),
    ...loaded,
  });
  return new Response(archive.body, {
    headers: {
      "Content-Type": archive.kind === "xml" ? "application/xml" : "application/zip",
      "Content-Disposition": `attachment; filename="${archive.fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
```

(O nome do arquivo só tem `[a-z0-9-.]`: vem de `xmlCompanyFolder`, seguro no cabeçalho.)

- [ ] **Passo 2:** tsc e lint limpos. **Passo 3: commit** — `feat: download dos XML das NFS-e prestadas`.

### Tarefa 16: certificado e pasta na Carteira

**Arquivos:** criar `src/app/(app)/clans/[id]/client-certificate-dialog.tsx`;
modificar `portfolio-tab.tsx` e `portfolio-board.tsx`.

- [ ] **Passo 1: dados na Carteira.** Em `portfolio-tab.tsx`, dentro do
  `withOrgTx` que carrega a carteira, carregar também
  `loadClientCertificates(tx, orgId)` e `loadVaultPublicKey(tx, orgId)`
  (de `@/lib/nfse/xml-requests`). Em `PortfolioClientView`
  (`portfolio-board.tsx`) acrescentar `certificate: ClientCertificateView | null`
  e preencher em `toView` com `certificates.get(clientId) ?? null`. Passar
  `vaultKey` ao `PortfolioBoard` (prop nova) e dele ao diálogo.

- [ ] **Passo 2: criar `client-certificate-dialog.tsx`**

```tsx
"use client";

import { FileKey2, LoaderCircle, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCnpj } from "@/domain/cnpj";
import { certificateState } from "@/domain/nfse-xml";
import { sealCertificate } from "@/lib/nfse/vault-browser";
import type { ClientCertificateView } from "@/lib/nfse/xml-requests";

import { listClientXmlMonths, removeClientCertificate, uploadClientCertificate } from "./nfse-xml-actions";

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

/** Selo da Carteira: só quando há o que fazer (vence em < 30 dias, venceu, problema). */
export function CertificateBadge({ certificate }: { certificate: ClientCertificateView | null }) {
  const { state, daysLeft } = certificateState({
    status: certificate?.status ?? null,
    validUntil: certificate?.validUntil ? new Date(certificate.validUntil) : null,
    now: new Date(),
  });
  if (state === "expiring") return <Badge variant="outline" className="shrink-0 border-warning/40 text-[10px] text-warning">certificado vence em {daysLeft} d</Badge>;
  if (state === "expired") return <Badge variant="outline" className="shrink-0 border-destructive/40 text-[10px] text-destructive">certificado vencido</Badge>;
  if (state === "invalid") return <Badge variant="outline" className="shrink-0 border-destructive/40 text-[10px] text-destructive">certificado com problema</Badge>;
  return null;
}

export function ClientCertificateDialog({
  clanId,
  clientId,
  clientName,
  certificate,
  vaultKey,
  canManage,
}: {
  clanId: string;
  clientId: string;
  clientName: string;
  certificate: ClientCertificateView | null;
  vaultKey: { keyId: string; publicKeySpki: string } | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [months, setMonths] = useState<{ year: number; month: number; total: number; cancelled: number }[] | null>(null);
  const [pending, startTransition] = useTransition();
  const { state } = certificateState({
    status: certificate?.status ?? null,
    validUntil: certificate?.validUntil ? new Date(certificate.validUntil) : null,
    now: new Date(),
  });

  const summary =
    state === "missing" ? "Nenhum certificado enviado."
    : state === "pending" ? "Certificado enviado; o serviço fiscal está conferindo."
    : state === "invalid" ? `Problema: ${certificate?.statusMessage ?? "envie de novo"}.`
    : state === "expired" ? `Vencido em ${dateLabel(certificate!.validUntil!)}.`
    : `Válido até ${dateLabel(certificate!.validUntil!)} · ${formatCnpj(certificate!.certificateCnpj!)}`;

  function loadMonths() {
    startTransition(async () => {
      const result = await listClientXmlMonths({ clanId, clientId });
      setMonths(result.ok ? (result.data ?? []) : []);
      if (!result.ok) toast.error(result.error);
    });
  }

  function upload() {
    if (!file || !vaultKey) return;
    startTransition(async () => {
      const envelope = await sealCertificate({ ...vaultKey, pfx: new Uint8Array(await file.arrayBuffer()), password });
      const result = await uploadClientCertificate({ clanId, clientId, envelope });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setFile(null);
      setPassword("");
      toast.success("Certificado enviado. O serviço fiscal confere em instantes.");
      router.refresh();
    });
  }

  function remove() {
    if (!window.confirm(`Remover o certificado de ${clientName}? A rotina deixa de ler as notas dela.`)) return;
    startTransition(async () => {
      const result = await removeClientCertificate({ clanId, clientId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Certificado removido.");
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && months === null) loadMonths();
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          <FileKey2 aria-hidden /> XML
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Certificado e XML · {clientName}</DialogTitle>
          <DialogDescription>
            Com o certificado A1 da empresa, a rotina guarda aqui os XML das NFS-e que ela emitiu.
          </DialogDescription>
        </DialogHeader>

        <section className="grid gap-2">
          <h3>Certificado A1</h3>
          <p className="text-sm text-muted-foreground">{summary}</p>
          {canManage ? (
            vaultKey ? (
              <div className="grid gap-2">
                <Label htmlFor={`${clientId}-pfx`}>Arquivo .pfx ou .p12</Label>
                <Input id={`${clientId}-pfx`} type="file" accept=".pfx,.p12" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
                <Label htmlFor={`${clientId}-password`}>Senha do certificado</Label>
                <Input id={`${clientId}-password`} type="password" autoComplete="off" value={password} onChange={(event) => setPassword(event.target.value)} />
                <p className="text-xs text-muted-foreground">O arquivo e a senha são cifrados neste navegador; só o serviço fiscal consegue abri-los.</p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" disabled={!file || !password || pending} onClick={upload}>
                    {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Upload aria-hidden />}
                    {certificate ? "Trocar certificado" : "Enviar certificado"}
                  </Button>
                  {certificate ? (
                    <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={remove}>
                      <Trash2 aria-hidden /> Remover
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">O serviço fiscal ainda não está pronto para receber certificados.</p>
            )
          ) : null}
        </section>

        <section className="grid gap-2">
          <h3>Pasta de XML</h3>
          {months === null ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : months.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma nota guardada ainda.</p>
          ) : (
            <ul className="grid gap-1">
              {months.map((item) => (
                <li key={`${item.year}-${item.month}`} className="flex items-center justify-between gap-2 text-sm">
                  <span>
                    {MONTHS[item.month - 1]}/{item.year} — <span className="font-mono">{item.total}</span> nota(s)
                    {item.cancelled > 0 ? `, ${item.cancelled} cancelada(s)` : ""}
                  </span>
                  <Button asChild size="sm" variant="outline">
                    <a href={`/api/nfse/xml?clanId=${clanId}&year=${item.year}&month=${item.month}&clientId=${clientId}`}>Baixar</a>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}
```

(O download por mês da pasta usa `clientId`: `loadXmlArchiveInput` busca a
empresa direto no cadastro, esteja ou não no Controle mensal daquele mês.
Cubra isso com um teste no `xml.db.test.ts`: uma nota guardada de uma empresa
sem linha no controle sai no download com `clientId`.)

- [ ] **Passo 3: na linha da empresa (`portfolio-board.tsx`)**, ao lado de
  `<FiscalProfileDialog ... />`, renderizar
  `<CertificateBadge certificate={client.certificate} />` (antes do selo de
  regime) e `<ClientCertificateDialog clanId={clanId} clientId={client.id} clientName={client.name} certificate={client.certificate} vaultKey={vaultKey} canManage={canManage} />`.
  Faça nas duas ocorrências do `FiscalProfileDialog` (linhas ~124 e ~193).

- [ ] **Passo 4:** tsc, lint e build limpos. **Verificação visual** (regra 7):
  a linha da Carteira não pode quebrar no celular (375 px) com o selo novo.
- [ ] **Passo 5: commit** — `feat: certificado A1 e pasta de XML da empresa na Carteira`.

### Tarefa 17: rotina e downloads no Controle mensal

**Arquivos:** criar `src/app/(app)/clans/[id]/xml-routine-panel.tsx`;
modificar `fiscal-control-tab.tsx` e `fiscal-control-board.tsx`.

- [ ] **Passo 1: dados.** Em `fiscal-control-tab.tsx`, no `withOrgTx`,
  carregar `loadXmlRoutineView(tx, orgId, new Date())` e
  `countIssuedNotes(tx, { orgId, clientIds: rows.map((row) => row.clientId), year: period.year, month: period.month })`.
  Em `FiscalControlRowView` acrescentar `xmlNotes: { total: number; cancelled: number }`
  (zero quando não houver) e passar `xmlRoutine` ao `FiscalControlBoard`.

- [ ] **Passo 2: criar `xml-routine-panel.tsx`**

```tsx
"use client";

import { Download, LoaderCircle, Play, Settings2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { emissionRangeLabel } from "@/domain/nfse-xml";
import type { XmlRoutineView } from "@/lib/nfse/xml-requests";

import { requestXmlRoutineRun, saveXmlRoutineSettings } from "./nfse-xml-actions";

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function XmlRoutinePanel({
  clanId,
  year,
  month,
  routine,
  totalNotes,
  canManage,
}: {
  clanId: string;
  year: number;
  month: number;
  routine: XmlRoutineView;
  totalNotes: number;
  canManage: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(routine.schedule.enabled);
  const [frequency, setFrequency] = useState(routine.schedule.frequency);
  const [day, setDay] = useState(String(routine.schedule.dayOfMonth ?? 1));
  const [time, setTime] = useState(routine.schedule.time);
  const [keepSince, setKeepSince] = useState(routine.keepSince ?? "");

  const status = routine.runRequested
    ? "Rodada pedida; começa em instantes."
    : routine.lastRunStartedAt
      ? `Lidos em ${timeLabel(routine.lastRunFinishedAt ?? routine.lastRunStartedAt)}`
      : "A rotina ainda não rodou.";

  function save() {
    startTransition(async () => {
      const result = await saveXmlRoutineSettings({
        clanId,
        enabled,
        frequency,
        dayOfMonth: frequency === "monthly" ? Number(day) : null,
        time,
        keepSince: keepSince || null,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Rotina de XML atualizada.");
      setOpen(false);
      router.refresh();
    });
  }

  function runNow() {
    startTransition(async () => {
      const result = await requestXmlRoutineRun({ clanId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Rodada pedida ao serviço fiscal.");
      router.refresh();
    });
  }

  return (
    <div className="grid gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="hud-label">XML das NFS-e prestadas</span>
          <p className="text-sm text-muted-foreground">
            {routine.vaultReady ? status : "O serviço fiscal ainda não está pronto para a rotina."}
            {routine.problems.length > 0
              ? ` · ${routine.problems.length} empresa(s) com problema: ${routine.problems.map((p) => `${p.message} (${p.clientName})`).join(", ")}`
              : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button asChild size="sm" variant="outline">
            <a href={`/api/nfse/xml?clanId=${clanId}&year=${year}&month=${month}`}>
              <Download aria-hidden /> Baixar XML — {emissionRangeLabel(year, month)} ({totalNotes})
            </a>
          </Button>
          {canManage ? (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button type="button" size="icon-sm" variant="ghost" aria-label="Configurar a rotina de XML">
                  <Settings2 aria-hidden />
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Rotina de XML</DialogTitle>
                  <DialogDescription>Quando a Guilda busca no Sistema Nacional as notas que as empresas emitiram.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="size-4 accent-primary" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
                    Rotina ligada
                  </label>
                  <div className="grid gap-1">
                    <Label htmlFor="xml-frequency">Quando rodar</Label>
                    <select
                      id="xml-frequency"
                      className="h-9 rounded-md border bg-transparent px-2 text-sm"
                      value={frequency}
                      onChange={(event) => setFrequency(event.target.value as typeof frequency)}
                    >
                      <option value="daily">Todo dia</option>
                      <option value="monthly">Só num dia do mês</option>
                    </select>
                  </div>
                  {frequency === "monthly" ? (
                    <div className="grid gap-1">
                      <Label htmlFor="xml-day">Dia do mês (1 a 28)</Label>
                      <Input id="xml-day" type="number" min={1} max={28} value={day} onChange={(event) => setDay(event.target.value)} />
                    </div>
                  ) : null}
                  <div className="grid gap-1">
                    <Label htmlFor="xml-time">Horário (Brasília)</Label>
                    <Input id="xml-time" type="time" value={time} onChange={(event) => setTime(event.target.value)} />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="xml-since">Guardar notas a partir de</Label>
                    <Input id="xml-since" type="month" value={keepSince} onChange={(event) => setKeepSince(event.target.value)} />
                    <p className="text-xs text-muted-foreground">Vazio guarda o histórico inteiro.</p>
                  </div>
                  <div className="flex flex-wrap justify-between gap-2">
                    <Button type="button" variant="outline" size="sm" disabled={pending || !routine.vaultReady} onClick={runNow}>
                      <Play aria-hidden /> Rodar agora
                    </Button>
                    <Button type="button" size="sm" disabled={pending} onClick={save}>
                      {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : null} Salvar
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          ) : null}
        </div>
      </div>
    </div>
  );
}
```

(Confira em `src/components/ui/button.tsx` se o tamanho `icon-sm` existe —
o Controle mensal já usa. Se o projeto tiver padrão de `<select>` no
`components/ui/select.tsx`, prefira ele, seguindo `docs/design-system.md`.)

- [ ] **Passo 3: no `fiscal-control-board.tsx`**, receber `xmlRoutine: XmlRoutineView`;
  quando `rows.length > 0`, renderizar
  `<XmlRoutinePanel clanId={clanId} year={year} month={month} routine={xmlRoutine} totalNotes={rows.reduce((sum, row) => sum + row.xmlNotes.total, 0)} canManage={canManage} />`
  logo abaixo da grade de status (`clan-status-grid`). Na linha de cada
  empresa, perto da etapa "Notas", quando `row.xmlNotes.total > 0`, um link
  `<a href={`/api/nfse/xml?clanId=${clanId}&year=${year}&month=${month}&clientId=${row.clientId}`}>XML ({row.xmlNotes.total})</a>`
  com o estilo de botão pequeno `variant="ghost" size="sm"` (use `Button asChild`).

- [ ] **Passo 4:** tsc, lint, testes e build limpos. **Verificação visual**
  (regra 7): painel e link na linha no celular (375 px) e no desktop.
- [ ] **Passo 5: commit** — `feat: rotina e download dos XML no Controle mensal`.

---

## Entrega 4 — Documentação, publicação e teste real

### Tarefa 18: documentação e publicação na homologação

- [ ] **Passo 1: `CLAUDE.md`** — nova seção depois de "Notas de honorário pela
  API nacional", resumindo: certificados A1 das empresas só como envelope
  cifrado no navegador (`vault.ts`/`vault-browser.ts`), quem abre é o serviço
  fiscal; rotina configurável (`nfse_xml_routines`) lê a distribuição do ADN
  por NSU com o certificado de cada empresa e **guarda** o XML compactado em
  `nfse_issued_notes` (exceção consciente à regra de não guardar XML das notas
  de honorário); o mês vale pela data de emissão em Brasília e a competência
  do Controle mensal é o mês apurado; download sai do banco pela
  `/api/nfse/xml`; não levar certificado de empresa para o app.
- [ ] **Passo 2: `docs/environments.md`** — no bloco do serviço fiscal, a
  variável `NFSE_VAULT_PRIVATE_KEY` (serviço fiscal; gerada pelo Bruno com
  `node scripts/nfse-vault-key.mjs`; sem ela o cofre e a rotina ficam
  desligados; trocá-la obriga a reenviar os certificados).
- [ ] **Passo 3: verificação completa** (um comando por vez): `npx tsc --noEmit -p .`,
  `npm run lint`, `npx vitest run`, `rm -rf .next && npm run build`.
- [ ] **Passo 4: commit e push na develop**

```bash
git add CLAUDE.md docs/environments.md
git commit -m "docs: XML das NFS-e prestadas das empresas"
git push origin develop
```

- [ ] **Passo 5: abrir o PR de produção, sem mesclar**

`gh pr create --base main --head develop --title "release: XML das NFS-e prestadas das empresas"`
com o que sobe, como foi conferido e, em destaque, **o que o Bruno faz no
Easypanel depois do merge**: gerar a chave (`node scripts/nfse-vault-key.mjs`),
pôr em `NFSE_VAULT_PRIVATE_KEY` no `guilda-fiscal` e reimplantar o serviço.
Corpo terminando com `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
**Parar aqui**: o merge e o deploy de produção dependem do "pode mesclar" do Bruno.

### Tarefa 19: teste real com uma empresa (depois do merge, com o Bruno)

Roteiro para o Claude principal conduzir com o Bruno; nenhum agente faz
sozinho:

1. Bruno gera a chave e coloca `NFSE_VAULT_PRIVATE_KEY` no `guilda-fiscal`;
   reimplanta. O log deve mostrar a rotina e nenhum "chave ausente".
2. Na Carteira, Bruno envia o certificado de **uma** empresa. Em segundos a
   tela mostra "Válido até ...".
3. Bruno ajusta "Guardar notas a partir de" se não quiser o histórico inteiro
   e clica **Rodar agora**.
4. Conferir no log a primeira chamada ao ADN. **Se o formato da resposta
   divergir do esperado** (Tarefa 7), ajustar parser e fixture juntos.
5. Comparar a contagem de setembro na Guilda com a do Portal Nacional para a
   mesma empresa; baixar o XML e abrir um arquivo.
6. Só então cadastrar as outras empresas.
