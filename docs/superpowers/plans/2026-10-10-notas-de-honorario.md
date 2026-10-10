# Notas de honorário pela API nacional — plano de implementação (etapa 1)

> **Para agentes:** executar tarefa a tarefa (superpowers:executing-plans). Os
> passos usam checkbox (`- [ ]`). Desenho em
> `docs/superpowers/specs/2026-10-10-notas-de-honorario-design.md`.

**Objetivo:** emitir, cancelar e baixar os PDFs das NFS-e de honorário a partir
da aba Honorários, por um serviço fiscal separado que guarda o certificado e
fala com a API do Sistema Nacional NFS-e (produção restrita nesta etapa).

**Arquitetura:** regras puras em `src/domain/nfse.ts`; montagem e assinatura do
XML, cliente HTTP com mTLS e orquestração de uma nota em `src/lib/nfse/*`
(sem banco, testáveis); três tabelas novas com RLS (`nfse_settings`,
`nfse_invoices`, `nfse_invoice_events`); o app grava pedidos numa fila no banco
e o serviço fiscal (`scripts/fiscal-service.ts`, outro serviço do Easypanel com
`GUILDA_SERVICE=fiscal`) consome a fila e serve o `.zip` de PDFs pela rede
interna. Nada de PDF ou XML é guardado.

**Stack:** Next.js (Server Actions + Route Handler), Drizzle + Postgres (RLS,
`guilda_app`), Zod, Vitest, `xml-crypto` + `@xmldom/xmldom` (XMLDSIG),
`node-forge` (PKCS#12), `fflate` (zip), `xmllint-wasm` (validação contra os XSD
oficiais, só em teste).

**Convenções do repositório:** commits na `develop`, em português sem acento,
terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
Antes do push: `npx vitest run`, `npx tsc --noEmit -p .`, `npx eslint` nos
arquivos tocados e `npm run build` (em OneDrive, `NODE_OPTIONS=--max-old-space-size=6144`
e sem `next dev` rodando junto).

**Fatos da API usados aqui** (manual dos contribuintes v1.2, esquemas XSD v1.01
de 09/02/2026, guia de assinatura do Sistema Nacional):

- Sefin: restrita `https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional`,
  produção `https://sefin.nfse.gov.br/SefinNacional`. ADN (DANFSe): restrita
  `https://adn.producaorestrita.nfse.gov.br`, produção `https://adn.nfse.gov.br`.
- `POST /nfse` com `{ "dpsXmlGZipB64": ... }`; `GET /dps/{id}`; `GET /nfse/{chave}`;
  `POST /nfse/{chave}/eventos` com `{ "pedidoRegistroEventoXmlGZipB64": ... }`;
  `GET /danfse/{chave}` no ADN.
- Assinatura: XMLDSIG envelopada no elemento com `Id`, RSA-SHA256, digest SHA-256,
  transforms enveloped + C14N, só o certificado final no `X509Data`.
- Id da DPS: `DPS` + município (7) + tipo de inscrição (`2` = CNPJ) + CNPJ (14)
  + série (5) + número (15). Id do pedido de evento: `PRE` + chave (50) + `101101`.
- Série da DPS de aplicativo próprio: 1 a 49999 (70000–79999 é do Emissor Web,
  onde o Fiscal emite hoje à mão — por isso não colide).
- `E0014`: DPS com mesma série/número/município/CNPJ já gerou NFS-e.
- `dCompet` não pode ser posterior a `dhEmi`. `xMotivo` do cancelamento tem de
  15 a 255 caracteres.

Pontos que só a produção restrita confirma (etapa 2, fora deste plano): o
formato exato das respostas JSON, se o ADN ainda serve o DANFSe e o
comportamento do `GET /dps/{id}` para DPS inexistente. O código já trata as
variações conhecidas e falha com mensagem legível nas desconhecidas.

---

## Mapa de arquivos

| Arquivo | Responsabilidade |
| --- | --- |
| `src/domain/nfse.ts` | Regras puras: ids, série, valores, competência, seleção do lote, saúde do serviço, nome do PDF |
| `src/lib/nfse/template.ts` | Modelo da nota (Zod) |
| `src/lib/nfse/xml.ts` | Escape, elemento, gzip+base64, leitura de um campo |
| `src/lib/nfse/time.ts` | `dhEmi` e "hoje" no fuso da Guilda |
| `src/lib/nfse/dps-xml.ts` | XML da DPS |
| `src/lib/nfse/cancel-xml.ts` | XML do pedido de cancelamento |
| `src/lib/nfse/certificate.ts` | Abre o `.pfx` (A1) e extrai chave, cadeia, CNPJ e validade |
| `src/lib/nfse/sign.ts` | Assinatura XMLDSIG |
| `src/lib/nfse/sefin-client.ts` | Transporte mTLS e cliente do Sistema Nacional |
| `src/lib/nfse/processor.ts` | Decide o desfecho de uma nota da fila (emitir ou cancelar) |
| `src/lib/nfse/danfse-zip.ts` | Valida o pedido de PDFs, monta o `.zip`, confere o token |
| `src/lib/nfse/requests.ts` | Lado do app: prévia, enfileirar, cancelar, reenviar, configurar, listar |
| `src/lib/nfse/repository.ts` | Lado do serviço: batimento, reivindicar e finalizar nota |
| `src/lib/nfse/testing/*.ts` | Certificado de teste e validação XSD (só testes) |
| `src/lib/nfse/xsd/1.01/*.xsd` | Esquemas oficiais (só testes) |
| `src/lib/office-fees/step-change.ts` | Muda uma etapa do controle mensal (tela e serviço) |
| `src/lib/office-fees/fiscal-clan.ts` | `requireFiscalClan`, saído de dentro do arquivo de actions |
| `src/db/schema/domain.ts` + migração `0080` | Tabelas, RLS, privilégios, função de batimento |
| `scripts/fiscal-service.ts` | O serviço fiscal (fila + HTTP interno de PDFs) |
| `scripts/start-production.mjs` | `GUILDA_SERVICE=fiscal` sobe só o serviço fiscal |
| `src/app/(app)/clans/[id]/nfse-actions.ts` | Server Actions |
| `src/app/api/nfse/pdfs/route.ts` | Download do `.zip` de PDFs |
| `src/app/(app)/clans/[id]/nfse-panel.tsx` | Painel, prévia, cancelamento |
| `src/app/(app)/clans/[id]/nfse-settings-dialog.tsx` | Modelo da nota (admin) |

---

### Tarefa 1: Dependências e esquemas oficiais

**Arquivos:**
- Modificar: `package.json`, `package-lock.json`
- Criar: `src/lib/nfse/xsd/1.01/` (10 arquivos `.xsd` oficiais)

- [ ] **Passo 1: instalar**

```bash
npm install xml-crypto@^6.3.3 @xmldom/xmldom@^0.9.12 node-forge@^1.4.0 fflate@^0.8.3
npm install -D @types/node-forge@^1.3.14 xmllint-wasm@^5.3.0
```

- [ ] **Passo 2: copiar os XSD v1.01**

Baixar `https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/nfse-esquemas_xsd-v1-01-20260209.zip`,
extrair e copiar o conteúdo de `Schemas/1.01/` para `src/lib/nfse/xsd/1.01/`
(DPS, NFSe, evento, pedRegEvento, tiposComplexos, tiposSimples, tiposEventos,
tiposCnc, CNC e xmldsig-core-schema). São públicos; o repositório pode
carregá-los.

- [ ] **Passo 3: commit**

```bash
git add package.json package-lock.json src/lib/nfse/xsd
git commit -m "chore: dependencias e esquemas oficiais da NFS-e nacional"
```

---

### Tarefa 2: Regras puras da NFS-e

**Arquivos:**
- Criar: `src/domain/nfse.ts`
- Teste: `src/domain/nfse.test.ts`

- [ ] **Passo 1: escrever o teste**

```ts
import { describe, expect, test } from "vitest";

import {
  amountToCents,
  buildCancelRequestId,
  buildDpsId,
  centsToNfseAmount,
  danfseFileName,
  isFutureNfsePeriod,
  nfseCompetenceDate,
  nfseServiceHealth,
  normalizeDpsSeries,
  renderNfseDescription,
  selectNfseBatch,
  type NfseCandidate,
} from "./nfse";

const CNPJ_OK = "11222333000181";

function candidate(overrides: Partial<NfseCandidate> = {}): NfseCandidate {
  return {
    controlPeriodId: "c1",
    clientId: "cli1",
    clientName: "Padaria Pão Quente",
    cnpj: CNPJ_OK,
    monthlyFee: "850.00",
    chargesAdditionalInstallment: false,
    ...overrides,
  };
}

describe("identificadores do leiaute nacional", () => {
  test("DPS tem 45 posições com série e número completados com zeros", () => {
    const id = buildDpsId({ cityCode: "4314902", cnpj: CNPJ_OK, series: "1", number: 37 });
    expect(id).toBe(`DPS43149022${CNPJ_OK}00001000000000000037`);
    expect(id).toHaveLength(45);
  });

  test("série fora da faixa de aplicativo próprio é recusada", () => {
    expect(() => normalizeDpsSeries("70000")).toThrow(/1 e 49999/);
    expect(() => normalizeDpsSeries("0")).toThrow();
    expect(normalizeDpsSeries("00010")).toBe("10");
  });

  test("pedido de cancelamento é PRE + chave + 101101", () => {
    const key = "1".repeat(50);
    expect(buildCancelRequestId(key)).toBe(`PRE${key}101101`);
    expect(buildCancelRequestId(key)).toHaveLength(59);
    expect(() => buildCancelRequestId("123")).toThrow();
  });
});

describe("valores", () => {
  test("decimal canônico vira centavos e volta no formato do leiaute", () => {
    expect(amountToCents("850")).toBe(85000);
    expect(amountToCents("850.5")).toBe(85050);
    expect(amountToCents("0.07")).toBe(7);
    expect(centsToNfseAmount(85050)).toBe("850.50");
    expect(centsToNfseAmount(7)).toBe("0.07");
    expect(() => centsToNfseAmount(0)).toThrow();
  });
});

describe("texto e datas", () => {
  test("descrição troca competência e ano", () => {
    expect(renderNfseDescription("Honorários {competencia} ({ano})", { year: 2026, month: 9 }))
      .toBe("Honorários 09/2026 (2026)");
  });

  test("competência é o último dia do mês, ou hoje se o mês não terminou", () => {
    expect(nfseCompetenceDate({ year: 2026, month: 9 }, "2026-10-05")).toBe("2026-09-30");
    expect(nfseCompetenceDate({ year: 2026, month: 10 }, "2026-10-05")).toBe("2026-10-05");
    expect(nfseCompetenceDate({ year: 2028, month: 2 }, "2028-03-01")).toBe("2028-02-29");
  });

  test("mês que ainda não começou não emite", () => {
    expect(isFutureNfsePeriod({ year: 2026, month: 11 }, "2026-10-31")).toBe(true);
    expect(isFutureNfsePeriod({ year: 2026, month: 10 }, "2026-10-01")).toBe(false);
  });

  test("nome do PDF é estável e sem acento", () => {
    expect(danfseFileName({ nfseNumber: "123", dpsNumber: 9, takerName: "Padaria Pão & Cia" }))
      .toBe("000123-padaria-pao-cia.pdf");
    expect(danfseFileName({ nfseNumber: null, dpsNumber: 9, takerName: "  " })).toBe("dps-9.pdf");
  });
});

describe("seleção do lote", () => {
  test("inclui a mensal e explica quem fica de fora", () => {
    const batch = selectNfseBatch({
      candidates: [
        candidate(),
        candidate({ controlPeriodId: "c2", clientId: "cli2", clientName: "Sem CNPJ", cnpj: null }),
        candidate({ controlPeriodId: "c3", clientId: "cli3", clientName: "CNPJ errado", cnpj: "11111111111111" }),
        candidate({ controlPeriodId: "c4", clientId: "cli4", clientName: "Zerada", monthlyFee: "0.00" }),
        candidate({ controlPeriodId: "c5", clientId: "cli5", clientName: "Já emitida" }),
      ],
      activeMonthlyClientIds: new Set(["cli5"]),
      activeAdditionalClientIds: new Set(),
      includeAdditional: false,
    });
    expect(batch.items.map((item) => item.clientId)).toEqual(["cli1"]);
    expect(batch.totalCents).toBe(85000);
    expect(batch.excluded.map((item) => item.reason)).toEqual([
      "missing_cnpj",
      "invalid_cnpj",
      "zero_amount",
      "already_active",
    ]);
  });

  test("PA só entra marcada, para quem cobra, uma vez por ano", () => {
    const candidates = [
      candidate({ chargesAdditionalInstallment: true }),
      candidate({ controlPeriodId: "c2", clientId: "cli2", clientName: "Já teve PA", chargesAdditionalInstallment: true }),
      candidate({ controlPeriodId: "c3", clientId: "cli3", clientName: "Não cobra PA" }),
    ];
    const without = selectNfseBatch({ candidates, activeMonthlyClientIds: new Set(), activeAdditionalClientIds: new Set(["cli2"]), includeAdditional: false });
    expect(without.items.filter((item) => item.kind === "additional_installment")).toHaveLength(0);

    const withPa = selectNfseBatch({ candidates, activeMonthlyClientIds: new Set(), activeAdditionalClientIds: new Set(["cli2"]), includeAdditional: true });
    expect(withPa.items.filter((item) => item.kind === "additional_installment").map((item) => item.clientId)).toEqual(["cli1"]);
    expect(withPa.excluded).toEqual([
      { controlPeriodId: "c2", clientName: "Já teve PA", kind: "additional_installment", reason: "already_active" },
    ]);
    expect(withPa.totalCents).toBe(85000 * 4);
  });
});

describe("saúde do serviço fiscal", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  test("sem batimento recente é offline; com erro é erro; senão pronto", () => {
    expect(nfseServiceHealth({ configured: false, serviceSeenAt: null, serviceError: null, certificateValidUntil: null, now }).state).toBe("unconfigured");
    expect(nfseServiceHealth({ configured: true, serviceSeenAt: new Date("2026-10-10T11:50:00Z"), serviceError: null, certificateValidUntil: null, now }).state).toBe("offline");
    expect(nfseServiceHealth({ configured: true, serviceSeenAt: new Date("2026-10-10T11:59:00Z"), serviceError: "Certificado vencido", certificateValidUntil: null, now }).state).toBe("error");
    const ready = nfseServiceHealth({ configured: true, serviceSeenAt: new Date("2026-10-10T11:59:00Z"), serviceError: null, certificateValidUntil: new Date("2026-11-01T12:00:00Z"), now });
    expect(ready).toEqual({ state: "ready", certificateDaysLeft: 22 });
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `npx vitest run src/domain/nfse.test.ts`
Esperado: FALHA — `Cannot find module './nfse'`.

- [ ] **Passo 3: implementar**

```ts
import { validateCnpj } from "./cnpj";

/**
 * Regras puras das notas de honorário (NFS-e nacional). Desenho em
 * docs/superpowers/specs/2026-10-10-notas-de-honorario-design.md.
 */

export const NFSE_INVOICE_KINDS = ["monthly", "additional_installment"] as const;
export type NfseInvoiceKind = (typeof NFSE_INVOICE_KINDS)[number];

export const NFSE_INVOICE_STATUSES = [
  "queued",
  "issued",
  "failed",
  "cancel_requested",
  "cancelled",
] as const;
export type NfseInvoiceStatus = (typeof NFSE_INVOICE_STATUSES)[number];

export const NFSE_CANCEL_REASON_CODES = [1, 2, 9] as const;
export type NfseCancelReasonCode = (typeof NFSE_CANCEL_REASON_CODES)[number];
export const NFSE_CANCEL_REASON_LABELS: Record<NfseCancelReasonCode, string> = {
  1: "Erro na emissão",
  2: "Serviço não prestado",
  9: "Outros",
};
/** O Sistema Nacional exige justificativa de 15 a 255 caracteres (TSMotivo). */
export const NFSE_CANCEL_TEXT_MIN = 15;
export const NFSE_CANCEL_TEXT_MAX = 255;

/** Dias de antecedência do aviso de certificado vencendo. */
export const NFSE_CERTIFICATE_WARNING_DAYS = 30;
/** Sem batimento há mais que isso, o serviço fiscal é dado como parado. */
export const NFSE_SERVICE_STALE_MS = 5 * 60_000;

function requireDigits(value: string, length: number, label: string): string {
  if (!new RegExp(`^\\d{${length}}$`).test(value)) {
    throw new Error(`${label} deve ter ${length} dígitos.`);
  }
  return value;
}

/** Série de aplicativo próprio: 1 a 49999 (70000–79999 é do Emissor Web). */
export function normalizeDpsSeries(series: string): string {
  const value = Number(series);
  if (!/^\d{1,5}$/.test(series) || value < 1 || value > 49_999) {
    throw new Error("A série da DPS deve estar entre 1 e 49999 (faixa de aplicativo próprio).");
  }
  return String(value);
}

/**
 * Identificador da DPS (45 posições): "DPS" + município (7) + tipo de
 * inscrição (2 = CNPJ) + CNPJ (14) + série (5) + número (15).
 */
export function buildDpsId(input: {
  cityCode: string;
  cnpj: string;
  series: string;
  number: number;
}): string {
  const city = requireDigits(input.cityCode, 7, "O código do município");
  const cnpj = requireDigits(input.cnpj, 14, "O CNPJ do prestador");
  const series = normalizeDpsSeries(input.series).padStart(5, "0");
  if (!Number.isSafeInteger(input.number) || input.number < 1 || input.number > 999_999_999_999_999) {
    throw new Error("Número da DPS inválido.");
  }
  return `DPS${city}2${cnpj}${series}${String(input.number).padStart(15, "0")}`;
}

/** Identificador do pedido de cancelamento: "PRE" + chave (50) + "101101". */
export function buildCancelRequestId(accessKey: string): string {
  return `PRE${requireDigits(accessKey, 50, "A chave de acesso")}101101`;
}

/** Decimal canônico do banco ("850", "850.5", "850.50") em centavos. */
export function amountToCents(value: string): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new Error(`Valor inválido: ${value}`);
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

/** Centavos no formato do leiaute (TSDec15V2): sempre duas casas. */
export function centsToNfseAmount(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents <= 0) {
    throw new Error("O valor da nota deve ser positivo.");
  }
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

/** Troca {competencia} por MM/AAAA e {ano} por AAAA no texto do modelo. */
export function renderNfseDescription(
  template: string,
  period: { year: number; month: number },
): string {
  return template
    .replaceAll("{competencia}", `${twoDigits(period.month)}/${period.year}`)
    .replaceAll("{ano}", String(period.year))
    .trim();
}

/**
 * Data de competência: último dia do mês de referência, ou hoje se o mês
 * ainda corre — o leiaute recusa competência posterior à emissão.
 * `today` é a data de emissão no fuso da Guilda (AAAA-MM-DD).
 */
export function nfseCompetenceDate(
  period: { year: number; month: number },
  today: string,
): string {
  const lastDay = new Date(Date.UTC(period.year, period.month, 0)).getUTCDate();
  const endOfMonth = `${period.year}-${twoDigits(period.month)}-${twoDigits(lastDay)}`;
  return endOfMonth < today ? endOfMonth : today;
}

export function isFutureNfsePeriod(
  period: { year: number; month: number },
  today: string,
): boolean {
  return `${period.year}-${twoDigits(period.month)}-01` > today;
}

export interface NfseCandidate {
  controlPeriodId: string;
  clientId: string;
  clientName: string;
  cnpj: string | null;
  monthlyFee: string;
  chargesAdditionalInstallment: boolean;
}

export type NfseExclusionReason =
  | "missing_cnpj"
  | "invalid_cnpj"
  | "zero_amount"
  | "already_active";

export const NFSE_EXCLUSION_LABELS: Record<NfseExclusionReason, string> = {
  missing_cnpj: "Sem CNPJ cadastrado",
  invalid_cnpj: "CNPJ inválido",
  zero_amount: "Honorário zerado",
  already_active: "Nota já emitida ou na fila",
};

export interface NfseBatchItem {
  controlPeriodId: string;
  clientId: string;
  clientName: string;
  cnpj: string;
  kind: NfseInvoiceKind;
  amountCents: number;
}

export interface NfseBatchExclusion {
  controlPeriodId: string;
  clientName: string;
  kind: NfseInvoiceKind;
  reason: NfseExclusionReason;
}

export interface NfseBatch {
  items: NfseBatchItem[];
  excluded: NfseBatchExclusion[];
  totalCents: number;
}

export type NfseEmissionPreviewView = NfseBatch & { companiesWithoutFee: number };

/**
 * Quem entra no lote do mês. A mensal vale para toda empresa com honorário
 * no controle; a PA só quando marcada, para quem cobra PA e ainda não teve
 * uma PA ativa no ano. Problema de cadastro (CNPJ, valor) aparece uma vez.
 */
export function selectNfseBatch(input: {
  candidates: readonly NfseCandidate[];
  activeMonthlyClientIds: ReadonlySet<string>;
  activeAdditionalClientIds: ReadonlySet<string>;
  includeAdditional: boolean;
}): NfseBatch {
  const items: NfseBatchItem[] = [];
  const excluded: NfseBatchExclusion[] = [];
  for (const candidate of input.candidates) {
    const base = { controlPeriodId: candidate.controlPeriodId, clientName: candidate.clientName };
    const problem: NfseExclusionReason | null = !candidate.cnpj
      ? "missing_cnpj"
      : !validateCnpj(candidate.cnpj)
        ? "invalid_cnpj"
        : amountToCents(candidate.monthlyFee) === 0
          ? "zero_amount"
          : null;
    if (problem || !candidate.cnpj) {
      excluded.push({ ...base, kind: "monthly", reason: problem ?? "missing_cnpj" });
      continue;
    }
    const amountCents = amountToCents(candidate.monthlyFee);
    const item = { ...base, clientId: candidate.clientId, cnpj: candidate.cnpj, amountCents };
    if (input.activeMonthlyClientIds.has(candidate.clientId)) {
      excluded.push({ ...base, kind: "monthly", reason: "already_active" });
    } else {
      items.push({ ...item, kind: "monthly" });
    }
    if (!input.includeAdditional || !candidate.chargesAdditionalInstallment) continue;
    if (input.activeAdditionalClientIds.has(candidate.clientId)) {
      excluded.push({ ...base, kind: "additional_installment", reason: "already_active" });
    } else {
      items.push({ ...item, kind: "additional_installment" });
    }
  }
  return { items, excluded, totalCents: items.reduce((sum, item) => sum + item.amountCents, 0) };
}

export type NfseServiceState = "unconfigured" | "offline" | "error" | "ready";

export function nfseServiceHealth(input: {
  configured: boolean;
  serviceSeenAt: Date | null;
  serviceError: string | null;
  certificateValidUntil: Date | null;
  now: Date;
}): { state: NfseServiceState; certificateDaysLeft: number | null } {
  const certificateDaysLeft = input.certificateValidUntil
    ? Math.floor((input.certificateValidUntil.getTime() - input.now.getTime()) / 86_400_000)
    : null;
  if (!input.configured) return { state: "unconfigured", certificateDaysLeft };
  if (!input.serviceSeenAt || input.now.getTime() - input.serviceSeenAt.getTime() > NFSE_SERVICE_STALE_MS) {
    return { state: "offline", certificateDaysLeft };
  }
  if (input.serviceError) return { state: "error", certificateDaysLeft };
  return { state: "ready", certificateDaysLeft };
}

/** Nome do PDF dentro do .zip: número da nota (ou da DPS) + tomador sem acento. */
export function danfseFileName(input: {
  nfseNumber: string | null;
  dpsNumber: number;
  takerName: string;
}): string {
  const slug = input.takerName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const prefix = input.nfseNumber ? input.nfseNumber.padStart(6, "0") : `dps-${input.dpsNumber}`;
  return slug ? `${prefix}-${slug}.pdf` : `${prefix}.pdf`;
}
```

- [ ] **Passo 4: rodar e ver passar**

Rodar: `npx vitest run src/domain/nfse.test.ts`
Esperado: PASS (todos).

- [ ] **Passo 5: commit**

```bash
git add src/domain/nfse.ts src/domain/nfse.test.ts
git commit -m "feat: regras puras das notas de honorario"
```

---

### Tarefa 3: Modelo da nota, XML e horário

**Arquivos:**
- Criar: `src/lib/nfse/template.ts`, `src/lib/nfse/xml.ts`, `src/lib/nfse/time.ts`, `src/lib/nfse/testing/fixtures.ts`
- Teste: `src/lib/nfse/template.test.ts`

- [ ] **Passo 1: fixture compartilhada (só teste)**

Os testes das tarefas seguintes importam daqui — nunca de outro `.test.ts`,
senão os testes daquele arquivo rodam de novo dentro do que importou.

```ts
import type { NfseTemplate } from "../template";

export const TEST_TEMPLATE: NfseTemplate = {
  cityCode: "4314902",
  municipalRegistration: "12345",
  taxRegime: { opSimpNac: "3", regApTribSN: "1", regEspTrib: "0" },
  service: { nationalTaxCode: "171901" },
  issqn: { taxation: "1", withholding: "1" },
  totalTaxes: { kind: "simples", percent: "6.00" },
  descriptions: {
    monthly: "Honorários contábeis referentes à competência {competencia}.",
    additionalInstallment: "Parcela adicional de honorários contábeis de {ano}.",
  },
};
```

- [ ] **Passo 2: escrever o teste**

```ts
import { describe, expect, test } from "vitest";

import { parseNfseTemplate } from "./template";
import { TEST_TEMPLATE } from "./testing/fixtures";
import { nfseIssueTimestamp, nfseToday } from "./time";
import { escapeXml, firstElementText, gunzipBase64, gzipBase64 } from "./xml";

describe("modelo da nota", () => {
  test("aceita o modelo completo e recusa campo fora do formato", () => {
    expect(parseNfseTemplate(TEST_TEMPLATE)?.cityCode).toBe("4314902");
    expect(parseNfseTemplate({ ...TEST_TEMPLATE, cityCode: "431490" })).toBeNull();
    expect(parseNfseTemplate({ ...TEST_TEMPLATE, totalTaxes: { kind: "simples", percent: "6.5" } })).toBeNull();
    expect(parseNfseTemplate(null)).toBeNull();
  });
});

describe("utilitários de XML", () => {
  test("escapa os cinco caracteres reservados", () => {
    expect(escapeXml(`a&b<c>"d"'e'`)).toBe("a&amp;b&lt;c&gt;&quot;d&quot;&apos;e&apos;");
  });
  test("gzip + base64 vai e volta", () => {
    expect(gunzipBase64(gzipBase64("<a>ç</a>"))).toBe("<a>ç</a>");
  });
  test("lê o texto de um elemento com ou sem prefixo", () => {
    expect(firstElementText("<x><ns:nNFSe>42</ns:nNFSe></x>", "nNFSe")).toBe("42");
    expect(firstElementText("<x/>", "nNFSe")).toBeNull();
  });
});

describe("horário da emissão", () => {
  test("dhEmi em Brasília, um minuto antes, com fuso -03:00", () => {
    expect(nfseIssueTimestamp(new Date("2026-10-01T02:30:30Z"))).toBe("2026-09-30T23:29:30-03:00");
  });
  test("hoje no fuso da Guilda", () => {
    expect(nfseToday(new Date("2026-10-01T02:30:00Z"))).toBe("2026-09-30");
  });
});
```

- [ ] **Passo 3: rodar e ver falhar**

Rodar: `npx vitest run src/lib/nfse/template.test.ts`
Esperado: FALHA — módulos inexistentes.

- [ ] **Passo 4: implementar `template.ts`**

```ts
import { z } from "zod";

const digits = (length: number, label: string) =>
  z.string().regex(new RegExp(`^\\d{${length}}$`), `${label} deve ter ${length} dígitos.`);

/**
 * O modelo da nota de honorário do escritório: tudo que não muda de uma nota
 * para outra. Os campos espelham a DPS do leiaute nacional v1.01 e saem, na
 * etapa 3, do XML de uma nota já emitida no Portal.
 */
export const nfseTemplateSchema = z.object({
  cityCode: digits(7, "O código IBGE do município"),
  municipalRegistration: z.string().trim().min(1).max(15).optional(),
  taxRegime: z.object({
    opSimpNac: z.enum(["1", "2", "3"]),
    regApTribSN: z.enum(["1", "2", "3"]).optional(),
    regEspTrib: z.enum(["0", "1", "2", "3", "4", "5", "6", "9"]),
  }),
  service: z.object({
    nationalTaxCode: digits(6, "O código de tributação nacional"),
    municipalTaxCode: digits(3, "O código de tributação municipal").optional(),
    nbsCode: digits(9, "O código NBS").optional(),
  }),
  issqn: z.object({
    taxation: z.enum(["1", "2", "3", "4"]),
    withholding: z.enum(["1", "2", "3"]),
    rate: z.string().regex(/^(0|[0-9](\.[0-9]{2})?)$/, "Alíquota no formato 2.00.").optional(),
  }),
  totalTaxes: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("none") }),
    z.object({
      kind: z.literal("simples"),
      percent: z.string().regex(/^(0|0\.[0-9]{2}|[1-9][0-9]?(\.[0-9]{2})?)$/, "Percentual no formato 6.00."),
    }),
  ]),
  descriptions: z.object({
    monthly: z.string().trim().min(1).max(2000),
    additionalInstallment: z.string().trim().min(1).max(2000),
  }),
});

export type NfseTemplate = z.infer<typeof nfseTemplateSchema>;

export function parseNfseTemplate(value: unknown): NfseTemplate | null {
  const parsed = nfseTemplateSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
```

- [ ] **Passo 5: implementar `xml.ts`**

```ts
import { gunzipSync, gzipSync } from "node:zlib";

export const NFSE_NAMESPACE = "http://www.sped.fazenda.gov.br/nfse";
export const NFSE_LAYOUT_VERSION = "1.01";
export const NFSE_APP_VERSION = "Guilda-1.0";
export const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Elemento simples; campo opcional ausente não gera nada. */
export function element(name: string, value: string | undefined | null): string {
  return value === undefined || value === null ? "" : `<${name}>${escapeXml(value)}</${name}>`;
}

export function gzipBase64(xml: string): string {
  return gzipSync(Buffer.from(xml, "utf8")).toString("base64");
}

export function gunzipBase64(value: string): string {
  return gunzipSync(Buffer.from(value, "base64")).toString("utf8");
}

/** Texto do primeiro elemento com esse nome local, com ou sem prefixo. */
export function firstElementText(xml: string, localName: string): string | null {
  const match = new RegExp(
    `<(?:[A-Za-z_][\\w.-]*:)?${localName}(?:\\s[^>]*)?>([^<]*)</(?:[A-Za-z_][\\w.-]*:)?${localName}>`,
  ).exec(xml);
  return match ? match[1].trim() : null;
}
```

- [ ] **Passo 6: implementar `time.ts`**

```ts
import { APP_TIME_ZONE } from "@/lib/date-time";

const FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function parts(date: Date): Record<string, string> {
  return Object.fromEntries(FORMAT.formatToParts(date).map((part) => [part.type, part.value]));
}

/**
 * dhEmi no formato do leiaute (AAAA-MM-DDThh:mm:ss-03:00). Brasília não tem
 * horário de verão desde 2019. Um minuto antes do relógio do servidor: o
 * Sistema Nacional recusa emissão "no futuro" e relógios divergem.
 */
export function nfseIssueTimestamp(now: Date): string {
  const p = parts(new Date(now.getTime() - 60_000));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}-03:00`;
}

/** Hoje (AAAA-MM-DD) no fuso da Guilda. */
export function nfseToday(now: Date): string {
  const p = parts(now);
  return `${p.year}-${p.month}-${p.day}`;
}
```

- [ ] **Passo 7: rodar e ver passar**

Rodar: `npx vitest run src/lib/nfse/template.test.ts`
Esperado: PASS.

- [ ] **Passo 8: commit**

```bash
git add src/lib/nfse/template.ts src/lib/nfse/xml.ts src/lib/nfse/time.ts src/lib/nfse/template.test.ts src/lib/nfse/testing/fixtures.ts
git commit -m "feat: modelo da nota e utilitarios de XML da NFS-e"
```

---

### Tarefa 4: XML da DPS validado contra o XSD oficial

**Arquivos:**
- Criar: `src/lib/nfse/testing/xsd.ts`, `src/lib/nfse/dps-xml.ts`
- Teste: `src/lib/nfse/dps-xml.test.ts`

- [ ] **Passo 1: helper de validação (só teste)**

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { validateXML } from "xmllint-wasm";

const XSD_DIR = path.resolve(process.cwd(), "src/lib/nfse/xsd/1.01");
const SHARED = [
  "tiposComplexos_v1.01.xsd",
  "tiposSimples_v1.01.xsd",
  "tiposEventos_v1.01.xsd",
  "xmldsig-core-schema.xsd",
];

/**
 * Os arquivos oficiais trazem BOM e o xmldsig traz um DOCTYPE com DTD
 * externa; o validador em WebAssembly não busca nada na rede. Nenhum dos
 * dois usa entidades, então retirar o DOCTYPE não muda o esquema.
 *
 * O padrão da série da DPS vem escrito como "^0{0,4}\d{1,5}$". Em expressão
 * regular de XSD o padrão já é ancorado e ^/$ são caracteres literais; o
 * libxml2 segue a especificação e recusaria toda série. Tiramos as âncoras
 * ao carregar, sem mexer no arquivo oficial.
 */
function readXsd(fileName: string): string {
  return readFileSync(path.join(XSD_DIR, fileName), "utf8")
    .replace(/^﻿/, "")
    .replace(/<!DOCTYPE[\s\S]*?\]>/, "")
    .replace(/(<xs:pattern value=")\^([^"]*)\$(")/g, "$1$2$3");
}

export async function nfseXsdErrors(
  xml: string,
  rootXsd: "DPS_v1.01.xsd" | "pedRegEvento_v1.01.xsd",
): Promise<string[]> {
  const result = await validateXML({
    xml: [{ fileName: "documento.xml", contents: xml }],
    schema: [{ fileName: rootXsd, contents: readXsd(rootXsd) }],
    preload: SHARED.map((fileName) => ({ fileName, contents: readXsd(fileName) })),
  });
  return result.errors.map((error) => error.message);
}
```

- [ ] **Passo 2: escrever o teste**

```ts
import { describe, expect, test } from "vitest";

import { buildDpsXml, type DpsInput } from "./dps-xml";
import type { NfseTemplate } from "./template";
import { TEST_TEMPLATE } from "./testing/fixtures";
import { nfseXsdErrors } from "./testing/xsd";

const template = TEST_TEMPLATE;

function input(overrides: Partial<DpsInput> = {}): DpsInput {
  return {
    environment: 2,
    issuedAt: "2026-10-05T09:15:00-03:00",
    competenceDate: "2026-09-30",
    series: "1",
    number: 37,
    providerCnpj: "11222333000181",
    template,
    taker: { cnpj: "33000167000101", name: "  Padaria   Pão & Cia  " },
    amountCents: 85050,
    description: "Honorários contábeis referentes à competência 09/2026.",
    ...overrides,
  };
}

describe("XML da DPS", () => {
  test("é válido contra o XSD oficial v1.01 (Simples, com %SN)", async () => {
    const { id, xml } = buildDpsXml(input());
    expect(id).toBe("DPS431490221122233300018100001000000000000037");
    expect(id).toHaveLength(45);
    expect(await nfseXsdErrors(xml, "DPS_v1.01.xsd")).toEqual([]);
  });

  test("é válido sem total de tributos e sem campos opcionais", async () => {
    const minimal: NfseTemplate = {
      ...TEST_TEMPLATE,
      municipalRegistration: undefined,
      taxRegime: { opSimpNac: "1", regEspTrib: "0" },
      totalTaxes: { kind: "none" },
    };
    const { xml } = buildDpsXml(input({ template: minimal }));
    expect(xml).toContain("<indTotTrib>0</indTotTrib>");
    expect(xml).not.toContain("<IM>");
    expect(await nfseXsdErrors(xml, "DPS_v1.01.xsd")).toEqual([]);
  });

  test("normaliza o nome do tomador e escapa o texto", () => {
    const { xml } = buildDpsXml(input());
    expect(xml).toContain("<xNome>Padaria Pão &amp; Cia</xNome>");
    expect(xml).toContain("<vServ>850.50</vServ>");
    expect(xml).toContain("<tpEmit>1</tpEmit>");
  });
});
```

- [ ] **Passo 3: rodar e ver falhar**

Rodar: `npx vitest run src/lib/nfse/dps-xml.test.ts`
Esperado: FALHA — `Cannot find module './dps-xml'`.

- [ ] **Passo 4: implementar**

```ts
import { buildDpsId, centsToNfseAmount, normalizeDpsSeries } from "@/domain/nfse";

import type { NfseTemplate } from "./template";
import {
  element,
  NFSE_APP_VERSION,
  NFSE_LAYOUT_VERSION,
  NFSE_NAMESPACE,
  XML_DECLARATION,
} from "./xml";

export interface DpsInput {
  environment: 1 | 2;
  issuedAt: string;
  competenceDate: string;
  series: string;
  number: number;
  providerCnpj: string;
  template: NfseTemplate;
  taker: { cnpj: string; name: string };
  amountCents: number;
  description: string;
}

function normalizeName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, 300);
}

/**
 * DPS da nota de honorário, na ordem exata das sequências do XSD v1.01.
 * O prestador é quem emite (tpEmit = 1), então nome e endereço dele vêm do
 * cadastro nacional e não são informados.
 */
export function buildDpsXml(input: DpsInput): { id: string; xml: string } {
  const t = input.template;
  const id = buildDpsId({
    cityCode: t.cityCode,
    cnpj: input.providerCnpj,
    series: input.series,
    number: input.number,
  });
  const regTrib =
    `<regTrib>${element("opSimpNac", t.taxRegime.opSimpNac)}` +
    `${element("regApTribSN", t.taxRegime.regApTribSN)}` +
    `${element("regEspTrib", t.taxRegime.regEspTrib)}</regTrib>`;
  const prest = `<prest>${element("CNPJ", input.providerCnpj)}${element("IM", t.municipalRegistration)}${regTrib}</prest>`;
  const toma = `<toma>${element("CNPJ", input.taker.cnpj)}${element("xNome", normalizeName(input.taker.name))}</toma>`;
  const cServ =
    `<cServ>${element("cTribNac", t.service.nationalTaxCode)}` +
    `${element("cTribMun", t.service.municipalTaxCode)}` +
    `${element("xDescServ", input.description)}` +
    `${element("cNBS", t.service.nbsCode)}</cServ>`;
  const serv = `<serv><locPrest>${element("cLocPrestacao", t.cityCode)}</locPrest>${cServ}</serv>`;
  const tribMun =
    `<tribMun>${element("tribISSQN", t.issqn.taxation)}` +
    `${element("tpRetISSQN", t.issqn.withholding)}${element("pAliq", t.issqn.rate)}</tribMun>`;
  const totTrib =
    t.totalTaxes.kind === "simples"
      ? `<totTrib>${element("pTotTribSN", t.totalTaxes.percent)}</totTrib>`
      : `<totTrib>${element("indTotTrib", "0")}</totTrib>`;
  const valores =
    `<valores><vServPrest>${element("vServ", centsToNfseAmount(input.amountCents))}</vServPrest>` +
    `<trib>${tribMun}${totTrib}</trib></valores>`;
  const infDps =
    `<infDPS Id="${id}">` +
    `${element("tpAmb", String(input.environment))}` +
    `${element("dhEmi", input.issuedAt)}` +
    `${element("verAplic", NFSE_APP_VERSION)}` +
    `${element("serie", normalizeDpsSeries(input.series))}` +
    `${element("nDPS", String(input.number))}` +
    `${element("dCompet", input.competenceDate)}` +
    `${element("tpEmit", "1")}` +
    `${element("cLocEmi", t.cityCode)}` +
    `${prest}${toma}${serv}${valores}</infDPS>`;
  return {
    id,
    xml: `${XML_DECLARATION}<DPS xmlns="${NFSE_NAMESPACE}" versao="${NFSE_LAYOUT_VERSION}">${infDps}</DPS>`,
  };
}
```

- [ ] **Passo 5: rodar e ver passar**

Rodar: `npx vitest run src/lib/nfse/dps-xml.test.ts`
Esperado: PASS. Se o validador acusar ordem ou tipo, corrigir o builder, nunca
o XSD.

- [ ] **Passo 6: commit**

```bash
git add src/lib/nfse/dps-xml.ts src/lib/nfse/dps-xml.test.ts src/lib/nfse/testing/xsd.ts
git commit -m "feat: XML da DPS validado contra o XSD nacional"
```

---

### Tarefa 5: XML do pedido de cancelamento

**Arquivos:**
- Criar: `src/lib/nfse/cancel-xml.ts`
- Teste: `src/lib/nfse/cancel-xml.test.ts`

- [ ] **Passo 1: escrever o teste**

```ts
import { describe, expect, test } from "vitest";

import { buildCancelRequestXml } from "./cancel-xml";
import { nfseXsdErrors } from "./testing/xsd";

const KEY = "43149022112223330001810000000000001226100012345678";

describe("pedido de cancelamento", () => {
  test("é válido contra o XSD oficial v1.01", async () => {
    const { id, xml } = buildCancelRequestXml({
      environment: 2,
      requestedAt: "2026-10-05T09:15:00-03:00",
      providerCnpj: "11222333000181",
      accessKey: KEY,
      reasonCode: 1,
      reasonText: "Valor do honorário informado errado.",
    });
    expect(id).toBe(`PRE${KEY}101101`);
    expect(xml).toContain("<xDesc>Cancelamento de NFS-e</xDesc>");
    expect(await nfseXsdErrors(xml, "pedRegEvento_v1.01.xsd")).toEqual([]);
  });

  test("justificativa curta é recusada antes de chegar ao Sistema Nacional", () => {
    expect(() =>
      buildCancelRequestXml({
        environment: 2,
        requestedAt: "2026-10-05T09:15:00-03:00",
        providerCnpj: "11222333000181",
        accessKey: KEY,
        reasonCode: 9,
        reasonText: "errado",
      }),
    ).toThrow(/15/);
  });
});
```

A chave do teste tem 50 dígitos; se o `chNFSe` do XSD exigir formação
específica além de `[0-9]{50}`, trocar por uma chave real da produção restrita
na etapa 2.

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `npx vitest run src/lib/nfse/cancel-xml.test.ts`
Esperado: FALHA — módulo inexistente.

- [ ] **Passo 3: implementar**

```ts
import {
  buildCancelRequestId,
  NFSE_CANCEL_TEXT_MAX,
  NFSE_CANCEL_TEXT_MIN,
  type NfseCancelReasonCode,
} from "@/domain/nfse";

import {
  element,
  NFSE_APP_VERSION,
  NFSE_LAYOUT_VERSION,
  NFSE_NAMESPACE,
  XML_DECLARATION,
} from "./xml";

export interface CancelRequestInput {
  environment: 1 | 2;
  requestedAt: string;
  providerCnpj: string;
  accessKey: string;
  reasonCode: NfseCancelReasonCode;
  reasonText: string;
}

/** Pedido de registro do evento 101101 (cancelamento de NFS-e). */
export function buildCancelRequestXml(input: CancelRequestInput): { id: string; xml: string } {
  const reason = input.reasonText.replace(/\s+/g, " ").trim();
  if (reason.length < NFSE_CANCEL_TEXT_MIN || reason.length > NFSE_CANCEL_TEXT_MAX) {
    throw new Error(
      `A justificativa do cancelamento deve ter de ${NFSE_CANCEL_TEXT_MIN} a ${NFSE_CANCEL_TEXT_MAX} caracteres.`,
    );
  }
  const id = buildCancelRequestId(input.accessKey);
  const infPedReg =
    `<infPedReg Id="${id}">` +
    `${element("tpAmb", String(input.environment))}` +
    `${element("verAplic", NFSE_APP_VERSION)}` +
    `${element("dhEvento", input.requestedAt)}` +
    `${element("CNPJAutor", input.providerCnpj)}` +
    `${element("chNFSe", input.accessKey)}` +
    `<e101101>${element("xDesc", "Cancelamento de NFS-e")}` +
    `${element("cMotivo", String(input.reasonCode))}${element("xMotivo", reason)}</e101101>` +
    `</infPedReg>`;
  return {
    id,
    xml: `${XML_DECLARATION}<pedRegEvento xmlns="${NFSE_NAMESPACE}" versao="${NFSE_LAYOUT_VERSION}">${infPedReg}</pedRegEvento>`,
  };
}
```

- [ ] **Passo 4: rodar e ver passar**

Rodar: `npx vitest run src/lib/nfse/cancel-xml.test.ts`
Esperado: PASS.

- [ ] **Passo 5: commit**

```bash
git add src/lib/nfse/cancel-xml.ts src/lib/nfse/cancel-xml.test.ts
git commit -m "feat: XML do cancelamento de NFS-e"
```

---

### Tarefa 6: Certificado A1 e assinatura XMLDSIG

**Arquivos:**
- Criar: `src/lib/nfse/testing/certificate.ts`, `src/lib/nfse/certificate.ts`, `src/lib/nfse/sign.ts`
- Teste: `src/lib/nfse/certificate.test.ts`, `src/lib/nfse/sign.test.ts`

- [ ] **Passo 1: certificado de teste (só teste)**

```ts
import forge from "node-forge";

export interface TestCertificate {
  pfxBase64: string;
  password: string;
  privateKeyPem: string;
  certificatePem: string;
}

/**
 * Certificado autoassinado no formato do e-CNPJ (CN termina em ":<CNPJ>"),
 * empacotado em PKCS#12 como um A1. Chave de 1024 bits só para o teste
 * rodar rápido.
 */
export function createTestCertificate(
  options: { commonName?: string; password?: string; notAfter?: Date } = {},
): TestCertificate {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date("2026-01-01T00:00:00Z");
  cert.validity.notAfter = options.notAfter ?? new Date("2027-01-01T00:00:00Z");
  const attrs = [{ name: "commonName", value: options.commonName ?? "ESCRITORIO TESTE LTDA:11222333000181" }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const password = options.password ?? "senha-de-teste";
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, { algorithm: "3des" });
  return {
    pfxBase64: forge.util.encode64(forge.asn1.toDer(p12).getBytes()),
    password,
    privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
    certificatePem: forge.pki.certificateToPem(cert),
  };
}
```

- [ ] **Passo 2: escrever os testes**

`src/lib/nfse/certificate.test.ts`:

```ts
import { describe, expect, test } from "vitest";

import { loadNfseCertificate, NfseCertificateError } from "./certificate";
import { createTestCertificate } from "./testing/certificate";

describe("certificado A1", () => {
  const sample = createTestCertificate();

  test("abre o pfx e extrai CNPJ, validade, chave e cadeia", () => {
    const loaded = loadNfseCertificate(sample.pfxBase64, sample.password);
    expect(loaded.cnpj).toBe("11222333000181");
    expect(loaded.validUntil.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(loaded.privateKeyPem).toContain("BEGIN RSA PRIVATE KEY");
    expect(loaded.certificatePem).toContain("BEGIN CERTIFICATE");
    expect(loaded.chainPem).toContain(loaded.certificatePem.trim());
  });

  test("senha errada vira mensagem legível", () => {
    expect(() => loadNfseCertificate(sample.pfxBase64, "errada")).toThrow(NfseCertificateError);
  });

  test("certificado sem CNPJ no CN é recusado", () => {
    const other = createTestCertificate({ commonName: "PESSOA FISICA:12345678909" });
    expect(() => loadNfseCertificate(other.pfxBase64, other.password)).toThrow(/CNPJ/);
  });
});
```

`src/lib/nfse/sign.test.ts`:

```ts
import { DOMParser } from "@xmldom/xmldom";
import { SignedXml } from "xml-crypto";
import { describe, expect, test } from "vitest";

import { buildDpsXml } from "./dps-xml";
import { signNfseXml } from "./sign";
import { TEST_TEMPLATE } from "./testing/fixtures";
import { createTestCertificate } from "./testing/certificate";
import { nfseXsdErrors } from "./testing/xsd";

const DSIG = "http://www.w3.org/2000/09/xmldsig#";

function verify(signed: string, certificatePem: string): boolean {
  const doc = new DOMParser().parseFromString(signed, "text/xml");
  const node = doc.getElementsByTagNameNS(DSIG, "Signature")[0];
  const verifier = new SignedXml({ publicCert: certificatePem });
  verifier.loadSignature(node as unknown as Node);
  return verifier.checkSignature(signed);
}

describe("assinatura XMLDSIG", () => {
  const cert = createTestCertificate();
  const { xml } = buildDpsXml({
    environment: 2,
    issuedAt: "2026-10-05T09:15:00-03:00",
    competenceDate: "2026-09-30",
    series: "1",
    number: 1,
    providerCnpj: "11222333000181",
    template: TEST_TEMPLATE,
    taker: { cnpj: "33000167000101", name: "Padaria" },
    amountCents: 10000,
    description: "Honorários 09/2026.",
  });
  const key = { privateKeyPem: cert.privateKeyPem, certificatePem: cert.certificatePem };

  test("segue o padrão nacional e confere com o certificado", async () => {
    const signed = signNfseXml(xml, "infDPS", key);
    expect(signed).toContain('Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"');
    expect(signed).toContain('Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"');
    expect(signed).toContain('Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"');
    expect(signed).toMatch(/<\/infDPS><Signature xmlns="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#">/);
    expect(signed).toContain("<X509Certificate>");
    expect(verify(signed, cert.certificatePem)).toBe(true);
    expect(await nfseXsdErrors(signed, "DPS_v1.01.xsd")).toEqual([]);
  });

  test("qualquer alteração depois de assinar invalida", () => {
    const tampered = signNfseXml(xml, "infDPS", key).replace("<vServ>100.00</vServ>", "<vServ>1.00</vServ>");
    expect(() => verify(tampered, cert.certificatePem)).toThrow();
  });
});
```

`checkSignature` do xml-crypto 6 lança em digest inválido; o teste de
adulteração espera exceção. Se a versão instalada devolver `false` em vez de
lançar, trocar para `expect(verify(...)).toBe(false)`.

- [ ] **Passo 3: rodar e ver falhar**

Rodar: `npx vitest run src/lib/nfse/certificate.test.ts src/lib/nfse/sign.test.ts`
Esperado: FALHA — módulos inexistentes.

- [ ] **Passo 4: implementar `certificate.ts`**

```ts
import forge from "node-forge";

export interface NfseCertificate {
  privateKeyPem: string;
  /** Só o certificado da pessoa jurídica: vai no X509Data (EndCertOnly). */
  certificatePem: string;
  /** Certificado + intermediários do .pfx, para o mTLS. */
  chainPem: string;
  cnpj: string;
  validUntil: Date;
}

export class NfseCertificateError extends Error {}

/** e-CNPJ ICP-Brasil: o CN termina em ":<CNPJ>". */
function cnpjFromCertificate(cert: forge.pki.Certificate): string | null {
  const commonName = cert.subject.getField("CN")?.value;
  const match = typeof commonName === "string" ? /:(\d{14})$/.exec(commonName.trim()) : null;
  return match?.[1] ?? null;
}

/**
 * Abre o A1 (.pfx em base64) com node-forge, que lê os algoritmos antigos de
 * PKCS#12 que o OpenSSL 3 do Node recusa — por isso o mTLS usa a chave e a
 * cadeia em PEM, não o .pfx direto.
 */
export function loadNfseCertificate(pfxBase64: string, password: string): NfseCertificate {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const der = forge.util.decode64(pfxBase64.replace(/\s+/g, ""));
    p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), false, password);
  } catch {
    throw new NfseCertificateError(
      "Não foi possível abrir o certificado: arquivo inválido ou senha errada.",
    );
  }
  const shrouded = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
    forge.pki.oids.pkcs8ShroudedKeyBag
  ];
  const plain = p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag];
  const privateKey = (shrouded?.[0]?.key ?? plain?.[0]?.key) as forge.pki.rsa.PrivateKey | undefined;
  if (!privateKey) throw new NfseCertificateError("O certificado não traz a chave privada.");

  const certificates = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [])
    .map((bag) => bag.cert)
    .filter((cert): cert is forge.pki.Certificate => Boolean(cert));
  const own = certificates.find((cert) =>
    (cert.publicKey as forge.pki.rsa.PublicKey).n.equals(privateKey.n),
  );
  if (!own) throw new NfseCertificateError("Nenhum certificado do arquivo corresponde à chave privada.");
  const cnpj = cnpjFromCertificate(own);
  if (!cnpj) throw new NfseCertificateError("CNPJ não encontrado no certificado. Ele é um e-CNPJ?");

  const chain = [own, ...certificates.filter((cert) => cert !== own)];
  return {
    privateKeyPem: forge.pki.privateKeyToPem(privateKey),
    certificatePem: forge.pki.certificateToPem(own),
    chainPem: chain.map((cert) => forge.pki.certificateToPem(cert)).join(""),
    cnpj,
    validUntil: own.validity.notAfter,
  };
}
```

- [ ] **Passo 5: implementar `sign.ts`**

```ts
import { SignedXml } from "xml-crypto";

const C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const ENVELOPED = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";
const RSA_SHA256 = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
const SHA256 = "http://www.w3.org/2001/04/xmlenc#sha256";

export interface NfseSigningKey {
  privateKeyPem: string;
  certificatePem: string;
}

/**
 * Assinatura do padrão nacional: XMLDSIG envelopada no elemento que tem o
 * Id (infDPS ou infPedReg), RSA-SHA256, digest SHA-256, transforms
 * enveloped + C14N. O Signature entra logo depois do elemento assinado.
 */
export function signNfseXml(
  xml: string,
  elementName: "infDPS" | "infPedReg",
  key: NfseSigningKey,
): string {
  const xpath = `//*[local-name(.)='${elementName}']`;
  const signer = new SignedXml({
    privateKey: key.privateKeyPem,
    publicCert: key.certificatePem,
    signatureAlgorithm: RSA_SHA256,
    canonicalizationAlgorithm: C14N,
  });
  signer.addReference({ xpath, digestAlgorithm: SHA256, transforms: [ENVELOPED, C14N] });
  signer.computeSignature(xml, { location: { reference: xpath, action: "after" } });
  return signer.getSignedXml();
}
```

- [ ] **Passo 6: rodar e ver passar**

Rodar: `npx vitest run src/lib/nfse/certificate.test.ts src/lib/nfse/sign.test.ts`
Esperado: PASS.

- [ ] **Passo 7: commit**

```bash
git add src/lib/nfse/certificate.ts src/lib/nfse/sign.ts src/lib/nfse/testing/certificate.ts src/lib/nfse/certificate.test.ts src/lib/nfse/sign.test.ts
git commit -m "feat: certificado A1 e assinatura XMLDSIG da NFS-e"
```

---

### Tarefa 7: Cliente do Sistema Nacional

**Arquivos:**
- Criar: `src/lib/nfse/sefin-client.ts`
- Teste: `src/lib/nfse/sefin-client.test.ts`

- [ ] **Passo 1: escrever o teste**

```ts
import { describe, expect, test } from "vitest";

import {
  createSefinClient,
  NFSE_ENDPOINTS,
  NfseTransientError,
  type HttpRequest,
  type HttpResponse,
} from "./sefin-client";
import { gunzipBase64, gzipBase64 } from "./xml";

const KEY = "4".repeat(50);

function fake(responses: HttpResponse[]) {
  const calls: HttpRequest[] = [];
  const transport = async (req: HttpRequest) => {
    calls.push(req);
    const next = responses.shift();
    if (!next) throw new Error("sem resposta preparada");
    return next;
  };
  return { calls, client: createSefinClient("restrita", transport) };
}

function json(status: number, body: unknown): HttpResponse {
  return { status, body: Buffer.from(JSON.stringify(body)), contentType: "application/json" };
}

describe("cliente do Sistema Nacional", () => {
  test("emite: manda a DPS compactada e lê chave e número", async () => {
    const nfse = gzipBase64("<NFSe><infNFSe><nNFSe>123</nNFSe></infNFSe></NFSe>");
    const { calls, client } = fake([json(201, { chaveAcesso: KEY, nfseXmlGZipB64: nfse })]);
    await expect(client.emit("<DPS/>")).resolves.toEqual({ kind: "issued", accessKey: KEY, nfseNumber: "123" });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe(`${NFSE_ENDPOINTS.restrita.sefin}/nfse`);
    expect(gunzipBase64((calls[0].json as { dpsXmlGZipB64: string }).dpsXmlGZipB64)).toBe("<DPS/>");
  });

  test("recusa de regra de negócio vira lista de erros", async () => {
    const { client } = fake([json(400, { erros: [{ Codigo: "E0014", Descricao: "DPS já existe", Complemento: null }] })]);
    await expect(client.emit("<DPS/>")).resolves.toEqual({
      kind: "rejected",
      errors: [{ code: "E0014", message: "DPS já existe" }],
    });
  });

  test("falha de infraestrutura é transitória", async () => {
    const { client } = fake([json(503, {})]);
    await expect(client.emit("<DPS/>")).rejects.toBeInstanceOf(NfseTransientError);
  });

  test("consulta a DPS: 404 é nenhuma nota", async () => {
    const { client } = fake([json(404, {}), json(200, { chaveAcesso: KEY })]);
    await expect(client.findAccessKeyByDps("DPS1")).resolves.toBeNull();
    await expect(client.findAccessKeyByDps("DPS1")).resolves.toBe(KEY);
  });

  test("cancela pelo evento compactado", async () => {
    const { calls, client } = fake([json(201, {}), json(400, { erros: [{ codigo: "E1235", descricao: "Fora do prazo" }] })]);
    await expect(client.cancel(KEY, "<pedRegEvento/>")).resolves.toEqual({ kind: "cancelled" });
    expect(calls[0].url).toBe(`${NFSE_ENDPOINTS.restrita.sefin}/nfse/${KEY}/eventos`);
    expect(Object.keys(calls[0].json as object)).toEqual(["pedidoRegistroEventoXmlGZipB64"]);
    await expect(client.cancel(KEY, "<pedRegEvento/>")).resolves.toEqual({
      kind: "rejected",
      errors: [{ code: "E1235", message: "Fora do prazo" }],
    });
  });

  test("DANFSe só vale se vier PDF", async () => {
    const pdf = Buffer.from("%PDF-1.7");
    const { calls, client } = fake([
      { status: 200, body: pdf, contentType: "application/pdf" },
      json(404, {}),
    ]);
    await expect(client.getDanfse(KEY)).resolves.toEqual(pdf);
    expect(calls[0].url).toBe(`${NFSE_ENDPOINTS.restrita.adn}/danfse/${KEY}`);
    await expect(client.getDanfse(KEY)).rejects.toThrow(/DANFSe/);
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `npx vitest run src/lib/nfse/sefin-client.test.ts`
Esperado: FALHA — módulo inexistente.

- [ ] **Passo 3: implementar**

```ts
import { Agent, request as httpsRequest } from "node:https";

import { firstElementText, gunzipBase64, gzipBase64 } from "./xml";

export type NfseEnvironmentName = "restrita" | "producao";

export const NFSE_ENDPOINTS: Record<NfseEnvironmentName, { sefin: string; adn: string; tpAmb: 1 | 2 }> = {
  restrita: {
    sefin: "https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional",
    adn: "https://adn.producaorestrita.nfse.gov.br",
    tpAmb: 2,
  },
  producao: {
    sefin: "https://sefin.nfse.gov.br/SefinNacional",
    adn: "https://adn.nfse.gov.br",
    tpAmb: 1,
  },
};

export interface HttpRequest {
  method: "GET" | "POST";
  url: string;
  json?: unknown;
  accept?: string;
}
export interface HttpResponse {
  status: number;
  body: Buffer;
  contentType: string | null;
}
export type HttpTransport = (req: HttpRequest) => Promise<HttpResponse>;

/** Rede, timeout, 5xx: vale tentar de novo mais tarde. */
export class NfseTransientError extends Error {}

export interface NfseApiError {
  code: string;
  message: string;
}
export type EmitResult =
  | { kind: "issued"; accessKey: string; nfseNumber: string | null }
  | { kind: "rejected"; errors: NfseApiError[] };
export type CancelResult = { kind: "cancelled" } | { kind: "rejected"; errors: NfseApiError[] };

export interface SefinClient {
  emit(signedDpsXml: string): Promise<EmitResult>;
  findAccessKeyByDps(dpsId: string): Promise<string | null>;
  getNfseNumber(accessKey: string): Promise<string | null>;
  cancel(accessKey: string, signedEventXml: string): Promise<CancelResult>;
  getDanfse(accessKey: string): Promise<Buffer>;
}

/** Transporte real: HTTPS com o certificado do escritório na conexão (mTLS). */
export function createMtlsTransport(input: {
  privateKeyPem: string;
  chainPem: string;
  timeoutMs?: number;
}): HttpTransport {
  const agent = new Agent({ key: input.privateKeyPem, cert: input.chainPem, keepAlive: true, maxSockets: 4 });
  const timeoutMs = input.timeoutMs ?? 30_000;
  return (req) =>
    new Promise((resolve, reject) => {
      const payload = req.json === undefined ? undefined : Buffer.from(JSON.stringify(req.json), "utf8");
      const call = httpsRequest(
        req.url,
        {
          method: req.method,
          agent,
          timeout: timeoutMs,
          headers: {
            Accept: req.accept ?? "application/json",
            ...(payload ? { "Content-Type": "application/json", "Content-Length": payload.length } : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () =>
            resolve({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks),
              contentType: res.headers["content-type"] ?? null,
            }),
          );
          res.on("error", (error) => reject(new NfseTransientError(error.message)));
        },
      );
      call.on("timeout", () => call.destroy(new Error("Tempo esgotado falando com o Sistema Nacional.")));
      call.on("error", (error) => reject(new NfseTransientError(error.message)));
      if (payload) call.write(payload);
      call.end();
    });
}

function parseBody(res: HttpResponse): Record<string, unknown> {
  try {
    const value = JSON.parse(res.body.toString("utf8")) as unknown;
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Campo por nome, sem diferenciar maiúscula de minúscula. */
function field(body: Record<string, unknown>, name: string): unknown {
  const key = Object.keys(body).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : body[key];
}

function stringField(body: Record<string, unknown>, name: string): string | null {
  const value = field(body, name);
  return typeof value === "string" && value.length > 0 ? value : null;
}

function apiErrors(body: Record<string, unknown>): NfseApiError[] {
  const raw = field(body, "erros") ?? field(body, "erro");
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
  return list
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => {
      const code = field(item, "codigo");
      const description = field(item, "descricao");
      const complement = field(item, "complemento");
      return {
        code: typeof code === "string" ? code : "",
        message: [description, complement].filter((part) => typeof part === "string" && part).join(" — ") || "Sem descrição.",
      };
    });
}

function isTransientStatus(status: number): boolean {
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

function rejection(res: HttpResponse, body: Record<string, unknown>): { kind: "rejected"; errors: NfseApiError[] } {
  if (isTransientStatus(res.status)) {
    throw new NfseTransientError(`O Sistema Nacional respondeu ${res.status}.`);
  }
  const errors = apiErrors(body);
  if (errors.length > 0) return { kind: "rejected", errors };
  const message =
    res.status === 401 || res.status === 403
      ? "O Sistema Nacional recusou o certificado do escritório."
      : `Recusa sem detalhe (HTTP ${res.status}).`;
  return { kind: "rejected", errors: [{ code: String(res.status), message }] };
}

function unexpected(res: HttpResponse, what: string): NfseTransientError {
  const detail = apiErrors(parseBody(res)).map((error) => error.message).join(" · ");
  return new NfseTransientError(`${what}: HTTP ${res.status}${detail ? ` — ${detail}` : ""}.`);
}

export function createSefinClient(environment: NfseEnvironmentName, transport: HttpTransport): SefinClient {
  const base = NFSE_ENDPOINTS[environment];

  async function nfseNumberFrom(body: Record<string, unknown>): Promise<string | null> {
    const xml = stringField(body, "nfseXmlGZipB64");
    return xml ? firstElementText(gunzipBase64(xml), "nNFSe") : null;
  }

  return {
    async emit(signedDpsXml) {
      const res = await transport({
        method: "POST",
        url: `${base.sefin}/nfse`,
        json: { dpsXmlGZipB64: gzipBase64(signedDpsXml) },
      });
      const body = parseBody(res);
      if (res.status >= 200 && res.status < 300) {
        const accessKey = stringField(body, "chaveAcesso");
        if (!accessKey) throw new NfseTransientError("Resposta de emissão sem chave de acesso.");
        return { kind: "issued", accessKey, nfseNumber: await nfseNumberFrom(body) };
      }
      return rejection(res, body);
    },

    async findAccessKeyByDps(dpsId) {
      const res = await transport({ method: "GET", url: `${base.sefin}/dps/${dpsId}` });
      if (res.status === 404) return null;
      if (res.status >= 200 && res.status < 300) return stringField(parseBody(res), "chaveAcesso");
      throw unexpected(res, "Consulta da DPS falhou");
    },

    async getNfseNumber(accessKey) {
      const res = await transport({ method: "GET", url: `${base.sefin}/nfse/${accessKey}` });
      if (res.status >= 200 && res.status < 300) return nfseNumberFrom(parseBody(res));
      throw unexpected(res, "Consulta da nota falhou");
    },

    async cancel(accessKey, signedEventXml) {
      const res = await transport({
        method: "POST",
        url: `${base.sefin}/nfse/${accessKey}/eventos`,
        json: { pedidoRegistroEventoXmlGZipB64: gzipBase64(signedEventXml) },
      });
      if (res.status >= 200 && res.status < 300) return { kind: "cancelled" };
      return rejection(res, parseBody(res));
    },

    async getDanfse(accessKey) {
      const res = await transport({ method: "GET", url: `${base.adn}/danfse/${accessKey}`, accept: "application/pdf" });
      if (res.status >= 200 && res.status < 300 && res.contentType?.includes("pdf")) return res.body;
      throw new Error(`DANFSe indisponível para a nota ${accessKey} (HTTP ${res.status}).`);
    },
  };
}
```

- [ ] **Passo 4: rodar e ver passar**

Rodar: `npx vitest run src/lib/nfse/sefin-client.test.ts`
Esperado: PASS.

- [ ] **Passo 5: commit**

```bash
git add src/lib/nfse/sefin-client.ts src/lib/nfse/sefin-client.test.ts
git commit -m "feat: cliente mTLS do Sistema Nacional NFS-e"
```

---

### Tarefa 8: Desfecho de uma nota da fila

**Arquivos:**
- Criar: `src/lib/nfse/processor.ts`
- Teste: `src/lib/nfse/processor.test.ts`

- [ ] **Passo 1: escrever o teste**

```ts
import { describe, expect, test } from "vitest";

import { buildDpsId } from "@/domain/nfse";

import { runNfseJob, type NfseJob } from "./processor";
import { NfseTransientError, type SefinClient } from "./sefin-client";
import { TEST_TEMPLATE } from "./testing/fixtures";
import { createTestCertificate } from "./testing/certificate";

const template = TEST_TEMPLATE;
const cert = createTestCertificate();
const PROVIDER = "11222333000181";
const KEY = "4".repeat(50);

function job(overrides: Partial<NfseJob> = {}): NfseJob {
  return {
    id: "inv1",
    status: "queued",
    attemptCount: 1,
    dpsId: buildDpsId({ cityCode: template.cityCode, cnpj: PROVIDER, series: "1", number: 5 }),
    dpsSeries: "1",
    dpsNumber: 5,
    periodYear: 2026,
    periodMonth: 9,
    amountCents: 85000,
    takerCnpj: "33000167000101",
    takerName: "Padaria",
    description: "Honorários 09/2026.",
    accessKey: null,
    issuedEnvironment: null,
    cancelReasonCode: null,
    cancelReasonText: null,
    ...overrides,
  };
}

function client(overrides: Partial<SefinClient> = {}): SefinClient {
  return {
    emit: async () => ({ kind: "issued", accessKey: KEY, nfseNumber: "77" }),
    findAccessKeyByDps: async () => null,
    getNfseNumber: async () => "77",
    cancel: async () => ({ kind: "cancelled" }),
    getDanfse: async () => Buffer.from(""),
    ...overrides,
  };
}

function deps(sefin: SefinClient) {
  return {
    client: sefin,
    environment: 2 as const,
    providerCnpj: PROVIDER,
    template,
    signingKey: { privateKeyPem: cert.privateKeyPem, certificatePem: cert.certificatePem },
    now: new Date("2026-10-05T12:00:00Z"),
  };
}

describe("emissão", () => {
  test("consulta a DPS, emite e devolve chave e número", async () => {
    let emitted = "";
    const outcome = await runNfseJob(job(), deps(client({ emit: async (xml) => { emitted = xml; return { kind: "issued", accessKey: KEY, nfseNumber: "77" }; } })));
    expect(outcome).toEqual({ kind: "issued", accessKey: KEY, nfseNumber: "77", environment: 2 });
    expect(emitted).toContain("<Signature");
    expect(emitted).toContain("<dCompet>2026-09-30</dCompet>");
  });

  test("DPS que já virou nota é só recuperada, sem reenviar", async () => {
    let emitCalls = 0;
    const outcome = await runNfseJob(job({ attemptCount: 2 }), deps(client({
      findAccessKeyByDps: async () => KEY,
      emit: async () => { emitCalls += 1; return { kind: "issued", accessKey: KEY, nfseNumber: null }; },
    })));
    expect(outcome).toEqual({ kind: "issued", accessKey: KEY, nfseNumber: "77", environment: 2 });
    expect(emitCalls).toBe(0);
  });

  test("E0014 recupera a nota que já existe", async () => {
    let lookups = 0;
    const outcome = await runNfseJob(job(), deps(client({
      findAccessKeyByDps: async () => (lookups++ === 0 ? null : KEY),
      emit: async () => ({ kind: "rejected", errors: [{ code: "E0014", message: "já existe" }] }),
    })));
    expect(outcome.kind).toBe("issued");
  });

  test("recusa vira falha com o motivo legível", async () => {
    const outcome = await runNfseJob(job(), deps(client({
      emit: async () => ({ kind: "rejected", errors: [{ code: "E0312", message: "Tomador inexistente" }] }),
    })));
    expect(outcome).toEqual({
      kind: "failed",
      message: "E0312: Tomador inexistente",
      errors: [{ code: "E0312", message: "Tomador inexistente" }],
    });
  });

  test("queda de rede espera 1, 5 e 15 minutos e depois desiste", async () => {
    const down = client({ findAccessKeyByDps: async () => { throw new NfseTransientError("ECONNRESET"); } });
    expect(await runNfseJob(job({ attemptCount: 1 }), deps(down))).toEqual({ kind: "retry", message: "ECONNRESET", delayMinutes: 1 });
    expect(await runNfseJob(job({ attemptCount: 3 }), deps(down))).toEqual({ kind: "retry", message: "ECONNRESET", delayMinutes: 15 });
    const gaveUp = await runNfseJob(job({ attemptCount: 4 }), deps(down));
    expect(gaveUp.kind).toBe("failed");
  });

  test("modelo trocado depois do pedido não emite com identificador errado", async () => {
    const outcome = await runNfseJob(job({ dpsId: "DPS" + "9".repeat(42) }), deps(client()));
    expect(outcome.kind).toBe("failed");
  });
});

describe("cancelamento", () => {
  const issued = { status: "cancel_requested" as const, accessKey: KEY, issuedEnvironment: 2 as const, cancelReasonCode: 1 as const, cancelReasonText: "Valor do honorário errado." };

  test("evento aceito cancela", async () => {
    let sent = "";
    const outcome = await runNfseJob(job(issued), deps(client({ cancel: async (_key, xml) => { sent = xml; return { kind: "cancelled" }; } })));
    expect(outcome).toEqual({ kind: "cancelled" });
    expect(sent).toContain("<e101101>");
  });

  test("evento recusado mantém a nota", async () => {
    const outcome = await runNfseJob(job(issued), deps(client({ cancel: async () => ({ kind: "rejected", errors: [{ code: "E1235", message: "Fora do prazo" }] }) })));
    expect(outcome).toEqual({ kind: "cancel_rejected", message: "E1235: Fora do prazo", errors: [{ code: "E1235", message: "Fora do prazo" }] });
  });

  test("nota de outro ambiente não é cancelada por este serviço", async () => {
    const outcome = await runNfseJob(job({ ...issued, issuedEnvironment: 1 }), deps(client()));
    expect(outcome.kind).toBe("cancel_rejected");
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `npx vitest run src/lib/nfse/processor.test.ts`
Esperado: FALHA — módulo inexistente.

- [ ] **Passo 3: implementar**

```ts
import { nfseCompetenceDate, type NfseCancelReasonCode } from "@/domain/nfse";

import { buildCancelRequestXml } from "./cancel-xml";
import { buildDpsXml } from "./dps-xml";
import { NfseTransientError, type NfseApiError, type SefinClient } from "./sefin-client";
import { signNfseXml, type NfseSigningKey } from "./sign";
import type { NfseTemplate } from "./template";
import { nfseIssueTimestamp, nfseToday } from "./time";

/** Uma nota reivindicada da fila, no formato que a orquestração precisa. */
export interface NfseJob {
  id: string;
  status: "queued" | "cancel_requested";
  /** Já contando esta tentativa. */
  attemptCount: number;
  dpsId: string;
  dpsSeries: string;
  dpsNumber: number;
  periodYear: number;
  periodMonth: number;
  amountCents: number;
  takerCnpj: string;
  takerName: string;
  description: string;
  accessKey: string | null;
  issuedEnvironment: 1 | 2 | null;
  cancelReasonCode: NfseCancelReasonCode | null;
  cancelReasonText: string | null;
}

export type NfseJobOutcome =
  | { kind: "issued"; accessKey: string; nfseNumber: string | null; environment: 1 | 2 }
  | { kind: "failed"; message: string; errors: NfseApiError[] }
  | { kind: "retry"; message: string; delayMinutes: number }
  | { kind: "cancelled" }
  | { kind: "cancel_rejected"; message: string; errors: NfseApiError[] };

export interface NfseJobDeps {
  client: SefinClient;
  environment: 1 | 2;
  providerCnpj: string;
  template: NfseTemplate;
  signingKey: NfseSigningKey;
  now: Date;
}

/** Esperas depois da 1ª, 2ª e 3ª tentativa; a 4ª falha de rede desiste. */
export const NFSE_RETRY_DELAYS_MINUTES = [1, 5, 15] as const;

export function formatNfseErrors(errors: readonly NfseApiError[]): string {
  if (errors.length === 0) return "Recusa sem detalhe.";
  return errors
    .map((error) => (error.code ? `${error.code}: ${error.message}` : error.message))
    .join(" · ")
    .slice(0, 2000);
}

async function issue(job: NfseJob, deps: NfseJobDeps): Promise<NfseJobOutcome> {
  // Consulta antes de emitir: se uma tentativa anterior caiu depois do envio,
  // a nota já existe e só precisa ser recuperada.
  const existing = await deps.client.findAccessKeyByDps(job.dpsId);
  if (existing) {
    return { kind: "issued", accessKey: existing, nfseNumber: await deps.client.getNfseNumber(existing), environment: deps.environment };
  }
  const { id, xml } = buildDpsXml({
    environment: deps.environment,
    issuedAt: nfseIssueTimestamp(deps.now),
    competenceDate: nfseCompetenceDate({ year: job.periodYear, month: job.periodMonth }, nfseToday(deps.now)),
    series: job.dpsSeries,
    number: job.dpsNumber,
    providerCnpj: deps.providerCnpj,
    template: deps.template,
    taker: { cnpj: job.takerCnpj, name: job.takerName },
    amountCents: job.amountCents,
    description: job.description,
  });
  if (id !== job.dpsId) {
    return {
      kind: "failed",
      message: "O modelo da nota mudou (município ou CNPJ) depois do pedido. Peça a emissão de novo.",
      errors: [],
    };
  }
  const result = await deps.client.emit(signNfseXml(xml, "infDPS", deps.signingKey));
  if (result.kind === "issued") return { ...result, environment: deps.environment };
  if (result.errors.some((error) => error.code === "E0014")) {
    const recovered = await deps.client.findAccessKeyByDps(job.dpsId);
    if (recovered) {
      return { kind: "issued", accessKey: recovered, nfseNumber: await deps.client.getNfseNumber(recovered), environment: deps.environment };
    }
  }
  return { kind: "failed", message: formatNfseErrors(result.errors), errors: result.errors };
}

async function cancel(job: NfseJob, deps: NfseJobDeps): Promise<NfseJobOutcome> {
  if (!job.accessKey || !job.cancelReasonCode || !job.cancelReasonText) {
    return { kind: "cancel_rejected", message: "Pedido de cancelamento incompleto.", errors: [] };
  }
  if (job.issuedEnvironment !== deps.environment) {
    return {
      kind: "cancel_rejected",
      message: "Esta nota foi emitida em outro ambiente do Sistema Nacional; cancele por ele.",
      errors: [],
    };
  }
  const { xml } = buildCancelRequestXml({
    environment: deps.environment,
    requestedAt: nfseIssueTimestamp(deps.now),
    providerCnpj: deps.providerCnpj,
    accessKey: job.accessKey,
    reasonCode: job.cancelReasonCode,
    reasonText: job.cancelReasonText,
  });
  const result = await deps.client.cancel(job.accessKey, signNfseXml(xml, "infPedReg", deps.signingKey));
  return result.kind === "cancelled"
    ? result
    : { kind: "cancel_rejected", message: formatNfseErrors(result.errors), errors: result.errors };
}

/**
 * Decide o desfecho de uma nota reivindicada. Não toca no banco: quem
 * grava é o repositório do serviço fiscal.
 */
export async function runNfseJob(job: NfseJob, deps: NfseJobDeps): Promise<NfseJobOutcome> {
  try {
    return job.status === "queued" ? await issue(job, deps) : await cancel(job, deps);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha desconhecida.";
    const giveUp = (text: string): NfseJobOutcome =>
      job.status === "queued"
        ? { kind: "failed", message: text, errors: [] }
        : { kind: "cancel_rejected", message: text, errors: [] };
    // Erro que não é de rede (montagem, assinatura) não melhora repetindo.
    if (!(error instanceof NfseTransientError)) return giveUp(message);
    const delay = NFSE_RETRY_DELAYS_MINUTES[job.attemptCount - 1];
    if (delay === undefined) return giveUp(`${message} (desistiu depois de ${job.attemptCount} tentativas)`);
    return { kind: "retry", message, delayMinutes: delay };
  }
}
```

- [ ] **Passo 4: rodar e ver passar**

Rodar: `npx vitest run src/lib/nfse/processor.test.ts`
Esperado: PASS.

- [ ] **Passo 5: commit**

```bash
git add src/lib/nfse/processor.ts src/lib/nfse/processor.test.ts
git commit -m "feat: desfecho de emissao e cancelamento de NFS-e"
```

---

### Tarefa 9: Zip dos PDFs e token interno

**Arquivos:**
- Criar: `src/lib/nfse/danfse-zip.ts`
- Teste: `src/lib/nfse/danfse-zip.test.ts`

- [ ] **Passo 1: escrever o teste**

```ts
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, test } from "vitest";

import { buildDanfseZip, parseDanfseRequest, tokenMatches } from "./danfse-zip";

const KEY_A = "1".repeat(50);
const KEY_B = "2".repeat(50);

describe("pedido de PDFs", () => {
  test("aceita lista de chaves válidas com nomes seguros", () => {
    expect(parseDanfseRequest({ items: [{ accessKey: KEY_A, fileName: "000001-padaria.pdf" }] })).toEqual([
      { accessKey: KEY_A, fileName: "000001-padaria.pdf" },
    ]);
  });
  test("recusa chave fora do formato, nome com caminho e lista vazia", () => {
    expect(parseDanfseRequest({ items: [{ accessKey: "123", fileName: "a.pdf" }] })).toBeNull();
    expect(parseDanfseRequest({ items: [{ accessKey: KEY_A, fileName: "../a.pdf" }] })).toBeNull();
    expect(parseDanfseRequest({ items: [] })).toBeNull();
  });
});

describe("zip", () => {
  test("junta os PDFs e lista as falhas num LEIA-ME", async () => {
    const { zip, failures } = await buildDanfseZip(
      [
        { accessKey: KEY_A, fileName: "a.pdf" },
        { accessKey: KEY_B, fileName: "b.pdf" },
      ],
      async (key) => {
        if (key === KEY_B) throw new Error("DANFSe indisponível");
        return Buffer.from("%PDF-A");
      },
    );
    const files = unzipSync(zip);
    expect(Object.keys(files).sort()).toEqual(["LEIA-ME.txt", "a.pdf"]);
    expect(strFromU8(files["a.pdf"])).toBe("%PDF-A");
    expect(strFromU8(files["LEIA-ME.txt"])).toContain("b.pdf: DANFSe indisponível");
    expect(failures).toHaveLength(1);
  });
});

describe("token interno", () => {
  const token = "x".repeat(40);
  test("confere só o Bearer exato", () => {
    expect(tokenMatches(token, `Bearer ${token}`)).toBe(true);
    expect(tokenMatches(token, `Bearer ${token}y`)).toBe(false);
    expect(tokenMatches(token, undefined)).toBe(false);
  });
  test("token curto nunca confere", () => {
    expect(tokenMatches("curto", "Bearer curto")).toBe(false);
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `npx vitest run src/lib/nfse/danfse-zip.test.ts`
Esperado: FALHA — módulo inexistente.

- [ ] **Passo 3: implementar**

```ts
import { createHash, timingSafeEqual } from "node:crypto";

import { strToU8, zipSync } from "fflate";

export interface DanfseRequestItem {
  accessKey: string;
  fileName: string;
}

export const MAX_DANFSE_ITEMS = 200;
export const MIN_SERVICE_TOKEN_LENGTH = 32;

const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.pdf$/;

/** Valida o corpo do pedido de PDFs vindo do app pela rede interna. */
export function parseDanfseRequest(body: unknown): DanfseRequestItem[] | null {
  const items = body && typeof body === "object" ? (body as { items?: unknown }).items : undefined;
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_DANFSE_ITEMS) return null;
  const parsed: DanfseRequestItem[] = [];
  const names = new Set<string>();
  for (const item of items) {
    const accessKey = (item as { accessKey?: unknown })?.accessKey;
    const fileName = (item as { fileName?: unknown })?.fileName;
    if (typeof accessKey !== "string" || !/^\d{50}$/.test(accessKey)) return null;
    if (typeof fileName !== "string" || !FILE_NAME.test(fileName) || names.has(fileName)) return null;
    names.add(fileName);
    parsed.push({ accessKey, fileName });
  }
  return parsed;
}

/** Busca os PDFs (4 por vez) e devolve o .zip; nada é gravado. */
export async function buildDanfseZip(
  items: readonly DanfseRequestItem[],
  fetchPdf: (accessKey: string) => Promise<Buffer>,
  concurrency = 4,
): Promise<{ zip: Uint8Array; failures: { fileName: string; message: string }[] }> {
  const files: Record<string, Uint8Array> = {};
  const failures: { fileName: string; message: string }[] = [];
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const item = items[next++];
      try {
        files[item.fileName] = new Uint8Array(await fetchPdf(item.accessKey));
      } catch (error) {
        failures.push({ fileName: item.fileName, message: error instanceof Error ? error.message : "Falha desconhecida." });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  if (failures.length > 0) {
    const lines = failures.map((failure) => `${failure.fileName}: ${failure.message}`);
    files["LEIA-ME.txt"] = strToU8(
      `Estes PDFs não vieram do Sistema Nacional. Consulte as notas no Portal Nacional:\n\n${lines.join("\n")}\n`,
    );
  }
  return { zip: zipSync(files, { level: 0 }), failures };
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Bearer exato, comparado em tempo constante. Token curto nunca vale. */
export function tokenMatches(expected: string, authorization: string | undefined): boolean {
  if (expected.length < MIN_SERVICE_TOKEN_LENGTH || !authorization?.startsWith("Bearer ")) return false;
  return timingSafeEqual(digest(expected), digest(authorization.slice("Bearer ".length)));
}
```

- [ ] **Passo 4: rodar e ver passar**

Rodar: `npx vitest run src/lib/nfse/danfse-zip.test.ts`
Esperado: PASS.

- [ ] **Passo 5: commit**

```bash
git add src/lib/nfse/danfse-zip.ts src/lib/nfse/danfse-zip.test.ts
git commit -m "feat: zip de DANFSe sob demanda e token interno"
```

---

### Tarefa 10: Tabelas, migração e RLS

**Arquivos:**
- Modificar: `src/db/schema/domain.ts` (acrescentar no fim)
- Criar: `src/db/migrations/0080_nfse-invoices.sql` (gerado + SQL manual), snapshot e journal (gerados)
- Modificar: `scripts/check-rls.mjs:35-52`

- [ ] **Passo 1: acrescentar ao schema**

No fim de `src/db/schema/domain.ts`:

```ts
// ---------------------------------------------------------------------------
// Notas de honorário pela API nacional (decisão de 2026-10-10)
// ---------------------------------------------------------------------------

export const nfseInvoiceKind = pgEnum("nfse_invoice_kind", ["monthly", "additional_installment"]);

export const nfseInvoiceStatus = pgEnum("nfse_invoice_status", [
  "queued",
  "issued",
  "failed",
  "cancel_requested",
  "cancelled",
]);

export const nfseInvoiceEventType = pgEnum("nfse_invoice_event_type", [
  "requested",
  "issued",
  "failed",
  "retried",
  "cancel_requested",
  "cancelled",
  "cancel_failed",
]);

/**
 * Configuração da emissão por organização: CNPJ do prestador, modelo da nota
 * (jsonb validado em src/lib/nfse/template.ts), série de DPS só da Guilda e o
 * batimento do serviço fiscal. O certificado NUNCA entra aqui: ele mora só nas
 * variáveis do serviço fiscal no Easypanel.
 */
export const nfseSettings = pgTable(
  "nfse_settings",
  {
    orgId: text("org_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    providerCnpj: varchar("provider_cnpj", { length: 14 }).notNull(),
    template: jsonb("template"),
    dpsSeries: varchar("dps_series", { length: 5 }).notNull(),
    nextDpsNumber: bigint("next_dps_number", { mode: "number" }).notNull().default(1),
    updatedBy: text("updated_by").references(() => user.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    serviceSeenAt: timestamp("service_seen_at", { withTimezone: true }),
    serviceEnvironment: smallint("service_environment"),
    certificateValidUntil: timestamp("certificate_valid_until", { withTimezone: true }),
    serviceError: text("service_error"),
  },
  (t) => [
    uniqueIndex("nfse_settings_provider_cnpj_uidx").on(t.providerCnpj),
    check("nfse_settings_provider_cnpj_check", sql`${t.providerCnpj} ~ '^[0-9]{14}$'`),
    check("nfse_settings_dps_series_check", sql`${t.dpsSeries} ~ '^[0-9]{1,5}$'`),
    check("nfse_settings_next_dps_number_check", sql`${t.nextDpsNumber} >= 1`),
  ],
);

/**
 * Uma linha por nota pedida. A situação diz o que foi pedido (emitir ou
 * cancelar); o lease (locked_at, lock_token) marca que o serviço está nela.
 * Guarda só ponteiros (chave, número): PDF e XML ficam no Sistema Nacional.
 */
export const nfseInvoices = pgTable(
  "nfse_invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull(),
    controlPeriodId: uuid("control_period_id").notNull(),
    kind: nfseInvoiceKind("kind").notNull(),
    periodYear: smallint("period_year").notNull(),
    periodMonth: smallint("period_month").notNull(),
    amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
    takerCnpj: varchar("taker_cnpj", { length: 14 }).notNull(),
    takerName: varchar("taker_name", { length: 300 }).notNull(),
    description: varchar("description", { length: 2000 }).notNull(),
    dpsSeries: varchar("dps_series", { length: 5 }).notNull(),
    dpsNumber: bigint("dps_number", { mode: "number" }).notNull(),
    dpsId: varchar("dps_id", { length: 45 }).notNull(),
    status: nfseInvoiceStatus("status").notNull().default("queued"),
    environment: smallint("environment"),
    accessKey: varchar("access_key", { length: 50 }),
    nfseNumber: varchar("nfse_number", { length: 20 }),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    lastError: text("last_error"),
    attemptCount: smallint("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockToken: uuid("lock_token"),
    requestedBy: text("requested_by")
      .notNull()
      .references(() => user.id),
    cancelRequestedBy: text("cancel_requested_by").references(() => user.id),
    cancelReasonCode: smallint("cancel_reason_code"),
    cancelReasonText: varchar("cancel_reason_text", { length: 255 }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "nfse_invoices_org_client_fk",
      columns: [t.orgId, t.clientId],
      foreignColumns: [clients.orgId, clients.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "nfse_invoices_org_control_fk",
      columns: [t.orgId, t.controlPeriodId],
      foreignColumns: [officeFeeControlPeriods.orgId, officeFeeControlPeriods.id],
    }).onDelete("cascade"),
    uniqueIndex("nfse_invoices_org_id_uidx").on(t.orgId, t.id),
    uniqueIndex("nfse_invoices_org_dps_uidx").on(t.orgId, t.dpsSeries, t.dpsNumber),
    uniqueIndex("nfse_invoices_active_monthly_uidx")
      .on(t.orgId, t.clientId, t.periodYear, t.periodMonth)
      .where(sql`kind = 'monthly' AND status <> 'cancelled'`),
    uniqueIndex("nfse_invoices_active_additional_uidx")
      .on(t.orgId, t.clientId, t.periodYear)
      .where(sql`kind = 'additional_installment' AND status <> 'cancelled'`),
    index("nfse_invoices_org_period_idx").on(t.orgId, t.periodYear, t.periodMonth),
    index("nfse_invoices_pending_idx")
      .on(t.orgId, t.nextAttemptAt)
      .where(sql`status IN ('queued', 'cancel_requested')`),
    check("nfse_invoices_amount_check", sql`${t.amount} > 0`),
    check("nfse_invoices_month_check", sql`${t.periodMonth} BETWEEN 1 AND 12`),
    check(
      "nfse_invoices_cancel_reason_check",
      sql`${t.cancelReasonCode} IS NULL OR ${t.cancelReasonCode} IN (1, 2, 9)`,
    ),
    check("nfse_invoices_environment_check", sql`${t.environment} IS NULL OR ${t.environment} IN (1, 2)`),
    check(
      "nfse_invoices_access_key_check",
      sql`${t.status} NOT IN ('issued', 'cancel_requested', 'cancelled') OR ${t.accessKey} IS NOT NULL`,
    ),
  ],
);

/** Histórico das notas — só acréscimo. actor_id nulo = serviço fiscal. */
export const nfseInvoiceEvents = pgTable(
  "nfse_invoice_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id").notNull(),
    eventType: nfseInvoiceEventType("event_type").notNull(),
    actorId: text("actor_id").references(() => user.id),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "nfse_invoice_events_org_invoice_fk",
      columns: [t.orgId, t.invoiceId],
      foreignColumns: [nfseInvoices.orgId, nfseInvoices.id],
    }).onDelete("cascade"),
    index("nfse_invoice_events_org_invoice_idx").on(t.orgId, t.invoiceId, t.createdAt),
  ],
);

export type NfseInvoice = typeof nfseInvoices.$inferSelect;
```

- [ ] **Passo 2: gerar a migração**

Rodar: `npm run db:generate -- --name nfse-invoices`
Esperado: `src/db/migrations/0080_nfse-invoices.sql` criado, com os três
`CREATE TABLE`, os enums, FKs e índices. Se o drizzle-kit disser "sem
mudanças", não acreditar: conferir o arquivo e o journal (memória
"quirks do drizzle-kit").

- [ ] **Passo 3: acrescentar o SQL manual ao fim de `0080_nfse-invoices.sql`**

```sql
--> statement-breakpoint
-- Notas de honorário: isolamento por organização (decisão de 2026-10-10).
ALTER TABLE "nfse_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "nfse_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "nfse_settings"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "nfse_invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "nfse_invoices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "nfse_invoices"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "nfse_invoice_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "nfse_invoice_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation_select" ON "nfse_invoice_events"
  FOR SELECT USING ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY "org_isolation_insert" ON "nfse_invoice_events"
  FOR INSERT WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
-- O guilda_app ganha tudo em tabela nova pelos default privileges
-- (docker/*/init/01-roles): GRANT sozinho nao restringe nada.
-- Configuracao nao se apaga; nota nao se apaga e so muda as colunas do
-- ciclo de vida; historico e so acrescimo. Cascata das FKs roda como dono.
GRANT SELECT, INSERT, UPDATE ON "nfse_settings" TO guilda_app;--> statement-breakpoint
REVOKE DELETE ON "nfse_settings" FROM guilda_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "nfse_invoices" TO guilda_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "nfse_invoices" FROM guilda_app;--> statement-breakpoint
GRANT UPDATE ("status", "environment", "access_key", "nfse_number", "issued_at", "last_error", "attempt_count", "next_attempt_at", "locked_at", "lock_token", "cancel_requested_by", "cancel_reason_code", "cancel_reason_text", "cancelled_at", "updated_at") ON "nfse_invoices" TO guilda_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "nfse_invoice_events" TO guilda_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "nfse_invoice_events" FROM guilda_app;--> statement-breakpoint
-- Batimento do servico fiscal: localiza a organizacao pelo CNPJ do
-- certificado (unico entre organizacoes) e devolve o org_id. E a unica
-- consulta que atravessa organizacoes; o resto roda em withOrgTx.
CREATE OR REPLACE FUNCTION public.nfse_register_service(
  p_cnpj text,
  p_environment smallint,
  p_certificate_valid_until timestamptz,
  p_error text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_org text;
BEGIN
  IF p_cnpj IS NULL OR p_cnpj !~ '^[0-9]{14}$' THEN
    RAISE EXCEPTION 'CNPJ do certificado invalido';
  END IF;
  IF p_environment IS NULL OR p_environment NOT IN (1, 2) THEN
    RAISE EXCEPTION 'ambiente invalido';
  END IF;
  UPDATE public.nfse_settings
     SET service_seen_at = statement_timestamp(),
         service_environment = p_environment,
         certificate_valid_until = p_certificate_valid_until,
         service_error = left(NULLIF(p_error, ''), 500)
   WHERE provider_cnpj = p_cnpj
  RETURNING org_id INTO v_org;
  RETURN v_org;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.nfse_register_service(text, smallint, timestamptz, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.nfse_register_service(text, smallint, timestamptz, text) TO guilda_app;
```

- [ ] **Passo 4: registrar o histórico como só acréscimo no `check-rls`**

Em `scripts/check-rls.mjs`, acrescentar `"nfse_invoice_events"` ao fim de
`APPEND_ONLY_TABLES` e de `SPLIT_POLICY_TABLES`.

- [ ] **Passo 5: aplicar no banco local e conferir**

```bash
npm run db:up
npm run db:migrate
npm run check:rls
```

Esperado: migração aplicada; `check:rls` com `OK` para `nfse_settings`,
`nfse_invoices` e `nfse_invoice_events` (habilitado, forçado, políticas,
UPDATE/DELETE revogados no histórico). Se o Docker não subir (já caiu por
falta de memória), registrar no resumo que a prova de banco fica para a
homologação e seguir — a migração roda no boot do app.

- [ ] **Passo 6: commit**

```bash
git add src/db/schema/domain.ts src/db/migrations scripts/check-rls.mjs
git commit -m "feat: tabelas das notas de honorario com RLS e fila"
```

---

### Tarefa 11: Mudança de etapa compartilhada e `requireFiscalClan`

**Arquivos:**
- Criar: `src/lib/office-fees/step-change.ts`, `src/lib/office-fees/fiscal-clan.ts`
- Modificar: `src/app/(app)/clans/[id]/office-fee-actions.ts`

- [ ] **Passo 1: criar `fiscal-clan.ts`** (movido de dentro do arquivo de actions:
arquivo `"use server"` exporta tudo como endpoint, então helper compartilhado
não pode morar lá)

```ts
import "server-only";

import type { OrgTx } from "@/db/org-tx";
import { loadClanScopedFacts } from "@/lib/clans/facts";
import { lockActiveClansForMembershipRead } from "@/lib/clans/locks";
import { FISCAL_CLAN_SLUG } from "@/lib/clans/rules";

/** Carrega o clã pedido e os fatos de quem age; null se não for o Fiscal. */
export async function requireFiscalClan(
  tx: OrgTx,
  input: {
    orgId: string;
    clanId: string;
    userId: string;
    role: Parameters<typeof loadClanScopedFacts>[4];
  },
) {
  await lockActiveClansForMembershipRead(tx, input.orgId);
  const loaded = await loadClanScopedFacts(tx, input.orgId, input.clanId, input.userId, input.role);
  if (!loaded.clan || loaded.clan.slug !== FISCAL_CLAN_SLUG) return null;
  return loaded;
}
```

- [ ] **Passo 2: criar `step-change.ts`**

```ts
import "server-only";

import { and, eq } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import type { FiscalControlStatus, FiscalStepStatus } from "@/domain/fiscal-control";
import { deriveOfficeFeeStatus, type OfficeFeeStage } from "@/domain/office-fee-control";

export const OFFICE_FEE_STAGE_COLUMNS = {
  invoice: "invoiceStatus",
  additional_installment: "additionalInstallmentStatus",
  collection: "collectionStatus",
} as const;

function stepUpdate(stage: OfficeFeeStage, status: FiscalStepStatus) {
  if (stage === "invoice") return { invoiceStatus: status };
  if (stage === "additional_installment") return { additionalInstallmentStatus: status };
  return { collectionStatus: status };
}

/**
 * Muda uma etapa do controle mensal de honorários, recalcula a situação e
 * grava o histórico. Usada pelo clique na etapa e pelo serviço fiscal (nota
 * emitida marca "Nota" como feita; cancelada, reabre). Etapa "não se aplica"
 * nunca muda por aqui. Devolve a situação resultante (null: controle sumiu).
 */
export async function applyOfficeFeeStepChange(
  tx: OrgTx,
  input: {
    orgId: string;
    controlPeriodId: string;
    stage: OfficeFeeStage;
    stepStatus: FiscalStepStatus;
    actorId: string;
  },
): Promise<FiscalControlStatus | null> {
  const t = schema.officeFeeControlPeriods;
  const [control] = await tx
    .select()
    .from(t)
    .where(and(eq(t.orgId, input.orgId), eq(t.id, input.controlPeriodId)))
    .for("update");
  if (!control) return null;
  const previous = control[OFFICE_FEE_STAGE_COLUMNS[input.stage]];
  if (previous === input.stepStatus || previous === "not_applicable" || input.stepStatus === "not_applicable") {
    return control.status;
  }
  const steps: Record<OfficeFeeStage, FiscalStepStatus> = {
    invoice: control.invoiceStatus,
    additional_installment: control.additionalInstallmentStatus,
    collection: control.collectionStatus,
  };
  steps[input.stage] = input.stepStatus;
  const nextStatus = deriveOfficeFeeStatus(steps);
  const now = new Date();
  const completion =
    nextStatus === "completed"
      ? {
          completedBy: control.status === "completed" ? control.completedBy : input.actorId,
          completedAt: control.status === "completed" ? control.completedAt : now,
        }
      : { completedBy: null, completedAt: null };
  await tx
    .update(t)
    .set({ ...stepUpdate(input.stage, input.stepStatus), status: nextStatus, ...completion, updatedBy: input.actorId, updatedAt: now })
    .where(and(eq(t.orgId, input.orgId), eq(t.id, control.id)));
  await tx.insert(schema.officeFeeControlEvents).values({
    orgId: input.orgId,
    controlPeriodId: control.id,
    clientId: control.clientId,
    eventType: "step_updated",
    stage: input.stage,
    previousValue: { status: previous },
    newValue: { status: input.stepStatus },
    actorId: input.actorId,
  });
  if (nextStatus !== control.status) {
    await tx.insert(schema.officeFeeControlEvents).values({
      orgId: input.orgId,
      controlPeriodId: control.id,
      clientId: control.clientId,
      eventType:
        nextStatus === "completed" ? "completed" : control.status === "completed" ? "reopened" : "status_updated",
      previousValue: { status: control.status },
      newValue: { status: nextStatus },
      actorId: input.actorId,
    });
  }
  return nextStatus;
}
```

- [ ] **Passo 3: usar os dois em `office-fee-actions.ts`**

1. Apagar a função local `requireFiscalClan` e os imports que só ela usava
   (`loadClanScopedFacts`, `lockActiveClansForMembershipRead`, `FISCAL_CLAN_SLUG`);
   importar `requireFiscalClan` de `@/lib/office-fees/fiscal-clan`.
2. Apagar a constante local `STAGE_COLUMNS`; importar
   `applyOfficeFeeStepChange` e `OFFICE_FEE_STAGE_COLUMNS` de
   `@/lib/office-fees/step-change`.
3. Em `updateOfficeFeeControl`, manter a validação e o cálculo de
   `stageChanged`/`noteChanged` (trocando `STAGE_COLUMNS` por
   `OFFICE_FEE_STAGE_COLUMNS`) e substituir tudo a partir de
   `const updates: Partial<...> = {` até o `return { ok: true, data: { status: nextStatus } };`
   por:

```ts
    let status = control.status;
    if (stageChanged && data.stage && data.stepStatus) {
      status =
        (await applyOfficeFeeStepChange(tx, {
          orgId: ctx.orgId,
          controlPeriodId: control.id,
          stage: data.stage,
          stepStatus: data.stepStatus,
          actorId: ctx.userId,
        })) ?? status;
    }
    if (noteChanged && data.monthlyNotes !== undefined) {
      await tx
        .update(schema.officeFeeControlPeriods)
        .set({ monthlyNotes: data.monthlyNotes || null, updatedBy: ctx.userId, updatedAt: new Date() })
        .where(and(eq(schema.officeFeeControlPeriods.orgId, ctx.orgId), eq(schema.officeFeeControlPeriods.id, control.id)));
      await tx.insert(schema.officeFeeControlEvents).values({
        orgId: ctx.orgId,
        controlPeriodId: control.id,
        clientId: control.clientId,
        eventType: "note_updated",
        previousValue: { monthlyNotes: control.monthlyNotes },
        newValue: { monthlyNotes: data.monthlyNotes || null },
        actorId: ctx.userId,
      });
    }
    return { ok: true, data: { status } };
```

4. Apagar `nextSteps` (e os imports `deriveOfficeFeeStatus`, `FiscalStepStatus`,
   `OfficeFeeStage` se ficarem sem uso — o lint aponta).

- [ ] **Passo 4: conferir**

Rodar: `npx tsc --noEmit -p . && npx eslint "src/app/(app)/clans/[id]/office-fee-actions.ts" src/lib/office-fees && npx vitest run`
Esperado: sem erros; suíte toda verde (o comportamento da etapa não mudou).

- [ ] **Passo 5: commit**

```bash
git add src/lib/office-fees "src/app/(app)/clans/[id]/office-fee-actions.ts"
git commit -m "refactor: mudanca de etapa dos honorarios compartilhada com o servico fiscal"
```

---

### Tarefa 12: Pedidos do app

**Arquivos:**
- Criar: `src/lib/nfse/requests.ts`

Sem teste unitário (é acesso a banco); a regra que decide vive em
`selectNfseBatch`, já testada. Coberto pela etapa 2 na homologação.

- [ ] **Passo 1: implementar**

```ts
import "server-only";

import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import {
  buildDpsId,
  centsToNfseAmount,
  danfseFileName,
  isFutureNfsePeriod,
  normalizeDpsSeries,
  renderNfseDescription,
  selectNfseBatch,
  type NfseCancelReasonCode,
  type NfseEmissionPreviewView,
} from "@/domain/nfse";

import { parseNfseTemplate, type NfseTemplate } from "./template";

export type NfseCommandResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "23505");
}

export interface NfseSettingsRecord {
  providerCnpj: string;
  dpsSeries: string;
  template: NfseTemplate | null;
  nextDpsNumber: number;
  serviceSeenAt: Date | null;
  serviceEnvironment: number | null;
  certificateValidUntil: Date | null;
  serviceError: string | null;
}

export async function loadNfseSettings(
  tx: OrgTx,
  orgId: string,
  options: { lock?: boolean } = {},
): Promise<NfseSettingsRecord | null> {
  const query = tx.select().from(schema.nfseSettings).where(eq(schema.nfseSettings.orgId, orgId));
  const [row] = options.lock ? await query.for("update") : await query;
  if (!row) return null;
  return {
    providerCnpj: row.providerCnpj,
    dpsSeries: row.dpsSeries,
    template: parseNfseTemplate(row.template),
    nextDpsNumber: row.nextDpsNumber,
    serviceSeenAt: row.serviceSeenAt,
    serviceEnvironment: row.serviceEnvironment,
    certificateValidUntil: row.certificateValidUntil,
    serviceError: row.serviceError,
  };
}

/** Prévia do lote do mês, recalculada no servidor a cada pedido. */
export async function loadNfseEmissionPreview(
  tx: OrgTx,
  input: { orgId: string; year: number; month: number; includeAdditional: boolean },
): Promise<NfseEmissionPreviewView> {
  const control = schema.officeFeeControlPeriods;
  const rows = await tx
    .select({
      id: control.id,
      clientId: control.clientId,
      clientName: control.clientNameSnapshot,
      cnpj: control.clientCnpjSnapshot,
      snapshot: control.profileSnapshot,
    })
    .from(control)
    .where(and(eq(control.orgId, input.orgId), eq(control.periodYear, input.year), eq(control.periodMonth, input.month)))
    .orderBy(asc(control.clientNameSnapshot));
  const invoices = schema.nfseInvoices;
  const active = await tx
    .select({ clientId: invoices.clientId, kind: invoices.kind, periodMonth: invoices.periodMonth })
    .from(invoices)
    .where(and(eq(invoices.orgId, input.orgId), eq(invoices.periodYear, input.year), ne(invoices.status, "cancelled")));
  const [withoutFee] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.clients)
    .leftJoin(
      schema.officeFeeProfiles,
      and(eq(schema.officeFeeProfiles.orgId, schema.clients.orgId), eq(schema.officeFeeProfiles.clientId, schema.clients.id)),
    )
    .where(and(eq(schema.clients.orgId, input.orgId), eq(schema.clients.active, true), isNull(schema.officeFeeProfiles.id)));
  const batch = selectNfseBatch({
    candidates: rows.map((row) => ({
      controlPeriodId: row.id,
      clientId: row.clientId,
      clientName: row.clientName,
      cnpj: row.cnpj,
      monthlyFee: row.snapshot.monthlyFee,
      chargesAdditionalInstallment: row.snapshot.chargesAdditionalInstallment,
    })),
    activeMonthlyClientIds: new Set(
      active.filter((row) => row.kind === "monthly" && row.periodMonth === input.month).map((row) => row.clientId),
    ),
    activeAdditionalClientIds: new Set(
      active.filter((row) => row.kind === "additional_installment").map((row) => row.clientId),
    ),
    includeAdditional: input.includeAdditional,
  });
  return { ...batch, companiesWithoutFee: withoutFee?.count ?? 0 };
}

/**
 * Grava o lote na fila. Trava a configuração (serializa cliques simultâneos),
 * recalcula a prévia e só segue se ela for a mesma que a pessoa viu; reserva
 * os números de DPS na mesma transação — o número nunca muda depois.
 */
export async function enqueueNfseBatch(
  tx: OrgTx,
  input: {
    orgId: string;
    actorId: string;
    year: number;
    month: number;
    includeAdditional: boolean;
    expectedCount: number;
    expectedTotalCents: number;
    today: string;
  },
): Promise<NfseCommandResult<{ queued: number }>> {
  const settings = await loadNfseSettings(tx, input.orgId, { lock: true });
  const template = settings?.template;
  if (!settings || !template) return fail("Configure o modelo da nota antes de emitir.");
  if (isFutureNfsePeriod(input, input.today)) return fail("Não dá para emitir nota de um mês que ainda não começou.");
  const preview = await loadNfseEmissionPreview(tx, input);
  if (preview.items.length === 0) return fail("Nenhuma nota para emitir neste mês.");
  if (preview.items.length !== input.expectedCount || preview.totalCents !== input.expectedTotalCents) {
    return fail("A lista mudou desde a prévia. Abra a prévia de novo antes de emitir.");
  }
  const first = settings.nextDpsNumber;
  await tx
    .update(schema.nfseSettings)
    .set({ nextDpsNumber: first + preview.items.length })
    .where(eq(schema.nfseSettings.orgId, input.orgId));
  try {
    const inserted = await tx
      .insert(schema.nfseInvoices)
      .values(
        preview.items.map((item, index) => {
          const dpsNumber = first + index;
          return {
            orgId: input.orgId,
            clientId: item.clientId,
            controlPeriodId: item.controlPeriodId,
            kind: item.kind,
            periodYear: input.year,
            periodMonth: input.month,
            amount: centsToNfseAmount(item.amountCents),
            takerCnpj: item.cnpj,
            takerName: item.clientName,
            description: renderNfseDescription(
              item.kind === "monthly" ? template.descriptions.monthly : template.descriptions.additionalInstallment,
              input,
            ),
            dpsSeries: settings.dpsSeries,
            dpsNumber,
            dpsId: buildDpsId({ cityCode: template.cityCode, cnpj: settings.providerCnpj, series: settings.dpsSeries, number: dpsNumber }),
            requestedBy: input.actorId,
          };
        }),
      )
      .returning({ id: schema.nfseInvoices.id });
    await tx.insert(schema.nfseInvoiceEvents).values(
      inserted.map((row) => ({ orgId: input.orgId, invoiceId: row.id, eventType: "requested" as const, actorId: input.actorId })),
    );
    return { ok: true, data: { queued: inserted.length } };
  } catch (error) {
    if (isUniqueViolation(error)) return fail("Outra pessoa emitiu notas deste mês ao mesmo tempo. Abra a prévia de novo.");
    throw error;
  }
}

export async function requestNfseCancel(
  tx: OrgTx,
  input: { orgId: string; actorId: string; invoiceId: string; reasonCode: NfseCancelReasonCode; reasonText: string },
): Promise<NfseCommandResult> {
  const t = schema.nfseInvoices;
  const [invoice] = await tx
    .select({ id: t.id, status: t.status })
    .from(t)
    .where(and(eq(t.orgId, input.orgId), eq(t.id, input.invoiceId)))
    .for("update");
  if (!invoice) return fail("Nota não encontrada.");
  if (invoice.status !== "issued") return fail("Só uma nota emitida pode ser cancelada.");
  await tx
    .update(t)
    .set({
      status: "cancel_requested",
      cancelRequestedBy: input.actorId,
      cancelReasonCode: input.reasonCode,
      cancelReasonText: input.reasonText,
      attemptCount: 0,
      nextAttemptAt: new Date(),
      lastError: null,
      updatedAt: new Date(),
    })
    .where(and(eq(t.orgId, input.orgId), eq(t.id, invoice.id)));
  await tx.insert(schema.nfseInvoiceEvents).values({
    orgId: input.orgId,
    invoiceId: invoice.id,
    eventType: "cancel_requested",
    actorId: input.actorId,
    detail: { reasonCode: input.reasonCode, reasonText: input.reasonText },
  });
  return { ok: true, data: undefined };
}

/** Recoloca na fila uma nota que falhou, com o MESMO número de DPS. */
export async function requeueNfseInvoice(
  tx: OrgTx,
  input: { orgId: string; actorId: string; invoiceId: string },
): Promise<NfseCommandResult> {
  const t = schema.nfseInvoices;
  const [invoice] = await tx
    .select({ id: t.id, status: t.status })
    .from(t)
    .where(and(eq(t.orgId, input.orgId), eq(t.id, input.invoiceId)))
    .for("update");
  if (!invoice) return fail("Nota não encontrada.");
  if (invoice.status !== "failed") return fail("Só uma nota com erro volta para a fila.");
  await tx
    .update(t)
    .set({ status: "queued", attemptCount: 0, nextAttemptAt: new Date(), lastError: null, updatedAt: new Date() })
    .where(and(eq(t.orgId, input.orgId), eq(t.id, invoice.id)));
  await tx.insert(schema.nfseInvoiceEvents).values({
    orgId: input.orgId,
    invoiceId: invoice.id,
    eventType: "retried",
    actorId: input.actorId,
  });
  return { ok: true, data: undefined };
}

export async function upsertNfseSettings(
  tx: OrgTx,
  input: { orgId: string; actorId: string; providerCnpj: string; dpsSeries: string; template: NfseTemplate },
): Promise<NfseCommandResult> {
  const series = normalizeDpsSeries(input.dpsSeries);
  const current = await loadNfseSettings(tx, input.orgId, { lock: true });
  const changesIdentity =
    !current ||
    current.providerCnpj !== input.providerCnpj ||
    current.dpsSeries !== series ||
    current.template?.cityCode !== input.template.cityCode;
  if (current && changesIdentity) {
    const [busy] = await tx
      .select({ id: schema.nfseInvoices.id })
      .from(schema.nfseInvoices)
      .where(and(eq(schema.nfseInvoices.orgId, input.orgId), inArray(schema.nfseInvoices.status, ["queued", "cancel_requested"])))
      .limit(1);
    if (busy) return fail("Há notas na fila. Espere a fila esvaziar para trocar CNPJ, série ou município.");
  }
  try {
    await tx
      .insert(schema.nfseSettings)
      .values({ orgId: input.orgId, providerCnpj: input.providerCnpj, dpsSeries: series, template: input.template, updatedBy: input.actorId })
      .onConflictDoUpdate({
        target: schema.nfseSettings.orgId,
        set: { providerCnpj: input.providerCnpj, dpsSeries: series, template: input.template, updatedBy: input.actorId, updatedAt: new Date() },
      });
  } catch (error) {
    if (isUniqueViolation(error)) return fail("Este CNPJ já está configurado em outra organização.");
    throw error;
  }
  return { ok: true, data: undefined };
}

export interface NfseInvoiceRow {
  id: string;
  clientName: string;
  kind: "monthly" | "additional_installment";
  amount: string;
  status: "queued" | "issued" | "failed" | "cancel_requested" | "cancelled";
  nfseNumber: string | null;
  issuedAt: Date | null;
  lastError: string | null;
  environment: number | null;
}

export async function loadNfseMonth(
  tx: OrgTx,
  input: { orgId: string; year: number; month: number },
): Promise<NfseInvoiceRow[]> {
  const t = schema.nfseInvoices;
  return tx
    .select({
      id: t.id,
      clientName: t.takerName,
      kind: t.kind,
      amount: t.amount,
      status: t.status,
      nfseNumber: t.nfseNumber,
      issuedAt: t.issuedAt,
      lastError: t.lastError,
      environment: t.environment,
    })
    .from(t)
    .where(and(eq(t.orgId, input.orgId), eq(t.periodYear, input.year), eq(t.periodMonth, input.month)))
    .orderBy(asc(t.takerName), asc(t.kind), asc(t.createdAt));
}

/** Chaves e nomes de arquivo das notas emitidas do mês (ou de uma nota). */
export async function loadDanfseItems(
  tx: OrgTx,
  input: { orgId: string; year: number; month: number; invoiceId?: string },
): Promise<{ accessKey: string; fileName: string }[]> {
  const t = schema.nfseInvoices;
  const rows = await tx
    .select({ accessKey: t.accessKey, nfseNumber: t.nfseNumber, dpsNumber: t.dpsNumber, takerName: t.takerName, kind: t.kind })
    .from(t)
    .where(
      and(
        eq(t.orgId, input.orgId),
        eq(t.periodYear, input.year),
        eq(t.periodMonth, input.month),
        eq(t.status, "issued"),
        input.invoiceId ? eq(t.id, input.invoiceId) : undefined,
      ),
    )
    .orderBy(asc(t.takerName));
  const used = new Set<string>();
  return rows.flatMap((row) => {
    if (!row.accessKey) return [];
    let fileName = danfseFileName({ nfseNumber: row.nfseNumber, dpsNumber: row.dpsNumber, takerName: row.takerName });
    if (row.kind === "additional_installment") fileName = fileName.replace(/\.pdf$/, "-pa.pdf");
    if (used.has(fileName)) fileName = fileName.replace(/\.pdf$/, `-${row.dpsNumber}.pdf`);
    used.add(fileName);
    return [{ accessKey: row.accessKey, fileName }];
  });
}
```

- [ ] **Passo 2: conferir**

Rodar: `npx tsc --noEmit -p . && npx eslint src/lib/nfse/requests.ts`
Esperado: sem erros.

- [ ] **Passo 3: commit**

```bash
git add src/lib/nfse/requests.ts
git commit -m "feat: previa, fila e cancelamento das notas no lado do app"
```

---

### Tarefa 13: Repositório do serviço fiscal

**Arquivos:**
- Criar: `src/lib/nfse/repository.ts`

- [ ] **Passo 1: implementar**

```ts
import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { amountToCents, type NfseCancelReasonCode, type NfseInvoiceKind } from "@/domain/nfse";
import { applyOfficeFeeStepChange } from "@/lib/office-fees/step-change";

import type { NfseJob, NfseJobOutcome } from "./processor";
import { parseNfseTemplate, type NfseTemplate } from "./template";

/** Lease vencido: o serviço caiu no meio e outra rodada pode assumir. */
const LEASE_MINUTES = 5;

export interface NfseClaim extends NfseJob {
  lockToken: string;
  kind: NfseInvoiceKind;
  controlPeriodId: string;
  requestedBy: string;
  cancelRequestedBy: string | null;
}

/** Batimento + descoberta da organização pelo CNPJ do certificado. */
export async function registerFiscalService(input: {
  cnpj: string;
  environment: 1 | 2;
  certificateValidUntil: Date | null;
  error: string | null;
}): Promise<string | null> {
  const result = await db.execute<{ org_id: string | null }>(
    sql`SELECT public.nfse_register_service(
          ${input.cnpj}::text,
          ${input.environment}::smallint,
          ${input.certificateValidUntil}::timestamptz,
          ${input.error}::text
        ) AS org_id`,
  );
  return result.rows[0]?.org_id ?? null;
}

export async function loadServiceSettings(
  orgId: string,
): Promise<{ providerCnpj: string; template: NfseTemplate | null } | null> {
  return withOrgTx(orgId, async (tx) => {
    const [row] = await tx
      .select({ providerCnpj: schema.nfseSettings.providerCnpj, template: schema.nfseSettings.template })
      .from(schema.nfseSettings)
      .where(eq(schema.nfseSettings.orgId, orgId));
    return row ? { providerCnpj: row.providerCnpj, template: parseNfseTemplate(row.template) } : null;
  });
}

/** Reivindica a próxima nota pendente (emitir ou cancelar) com lease. */
export async function claimNfseJob(orgId: string): Promise<NfseClaim | null> {
  return withOrgTx(orgId, async (tx) => {
    const t = schema.nfseInvoices;
    const now = new Date();
    const staleBefore = new Date(now.getTime() - LEASE_MINUTES * 60_000);
    const [candidate] = await tx
      .select({ id: t.id })
      .from(t)
      .where(
        and(
          eq(t.orgId, orgId),
          inArray(t.status, ["queued", "cancel_requested"]),
          lte(t.nextAttemptAt, now),
          or(isNull(t.lockedAt), lt(t.lockedAt, staleBefore)),
        ),
      )
      .orderBy(asc(t.nextAttemptAt), asc(t.createdAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!candidate) return null;
    const lockToken = randomUUID();
    const [row] = await tx
      .update(t)
      .set({ attemptCount: sql`${t.attemptCount} + 1`, lockedAt: now, lockToken, updatedAt: now })
      .where(and(eq(t.orgId, orgId), eq(t.id, candidate.id)))
      .returning();
    if (row.status !== "queued" && row.status !== "cancel_requested") return null;
    return {
      id: row.id,
      status: row.status,
      attemptCount: row.attemptCount,
      dpsId: row.dpsId,
      dpsSeries: row.dpsSeries,
      dpsNumber: row.dpsNumber,
      periodYear: row.periodYear,
      periodMonth: row.periodMonth,
      amountCents: amountToCents(row.amount),
      takerCnpj: row.takerCnpj,
      takerName: row.takerName,
      description: row.description,
      accessKey: row.accessKey,
      issuedEnvironment: row.environment === 1 || row.environment === 2 ? row.environment : null,
      cancelReasonCode: (row.cancelReasonCode as NfseCancelReasonCode | null) ?? null,
      cancelReasonText: row.cancelReasonText,
      lockToken,
      kind: row.kind,
      controlPeriodId: row.controlPeriodId,
      requestedBy: row.requestedBy,
      cancelRequestedBy: row.cancelRequestedBy,
    };
  });
}

function eventFor(
  claim: NfseClaim,
  outcome: NfseJobOutcome,
): { eventType: "issued" | "failed" | "cancelled" | "cancel_failed"; detail: Record<string, unknown> } | null {
  switch (outcome.kind) {
    case "issued":
      return { eventType: "issued", detail: { accessKey: outcome.accessKey, nfseNumber: outcome.nfseNumber, environment: outcome.environment } };
    case "failed":
      return { eventType: "failed", detail: { message: outcome.message, errors: outcome.errors } };
    case "cancelled":
      return { eventType: "cancelled", detail: {} };
    case "cancel_rejected":
      return {
        eventType: "cancel_failed",
        detail: { message: outcome.message, errors: outcome.errors, reasonCode: claim.cancelReasonCode, reasonText: claim.cancelReasonText },
      };
    case "retry":
      return null;
  }
}

/**
 * Grava o desfecho só se o lease ainda for desta rodada. Nota emitida marca a
 * etapa do controle na MESMA transação; cancelada, reabre.
 */
export async function finishNfseJob(orgId: string, claim: NfseClaim, outcome: NfseJobOutcome): Promise<boolean> {
  return withOrgTx(orgId, async (tx) => {
    const t = schema.nfseInvoices;
    const now = new Date();
    const release = { lockedAt: null, lockToken: null, updatedAt: now };
    const values: Partial<typeof t.$inferInsert> =
      outcome.kind === "issued"
        ? { ...release, status: "issued", accessKey: outcome.accessKey, nfseNumber: outcome.nfseNumber, environment: outcome.environment, issuedAt: now, lastError: null }
        : outcome.kind === "failed"
          ? { ...release, status: "failed", lastError: outcome.message }
          : outcome.kind === "retry"
            ? { ...release, lastError: outcome.message, nextAttemptAt: new Date(now.getTime() + outcome.delayMinutes * 60_000) }
            : outcome.kind === "cancelled"
              ? { ...release, status: "cancelled", cancelledAt: now, lastError: null }
              : { ...release, status: "issued", lastError: `Cancelamento recusado: ${outcome.message}`, cancelRequestedBy: null, cancelReasonCode: null, cancelReasonText: null };
    const [updated] = await tx
      .update(t)
      .set(values)
      .where(and(eq(t.orgId, orgId), eq(t.id, claim.id), eq(t.lockToken, claim.lockToken)))
      .returning({ id: t.id });
    if (!updated) return false;
    const event = eventFor(claim, outcome);
    if (event) {
      await tx.insert(schema.nfseInvoiceEvents).values({ orgId, invoiceId: claim.id, actorId: null, ...event });
    }
    const stage = claim.kind === "monthly" ? "invoice" : "additional_installment";
    if (outcome.kind === "issued") {
      await applyOfficeFeeStepChange(tx, { orgId, controlPeriodId: claim.controlPeriodId, stage, stepStatus: "completed", actorId: claim.requestedBy });
    }
    if (outcome.kind === "cancelled") {
      await applyOfficeFeeStepChange(tx, {
        orgId,
        controlPeriodId: claim.controlPeriodId,
        stage,
        stepStatus: "pending",
        actorId: claim.cancelRequestedBy ?? claim.requestedBy,
      });
    }
    return true;
  });
}
```

- [ ] **Passo 2: conferir**

Rodar: `npx tsc --noEmit -p . && npx eslint src/lib/nfse/repository.ts`
Esperado: sem erros.

- [ ] **Passo 3: commit**

```bash
git add src/lib/nfse/repository.ts
git commit -m "feat: fila das notas no lado do servico fiscal"
```

---

### Tarefa 14: O serviço fiscal

**Arquivos:**
- Criar: `scripts/fiscal-service.ts`
- Modificar: `scripts/start-production.mjs` (fim do arquivo)

- [ ] **Passo 1: criar `scripts/fiscal-service.ts`**

```ts
import "./load-env";

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { setTimeout as delay } from "node:timers/promises";

import { loadNfseCertificate, type NfseCertificate } from "../src/lib/nfse/certificate";
import { buildDanfseZip, MIN_SERVICE_TOKEN_LENGTH, parseDanfseRequest, tokenMatches } from "../src/lib/nfse/danfse-zip";
import { runNfseJob } from "../src/lib/nfse/processor";
import {
  claimNfseJob,
  finishNfseJob,
  loadServiceSettings,
  registerFiscalService,
} from "../src/lib/nfse/repository";
import {
  createMtlsTransport,
  createSefinClient,
  NFSE_ENDPOINTS,
  type NfseEnvironmentName,
  type SefinClient,
} from "../src/lib/nfse/sefin-client";

/**
 * Serviço fiscal: o ÚNICO processo com o certificado do escritório. Consome a
 * fila de notas (emitir/cancelar) e serve, só na rede interna, o .zip de
 * PDFs. Sobe com GUILDA_SERVICE=fiscal (scripts/start-production.mjs).
 */

const POLL_MS = 10_000;
const MAX_BODY_BYTES = 64 * 1024;

// Ausente ou inválido vale produção restrita: nota de verdade exige a variável explícita.
const environment: NfseEnvironmentName = process.env.NFSE_AMBIENTE === "producao" ? "producao" : "restrita";
const tpAmb = NFSE_ENDPOINTS[environment].tpAmb;
const token = process.env.FISCAL_SERVICE_TOKEN ?? "";
const port = Number(process.env.FISCAL_SERVICE_PORT ?? 4100);

function openCertificate(): { certificate: NfseCertificate | null; error: string | null } {
  try {
    const certificate = loadNfseCertificate(process.env.NFSE_CERT_PFX_BASE64 ?? "", process.env.NFSE_CERT_PASSWORD ?? "");
    if (certificate.validUntil.getTime() < Date.now()) {
      return { certificate, error: `Certificado vencido em ${certificate.validUntil.toLocaleDateString("pt-BR")}.` };
    }
    return { certificate, error: null };
  } catch (error) {
    return { certificate: null, error: error instanceof Error ? error.message : "Certificado inválido." };
  }
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("Pedido grande demais.");
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function reply(res: ServerResponse, status: number, message: string) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(message);
}

function startHttp(client: SefinClient | null) {
  if (token.length < MIN_SERVICE_TOKEN_LENGTH) {
    console.warn("FISCAL_SERVICE_TOKEN ausente ou curto: o download de PDFs fica desligado.");
  }
  createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/health") {
        reply(res, 200, `ok ${environment}`);
        return;
      }
      if (req.method !== "POST" || req.url !== "/danfse.zip") {
        reply(res, 404, "Não encontrado.");
        return;
      }
      if (!tokenMatches(token, req.headers.authorization)) {
        reply(res, 401, "Não autorizado.");
        return;
      }
      if (!client) {
        reply(res, 503, "Serviço fiscal sem certificado válido.");
        return;
      }
      const items = parseDanfseRequest(await readBody(req));
      if (!items) {
        reply(res, 400, "Pedido de PDFs inválido.");
        return;
      }
      const { zip } = await buildDanfseZip(items, (accessKey) => client.getDanfse(accessKey));
      res.writeHead(200, { "Content-Type": "application/zip", "Content-Length": zip.length });
      res.end(Buffer.from(zip));
    } catch (error) {
      console.error("Falha no download de PDFs:", error instanceof Error ? error.message : error);
      if (!res.headersSent) reply(res, 500, "Falha ao montar os PDFs.");
    }
  }).listen(port, "0.0.0.0", () => console.log(`Serviço fiscal ouvindo na porta ${port} (${environment}).`));
}

async function main() {
  const { certificate, error: certificateError } = openCertificate();
  if (!certificate) console.error(`Serviço fiscal sem certificado: ${certificateError}`);
  const client = certificate
    ? createSefinClient(environment, createMtlsTransport({ privateKeyPem: certificate.privateKeyPem, chainPem: certificate.chainPem }))
    : null;
  startHttp(certificateError ? null : client);

  while (true) {
    const started = Date.now();
    try {
      if (certificate) {
        const orgId = await registerFiscalService({
          cnpj: certificate.cnpj,
          environment: tpAmb,
          certificateValidUntil: certificate.validUntil,
          error: certificateError,
        });
        if (!orgId) {
          console.warn(`Nenhuma organização configurada com o CNPJ ${certificate.cnpj}.`);
        } else if (client && !certificateError) {
          const settings = await loadServiceSettings(orgId);
          if (settings?.template && settings.providerCnpj === certificate.cnpj) {
            const signingKey = { privateKeyPem: certificate.privateKeyPem, certificatePem: certificate.certificatePem };
            for (let claim = await claimNfseJob(orgId); claim; claim = await claimNfseJob(orgId)) {
              const outcome = await runNfseJob(claim, {
                client,
                environment: tpAmb,
                providerCnpj: settings.providerCnpj,
                template: settings.template,
                signingKey,
                now: new Date(),
              });
              const finished = await finishNfseJob(orgId, claim, outcome);
              console.log(`Nota ${claim.id}: ${outcome.kind}${finished ? "" : " (lease vencido, descartado)"}.`);
            }
          }
        }
      }
    } catch (error) {
      console.error("Falha no ciclo do serviço fiscal:", error instanceof Error ? error.message : error);
    }
    await delay(Math.max(1_000, POLL_MS - (Date.now() - started)));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Passo 2: trocar o fim de `scripts/start-production.mjs`**

Substituir o bloco final (do `try { await runMigrations(); }` até o
`start("telegram-worker", ...)`) por:

```js
if (process.env.GUILDA_SERVICE === "fiscal") {
  // Servico fiscal: so o processo que guarda o certificado. As migrations
  // ficam com o servico do app; este conecta como guilda_app e nao migra.
  start("serviço fiscal", [
    "--conditions=react-server",
    "--import=tsx",
    "scripts/fiscal-service.ts",
  ]);
} else {
  try {
    await runMigrations();
  } catch (error) {
    console.error("Falha ao aplicar as migrations:", error.message);
    process.exit(1);
  }

  start("aplicação", ["server.js"]);
  start("telegram-worker", [
    "--conditions=react-server",
    "--import=tsx",
    "scripts/telegram-worker.ts",
  ]);
}
```

- [ ] **Passo 3: conferir que o serviço sobe sem certificado e não quebra**

Rodar: `GUILDA_SERVICE=fiscal timeout 15 node --conditions=react-server --import=tsx scripts/fiscal-service.ts`
Esperado: "Serviço fiscal sem certificado: Não foi possível abrir o
certificado…" e "Serviço fiscal ouvindo na porta 4100 (restrita)", sem
exceção, até o `timeout` encerrar.

- [ ] **Passo 4: commit**

```bash
git add scripts/fiscal-service.ts scripts/start-production.mjs
git commit -m "feat: servico fiscal separado com o certificado"
```

---

### Tarefa 15: Server Actions

**Arquivos:**
- Criar: `src/app/(app)/clans/[id]/nfse-actions.ts`

- [ ] **Passo 1: implementar**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { withOrgTx, type OrgTx } from "@/db/org-tx";
import { normalizeCnpj, validateCnpj } from "@/domain/cnpj";
import { canManageFiscalOperations, isAdminRole } from "@/domain/guild-permissions";
import {
  NFSE_CANCEL_TEXT_MAX,
  NFSE_CANCEL_TEXT_MIN,
  type NfseEmissionPreviewView,
} from "@/domain/nfse";
import { err, requireMemberContext, type ActionResult } from "@/lib/action-context";
import {
  enqueueNfseBatch,
  loadNfseEmissionPreview,
  requeueNfseInvoice,
  requestNfseCancel,
  upsertNfseSettings,
} from "@/lib/nfse/requests";
import { nfseTemplateSchema } from "@/lib/nfse/template";
import { nfseToday } from "@/lib/nfse/time";
import { requireFiscalClan } from "@/lib/office-fees/fiscal-clan";

type MemberContext = Extract<Awaited<ReturnType<typeof requireMemberContext>>, { ok: true }>;

/** Sessão + clã Fiscal + permissão de quem opera honorários (Fiscal e admins). */
async function asFiscalOperator<T>(
  clanId: string,
  run: (tx: OrgTx, ctx: MemberContext) => Promise<ActionResult<T>>,
  options: { adminOnly?: boolean } = {},
): Promise<ActionResult<T>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  if (options.adminOnly && !isAdminRole(ctx.role)) return err("Só admins configuram o modelo da nota.");
  return withOrgTx(ctx.orgId, async (tx) => {
    const fiscal = await requireFiscalClan(tx, { orgId: ctx.orgId, clanId, userId: ctx.userId, role: ctx.role });
    if (!fiscal) return err("Clã Fiscal não encontrado.");
    if (!canManageFiscalOperations(fiscal.facts)) {
      return err("Apenas integrantes do Fiscal ou um admin podem operar as notas.");
    }
    return run(tx, ctx);
  });
}

const periodSchema = z.object({
  clanId: z.uuid("Clã inválido."),
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  includeAdditional: z.boolean(),
});

export async function previewNfseEmission(
  input: z.input<typeof periodSchema>,
): Promise<ActionResult<NfseEmissionPreviewView>> {
  const parsed = periodSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Período inválido.");
  const data = parsed.data;
  return asFiscalOperator(data.clanId, async (tx, ctx) => ({
    ok: true,
    data: await loadNfseEmissionPreview(tx, { orgId: ctx.orgId, ...data }),
  }));
}

const emitSchema = periodSchema.extend({
  expectedCount: z.number().int().min(1).max(1000),
  expectedTotalCents: z.number().int().min(1),
});

export async function emitNfseBatch(
  input: z.input<typeof emitSchema>,
): Promise<ActionResult<{ queued: number }>> {
  const parsed = emitSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Pedido inválido.");
  const data = parsed.data;
  const result = await asFiscalOperator(data.clanId, (tx, ctx) =>
    enqueueNfseBatch(tx, { orgId: ctx.orgId, actorId: ctx.userId, ...data, today: nfseToday(new Date()) }),
  );
  if (result.ok) revalidatePath(`/clans/${data.clanId}`);
  return result;
}

const cancelSchema = z.object({
  clanId: z.uuid("Clã inválido."),
  invoiceId: z.uuid("Nota inválida."),
  reasonCode: z.union([z.literal(1), z.literal(2), z.literal(9)]),
  reasonText: z
    .string()
    .trim()
    .min(NFSE_CANCEL_TEXT_MIN, `Explique o motivo com pelo menos ${NFSE_CANCEL_TEXT_MIN} caracteres.`)
    .max(NFSE_CANCEL_TEXT_MAX, `O motivo pode ter no máximo ${NFSE_CANCEL_TEXT_MAX} caracteres.`),
});

export async function cancelNfseInvoice(input: z.input<typeof cancelSchema>): Promise<ActionResult> {
  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Pedido inválido.");
  const data = parsed.data;
  const result = await asFiscalOperator(data.clanId, (tx, ctx) =>
    requestNfseCancel(tx, { orgId: ctx.orgId, actorId: ctx.userId, invoiceId: data.invoiceId, reasonCode: data.reasonCode, reasonText: data.reasonText }),
  );
  if (result.ok) revalidatePath(`/clans/${data.clanId}`);
  return result;
}

const retrySchema = z.object({ clanId: z.uuid("Clã inválido."), invoiceId: z.uuid("Nota inválida.") });

export async function retryNfseInvoice(input: z.input<typeof retrySchema>): Promise<ActionResult> {
  const parsed = retrySchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Pedido inválido.");
  const data = parsed.data;
  const result = await asFiscalOperator(data.clanId, (tx, ctx) =>
    requeueNfseInvoice(tx, { orgId: ctx.orgId, actorId: ctx.userId, invoiceId: data.invoiceId }),
  );
  if (result.ok) revalidatePath(`/clans/${data.clanId}`);
  return result;
}

const settingsSchema = z.object({
  clanId: z.uuid("Clã inválido."),
  providerCnpj: z.string().transform(normalizeCnpj).refine(validateCnpj, "CNPJ do escritório inválido."),
  dpsSeries: z.string().regex(/^\d{1,5}$/, "Série inválida.").refine((value) => Number(value) >= 1 && Number(value) <= 49_999, "A série deve estar entre 1 e 49999."),
  template: nfseTemplateSchema,
});

export async function saveNfseSettings(input: z.input<typeof settingsSchema>): Promise<ActionResult> {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Modelo inválido.");
  const data = parsed.data;
  const result = await asFiscalOperator(
    data.clanId,
    (tx, ctx) =>
      upsertNfseSettings(tx, { orgId: ctx.orgId, actorId: ctx.userId, providerCnpj: data.providerCnpj, dpsSeries: data.dpsSeries, template: data.template }),
    { adminOnly: true },
  );
  if (result.ok) revalidatePath(`/clans/${data.clanId}`);
  return result;
}
```

`NfseCommandResult` (de `requests.ts`) é compatível com `ActionResult`:
`{ ok: true; data: T } | { ok: false; error: string }` cabe em
`{ ok: true; data?: T } | { ok: false; error: string }`.

- [ ] **Passo 2: conferir**

Rodar: `npx tsc --noEmit -p . && npx eslint "src/app/(app)/clans/[id]/nfse-actions.ts"`
Esperado: sem erros.

- [ ] **Passo 3: commit**

```bash
git add "src/app/(app)/clans/[id]/nfse-actions.ts"
git commit -m "feat: actions de emitir, cancelar e configurar notas de honorario"
```

---

### Tarefa 16: Download dos PDFs

**Arquivos:**
- Criar: `src/app/api/nfse/pdfs/route.ts`

- [ ] **Passo 1: implementar**

```ts
import { z } from "zod";

import { withOrgTx } from "@/db/org-tx";
import { canManageFiscalOperations } from "@/domain/guild-permissions";
import { requireMemberContext } from "@/lib/action-context";
import { loadDanfseItems } from "@/lib/nfse/requests";
import { requireFiscalClan } from "@/lib/office-fees/fiscal-clan";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  clanId: z.uuid(),
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  invoiceId: z.uuid().optional(),
});

function text(status: number, message: string): Response {
  return new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

/**
 * Pede ao serviço fiscal, pela rede interna, o .zip com os PDFs das notas
 * emitidas do mês (ou de uma nota) e repassa em streaming. Nada é gravado.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return text(400, "Pedido inválido.");
  const query = parsed.data;
  const ctx = await requireMemberContext();
  if (!ctx.ok) return text(401, ctx.error);

  const items = await withOrgTx(ctx.orgId, async (tx) => {
    const fiscal = await requireFiscalClan(tx, { orgId: ctx.orgId, clanId: query.clanId, userId: ctx.userId, role: ctx.role });
    if (!fiscal || !canManageFiscalOperations(fiscal.facts)) return null;
    return loadDanfseItems(tx, { orgId: ctx.orgId, year: query.year, month: query.month, invoiceId: query.invoiceId });
  });
  if (!items) return text(403, "Sem permissão para as notas do Fiscal.");
  if (items.length === 0) return text(404, "Nenhuma nota emitida neste mês.");

  const serviceUrl = process.env.FISCAL_SERVICE_URL;
  const token = process.env.FISCAL_SERVICE_TOKEN;
  if (!serviceUrl || !token) return text(503, "Serviço fiscal não configurado.");
  let upstream: Response;
  try {
    upstream = await fetch(`${serviceUrl.replace(/\/$/, "")}/danfse.zip`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    return text(502, "O serviço fiscal não respondeu.");
  }
  if (!upstream.ok || !upstream.body) return text(502, `O serviço fiscal recusou o pedido (${upstream.status}).`);
  const month = String(query.month).padStart(2, "0");
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="notas-honorario-${query.year}-${month}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
```

- [ ] **Passo 2: conferir**

Rodar: `npx tsc --noEmit -p . && npx eslint src/app/api/nfse/pdfs/route.ts`
Esperado: sem erros.

- [ ] **Passo 3: commit**

```bash
git add src/app/api/nfse/pdfs/route.ts
git commit -m "feat: download dos PDFs das notas sem guardar nada"
```

---

### Tarefa 17: Tela — painel, prévia, cancelamento e modelo

**Arquivos:**
- Criar: `src/app/(app)/clans/[id]/nfse-panel.tsx`, `src/app/(app)/clans/[id]/nfse-settings-dialog.tsx`
- Modificar: `src/app/(app)/clans/[id]/office-fee-tab.tsx`, `src/app/(app)/clans/[id]/page.tsx:366-375`

Antes: ler `docs/design-system.md` (h2 de verdade, `.hud-label` só em rótulo,
números em `font-mono tabular-nums`, só tokens de cor, grade com
`grid-cols-1 min-w-0`).

- [ ] **Passo 1: `nfse-panel.tsx`**

```tsx
"use client";

import { Download, FileText, LoaderCircle, RotateCcw, Send, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  NFSE_CANCEL_REASON_CODES,
  NFSE_CANCEL_REASON_LABELS,
  NFSE_CANCEL_TEXT_MAX,
  NFSE_CANCEL_TEXT_MIN,
  NFSE_CERTIFICATE_WARNING_DAYS,
  NFSE_EXCLUSION_LABELS,
  nfseServiceHealth,
  type NfseCancelReasonCode,
  type NfseEmissionPreviewView,
  type NfseInvoiceKind,
  type NfseInvoiceStatus,
} from "@/domain/nfse";
import { formatBRLCurrency } from "@/lib/currency";
import { formatAppDate } from "@/lib/date-time";
import type { NfseTemplate } from "@/lib/nfse/template";
import { cn } from "@/lib/utils";

import { cancelNfseInvoice, emitNfseBatch, previewNfseEmission, retryNfseInvoice } from "./nfse-actions";
import { NfseSettingsDialog } from "./nfse-settings-dialog";

export interface NfseInvoiceView {
  id: string;
  clientName: string;
  kind: NfseInvoiceKind;
  amount: string;
  status: NfseInvoiceStatus;
  nfseNumber: string | null;
  issuedAt: string | null;
  lastError: string | null;
  environment: number | null;
}

export interface NfseSettingsPanelView {
  providerCnpj: string;
  dpsSeries: string;
  template: NfseTemplate | null;
  serviceSeenAt: string | null;
  serviceEnvironment: number | null;
  certificateValidUntil: string | null;
  serviceError: string | null;
}

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"] as const;

const STATUS_LABELS: Record<NfseInvoiceStatus, string> = {
  queued: "Na fila",
  issued: "Emitida",
  failed: "Com erro",
  cancel_requested: "Cancelando",
  cancelled: "Cancelada",
};

const STATUS_CLASSES: Record<NfseInvoiceStatus, string> = {
  queued: "border-warning/40 bg-warning/10 text-warning",
  issued: "border-success/40 bg-success/10 text-success",
  failed: "border-destructive/50 bg-destructive/10 text-destructive",
  cancel_requested: "border-warning/40 bg-warning/10 text-warning",
  cancelled: "border-border text-muted-foreground",
};

const KIND_LABELS: Record<NfseInvoiceKind, string> = { monthly: "Mensal", additional_installment: "PA" };

function cents(value: number): string {
  return formatBRLCurrency((value / 100).toFixed(2));
}

function StatusChip({ status }: { status: NfseInvoiceStatus }) {
  const working = status === "queued" || status === "cancel_requested";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium", STATUS_CLASSES[status])}>
      {working ? <LoaderCircle className="size-3 animate-spin" aria-hidden /> : null}
      {STATUS_LABELS[status]}
    </span>
  );
}

function EmitDialog({ clanId, year, month, monthLabel, disabled, disabledReason }: { clanId: string; year: number; month: number; monthLabel: string; disabled: boolean; disabledReason: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [includeAdditional, setIncludeAdditional] = useState(false);
  const [preview, setPreview] = useState<NfseEmissionPreviewView | null>(null);
  const [loading, startLoading] = useTransition();
  const [sending, startSending] = useTransition();

  function load(nextInclude: boolean) {
    startLoading(async () => {
      const result = await previewNfseEmission({ clanId, year, month, includeAdditional: nextInclude });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setPreview(result.data ?? null);
    });
  }

  function emit() {
    if (!preview) return;
    startSending(async () => {
      const result = await emitNfseBatch({ clanId, year, month, includeAdditional, expectedCount: preview.items.length, expectedTotalCents: preview.totalCents });
      if (!result.ok) {
        toast.error(result.error);
        load(includeAdditional);
        return;
      }
      toast.success(`${result.data?.queued ?? preview.items.length} notas na fila. Elas saem em instantes.`);
      setOpen(false);
      router.refresh();
    });
  }

  const count = preview?.items.length ?? 0;
  return (
    <>
      <Button type="button" disabled={disabled} title={disabledReason ?? undefined} onClick={() => { setOpen(true); load(includeAdditional); }}>
        <Send aria-hidden /> Emitir notas de {monthLabel}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Notas de honorário · {monthLabel}</DialogTitle>
            <DialogDescription>Confira antes de emitir: nota emitida só se desfaz com cancelamento formal.</DialogDescription>
          </DialogHeader>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-primary" checked={includeAdditional} disabled={loading || sending} onChange={(event) => { setIncludeAdditional(event.target.checked); load(event.target.checked); }} />
            Incluir a PA (parcela adicional) de quem cobra
          </label>
          {loading && !preview ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" aria-hidden /> Montando a prévia…</p>
          ) : preview ? (
            <div className="grid min-w-0 grid-cols-1 gap-3">
              <div className="max-h-72 overflow-auto rounded-md border">
                <ul className="divide-y">
                  {preview.items.map((item) => (
                    <li key={`${item.controlPeriodId}-${item.kind}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span className="min-w-0 truncate">{item.clientName}{item.kind === "additional_installment" ? <span className="ml-2 text-xs text-muted-foreground">PA</span> : null}</span>
                      <span className="font-mono tabular-nums">{cents(item.amountCents)}</span>
                    </li>
                  ))}
                  {preview.items.length === 0 ? <li className="px-3 py-2 text-sm text-muted-foreground">Nenhuma nota a emitir.</li> : null}
                </ul>
              </div>
              {preview.excluded.length > 0 ? (
                <section className="grid gap-1">
                  <p className="hud-label">Ficam de fora ({preview.excluded.length})</p>
                  <ul className="grid gap-1 text-xs text-muted-foreground">
                    {preview.excluded.map((item) => (
                      <li key={`${item.controlPeriodId}-${item.kind}`}>{item.clientName}{item.kind === "additional_installment" ? " (PA)" : ""} — {NFSE_EXCLUSION_LABELS[item.reason]}</li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {preview.companiesWithoutFee > 0 ? (
                <p className="text-xs text-warning">{preview.companiesWithoutFee} empresas ativas ainda não têm honorário cadastrado e não entram.</p>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Voltar</Button>
            <Button type="button" disabled={!preview || count === 0 || loading || sending} onClick={emit}>
              {sending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Send aria-hidden />}
              Emitir {count} {count === 1 ? "nota" : "notas"} · <span className="font-mono tabular-nums">{cents(preview?.totalCents ?? 0)}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CancelDialog({ clanId, invoice, onClose }: { clanId: string; invoice: NfseInvoiceView; onClose: () => void }) {
  const router = useRouter();
  const [reason, setReason] = useState<NfseCancelReasonCode>(1);
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();
  const length = text.trim().length;
  function submit() {
    startTransition(async () => {
      const result = await cancelNfseInvoice({ clanId, invoiceId: invoice.id, reasonCode: reason, reasonText: text });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Cancelamento pedido. O Sistema Nacional responde em instantes.");
      onClose();
      router.refresh();
    });
  }
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Cancelar a nota {invoice.nfseNumber ?? ""}</DialogTitle>
          <DialogDescription>{invoice.clientName} · {formatBRLCurrency(invoice.amount)}. O cancelamento vai ao Sistema Nacional e não tem volta.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="nfse-cancel-reason">Motivo</Label>
          <Select value={String(reason)} onValueChange={(value) => setReason(Number(value) as NfseCancelReasonCode)}>
            <SelectTrigger id="nfse-cancel-reason"><SelectValue /></SelectTrigger>
            <SelectContent>
              {NFSE_CANCEL_REASON_CODES.map((code) => <SelectItem key={code} value={String(code)}>{NFSE_CANCEL_REASON_LABELS[code]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="nfse-cancel-text">Justificativa</Label>
          <Textarea id="nfse-cancel-text" rows={3} maxLength={NFSE_CANCEL_TEXT_MAX} value={text} onChange={(event) => setText(event.target.value)} />
          <span className={cn("text-xs", length < NFSE_CANCEL_TEXT_MIN ? "text-muted-foreground" : "text-success")}>{length}/{NFSE_CANCEL_TEXT_MAX} — mínimo {NFSE_CANCEL_TEXT_MIN}</span>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Voltar</Button>
          <Button type="button" variant="destructive" disabled={pending || length < NFSE_CANCEL_TEXT_MIN} onClick={submit}>
            {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <XCircle aria-hidden />} Cancelar a nota
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RetryButton({ clanId, invoiceId }: { clanId: string; invoiceId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => startTransition(async () => {
      const result = await retryNfseInvoice({ clanId, invoiceId });
      if (!result.ok) { toast.error(result.error); return; }
      router.refresh();
    })}>
      {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <RotateCcw aria-hidden />} Tentar de novo
    </Button>
  );
}

export function NfsePanel({ clanId, year, month, canManage, isAdmin, settings, invoices }: { clanId: string; year: number; month: number; canManage: boolean; isAdmin: boolean; settings: NfseSettingsPanelView | null; invoices: readonly NfseInvoiceView[] }) {
  const router = useRouter();
  const [cancelling, setCancelling] = useState<NfseInvoiceView | null>(null);
  const monthLabel = MONTHS[month - 1];
  const pendingWork = invoices.some((invoice) => invoice.status === "queued" || invoice.status === "cancel_requested");

  useEffect(() => {
    if (!pendingWork) return;
    const timer = setInterval(() => router.refresh(), 5_000);
    return () => clearInterval(timer);
  }, [pendingWork, router]);

  const health = nfseServiceHealth({
    configured: Boolean(settings?.template),
    serviceSeenAt: settings?.serviceSeenAt ? new Date(settings.serviceSeenAt) : null,
    serviceError: settings?.serviceError ?? null,
    certificateValidUntil: settings?.certificateValidUntil ? new Date(settings.certificateValidUntil) : null,
    now: new Date(),
  });
  const statusText = {
    unconfigured: "O modelo da nota ainda não foi configurado. Um admin preenche em \"Modelo da nota\".",
    offline: "O serviço fiscal não respondeu nos últimos minutos. Os pedidos esperam na fila até ele voltar.",
    error: `O serviço fiscal está com problema: ${settings?.serviceError ?? ""}`,
    ready: settings?.serviceEnvironment === 2 ? "Ambiente de TESTE (produção restrita): as notas não têm valor fiscal." : "Emissão no Sistema Nacional, com o certificado do escritório.",
  }[health.state];
  const issuedCount = invoices.filter((invoice) => invoice.status === "issued").length;
  const disabledReason = !canManage ? "Só integrantes do Fiscal e admins emitem notas." : health.state !== "ready" ? statusText : null;
  const pdfHref = `/api/nfse/pdfs?clanId=${clanId}&year=${year}&month=${month}`;

  return (
    <section className="panel-cut grid min-w-0 grid-cols-1 gap-4 p-4" aria-labelledby="nfse-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <h2 id="nfse-title">Notas de honorário</h2>
          <p className={cn("max-w-prose text-sm", health.state === "ready" ? "text-muted-foreground" : "text-warning")}>{statusText}</p>
          {health.certificateDaysLeft !== null && health.certificateDaysLeft <= NFSE_CERTIFICATE_WARNING_DAYS ? (
            <p className="text-sm text-warning">O certificado do escritório vence em {Math.max(0, health.certificateDaysLeft)} dias.</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {isAdmin ? <NfseSettingsDialog clanId={clanId} settings={settings} /> : null}
          {issuedCount > 0 && canManage ? (
            <Button asChild variant="outline"><a href={pdfHref}><Download aria-hidden /> Baixar PDFs ({issuedCount})</a></Button>
          ) : (
            <Button type="button" variant="outline" disabled><Download aria-hidden /> Baixar PDFs</Button>
          )}
          <EmitDialog clanId={clanId} year={year} month={month} monthLabel={monthLabel} disabled={disabledReason !== null} disabledReason={disabledReason} />
        </div>
      </div>
      {invoices.length > 0 ? (
        <div className="min-w-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Empresa</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Nº</TableHead>
                <TableHead><span className="sr-only">Ações</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell className="max-w-64">
                    <span className="block truncate">{invoice.clientName}</span>
                    {invoice.lastError ? <span className="block text-xs whitespace-normal text-destructive">{invoice.lastError}</span> : null}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{KIND_LABELS[invoice.kind]}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatBRLCurrency(invoice.amount)}</TableCell>
                  <TableCell><StatusChip status={invoice.status} /></TableCell>
                  <TableCell className="font-mono text-xs tabular-nums">
                    {invoice.nfseNumber ?? "—"}
                    {invoice.issuedAt ? <span className="block text-muted-foreground">{formatAppDate(invoice.issuedAt)}</span> : null}
                  </TableCell>
                  <TableCell className="text-right">
                    {canManage && invoice.status === "failed" ? <RetryButton clanId={clanId} invoiceId={invoice.id} /> : null}
                    {canManage && invoice.status === "issued" ? (
                      <span className="inline-flex gap-1">
                        <Button asChild variant="ghost" size="icon-sm" aria-label={`PDF da nota de ${invoice.clientName}`}>
                          <a href={`${pdfHref}&invoiceId=${invoice.id}`}><FileText aria-hidden /></a>
                        </Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => setCancelling(invoice)}><XCircle aria-hidden /> Cancelar</Button>
                      </span>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Nenhuma nota de {monthLabel} emitida pela Guilda ainda.</p>
      )}
      {cancelling ? <CancelDialog clanId={clanId} invoice={cancelling} onClose={() => setCancelling(null)} /> : null}
    </section>
  );
}
```

- [ ] **Passo 2: `nfse-settings-dialog.tsx`**

```tsx
"use client";

import { LoaderCircle, Settings2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { CnpjInput } from "@/components/ui/cnpj-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { NfseTemplate } from "@/lib/nfse/template";

import { saveNfseSettings } from "./nfse-actions";
import type { NfseSettingsPanelView } from "./nfse-panel";

const NONE = "none";

const OPTIONS = {
  opSimpNac: [["1", "Não optante"], ["2", "MEI"], ["3", "Optante ME/EPP"]],
  regApTribSN: [[NONE, "Não informar"], ["1", "Federais e ISS pelo Simples"], ["2", "Federais pelo Simples, ISS por fora"], ["3", "Federais e ISS por fora"]],
  regEspTrib: [["0", "Nenhum"], ["1", "Ato cooperado"], ["2", "Estimativa"], ["3", "Microempresa municipal"], ["4", "Notário ou registrador"], ["5", "Profissional autônomo"], ["6", "Sociedade de profissionais"], ["9", "Outros"]],
  taxation: [["1", "Operação tributável"], ["2", "Imunidade"], ["3", "Exportação de serviço"], ["4", "Não incidência"]],
  withholding: [["1", "Não retido"], ["2", "Retido pelo tomador"], ["3", "Retido pelo intermediário"]],
  totalTaxes: [["none", "Não informar valor de tributos"], ["simples", "Percentual do Simples Nacional"]],
} as const;

const DEFAULTS = {
  monthly: "Honorários contábeis referentes à competência {competencia}.",
  additionalInstallment: "Parcela adicional de honorários contábeis de {ano}.",
};

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

function Choice({ id, value, options, onChange }: { id: string; value: string; options: readonly (readonly [string, string])[]; onChange: (value: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id}><SelectValue /></SelectTrigger>
      <SelectContent>{options.map(([optionValue, label]) => <SelectItem key={optionValue} value={optionValue}>{label}</SelectItem>)}</SelectContent>
    </Select>
  );
}

/** Modelo da nota do escritório (admin). Na etapa 3 ele nasce do XML de uma nota real. */
export function NfseSettingsDialog({ clanId, settings }: { clanId: string; settings: NfseSettingsPanelView | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const t: Partial<NfseTemplate> = settings?.template ?? {};
  // Tudo string no formulário; o Zod da action valida o modelo de verdade.
  const [form, setForm] = useState<Record<string, string>>({
    providerCnpj: settings?.providerCnpj ?? "",
    dpsSeries: settings?.dpsSeries ?? "1",
    cityCode: t.cityCode ?? "",
    municipalRegistration: t.municipalRegistration ?? "",
    opSimpNac: t.taxRegime?.opSimpNac ?? "3",
    regApTribSN: t.taxRegime?.regApTribSN ?? NONE,
    regEspTrib: t.taxRegime?.regEspTrib ?? "0",
    nationalTaxCode: t.service?.nationalTaxCode ?? "171901",
    municipalTaxCode: t.service?.municipalTaxCode ?? "",
    nbsCode: t.service?.nbsCode ?? "",
    taxation: t.issqn?.taxation ?? "1",
    withholding: t.issqn?.withholding ?? "1",
    rate: t.issqn?.rate ?? "",
    totalTaxesKind: t.totalTaxes?.kind ?? "none",
    totalTaxesPercent: t.totalTaxes?.kind === "simples" ? t.totalTaxes.percent : "",
    monthly: t.descriptions?.monthly ?? DEFAULTS.monthly,
    additionalInstallment: t.descriptions?.additionalInstallment ?? DEFAULTS.additionalInstallment,
  });
  const set = (key: string) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  const optional = (value: string) => (value.trim() ? value.trim() : undefined);

  function save() {
    const template = {
      cityCode: form.cityCode.trim(),
      municipalRegistration: optional(form.municipalRegistration),
      taxRegime: {
        opSimpNac: form.opSimpNac,
        regApTribSN: form.regApTribSN === NONE ? undefined : form.regApTribSN,
        regEspTrib: form.regEspTrib,
      },
      service: { nationalTaxCode: form.nationalTaxCode.trim(), municipalTaxCode: optional(form.municipalTaxCode), nbsCode: optional(form.nbsCode) },
      issqn: { taxation: form.taxation, withholding: form.withholding, rate: optional(form.rate) },
      totalTaxes: form.totalTaxesKind === "simples" ? { kind: "simples", percent: form.totalTaxesPercent.trim() } : { kind: "none" },
      descriptions: { monthly: form.monthly, additionalInstallment: form.additionalInstallment },
    } as NfseTemplate;
    startTransition(async () => {
      const result = await saveNfseSettings({ clanId, providerCnpj: form.providerCnpj, dpsSeries: form.dpsSeries.trim(), template });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Modelo da nota salvo.");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline"><Settings2 aria-hidden /> Modelo da nota</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Modelo da nota de honorário</DialogTitle>
          <DialogDescription>O que não muda de uma nota para outra. Copie de uma nota já emitida no Portal Nacional.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id="nfse-cnpj" label="CNPJ do escritório"><CnpjInput id="nfse-cnpj" value={form.providerCnpj} onValueChange={set("providerCnpj")} /></Field>
          <Field id="nfse-series" label="Série da DPS" hint="1 a 49999. O Emissor Web usa 70000 a 79999."><Input id="nfse-series" inputMode="numeric" value={form.dpsSeries} onChange={(event) => set("dpsSeries")(event.target.value)} /></Field>
          <Field id="nfse-city" label="Município (código IBGE)" hint="7 dígitos."><Input id="nfse-city" inputMode="numeric" value={form.cityCode} onChange={(event) => set("cityCode")(event.target.value)} /></Field>
          <Field id="nfse-im" label="Inscrição municipal (opcional)"><Input id="nfse-im" value={form.municipalRegistration} onChange={(event) => set("municipalRegistration")(event.target.value)} /></Field>
          <Field id="nfse-simples" label="Situação no Simples"><Choice id="nfse-simples" value={form.opSimpNac} options={OPTIONS.opSimpNac} onChange={set("opSimpNac")} /></Field>
          <Field id="nfse-apuracao" label="Regime de apuração do Simples"><Choice id="nfse-apuracao" value={form.regApTribSN} options={OPTIONS.regApTribSN} onChange={set("regApTribSN")} /></Field>
          <Field id="nfse-especial" label="Regime especial"><Choice id="nfse-especial" value={form.regEspTrib} options={OPTIONS.regEspTrib} onChange={set("regEspTrib")} /></Field>
          <Field id="nfse-ctrib" label="Código de tributação nacional" hint="6 dígitos (item, subitem, desdobro)."><Input id="nfse-ctrib" inputMode="numeric" value={form.nationalTaxCode} onChange={(event) => set("nationalTaxCode")(event.target.value)} /></Field>
          <Field id="nfse-cmun" label="Código municipal (opcional)"><Input id="nfse-cmun" inputMode="numeric" value={form.municipalTaxCode} onChange={(event) => set("municipalTaxCode")(event.target.value)} /></Field>
          <Field id="nfse-nbs" label="Código NBS (opcional)"><Input id="nfse-nbs" inputMode="numeric" value={form.nbsCode} onChange={(event) => set("nbsCode")(event.target.value)} /></Field>
          <Field id="nfse-iss" label="Tributação do ISS"><Choice id="nfse-iss" value={form.taxation} options={OPTIONS.taxation} onChange={set("taxation")} /></Field>
          <Field id="nfse-ret" label="Retenção do ISS"><Choice id="nfse-ret" value={form.withholding} options={OPTIONS.withholding} onChange={set("withholding")} /></Field>
          <Field id="nfse-aliq" label="Alíquota do ISS (opcional)" hint="Formato 2.00."><Input id="nfse-aliq" inputMode="decimal" value={form.rate} onChange={(event) => set("rate")(event.target.value)} /></Field>
          <Field id="nfse-tot" label="Total de tributos"><Choice id="nfse-tot" value={form.totalTaxesKind} options={OPTIONS.totalTaxes} onChange={set("totalTaxesKind")} /></Field>
          {form.totalTaxesKind === "simples" ? (
            <Field id="nfse-totpct" label="Percentual do Simples" hint="Formato 6.00."><Input id="nfse-totpct" inputMode="decimal" value={form.totalTaxesPercent} onChange={(event) => set("totalTaxesPercent")(event.target.value)} /></Field>
          ) : null}
          <div className="sm:col-span-2"><Field id="nfse-desc" label="Descrição da nota mensal" hint="{competencia} vira MM/AAAA."><Textarea id="nfse-desc" rows={2} value={form.monthly} onChange={(event) => set("monthly")(event.target.value)} /></Field></div>
          <div className="sm:col-span-2"><Field id="nfse-desc-pa" label="Descrição da PA" hint="{ano} vira AAAA."><Textarea id="nfse-desc-pa" rows={2} value={form.additionalInstallment} onChange={(event) => set("additionalInstallment")(event.target.value)} /></Field></div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>Voltar</Button>
          <Button type="button" disabled={pending} onClick={save}>{pending ? <LoaderCircle className="animate-spin" aria-hidden /> : null} Salvar modelo</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Passo 3: ligar na aba Honorários**

Em `office-fee-tab.tsx`:

1. Acrescentar a prop `isAdmin: boolean` à assinatura de `OfficeFeeTab`.
2. Importar:

```ts
import { loadNfseMonth, loadNfseSettings } from "@/lib/nfse/requests";

import { NfsePanel } from "./nfse-panel";
```

3. No ramo de controle, dentro do mesmo `withOrgTx` que já busca `rows` e
   `events`, buscar também e devolver `nfseSettings` e `nfseInvoices`:

```ts
    const nfseSettings = await loadNfseSettings(tx, orgId);
    const nfseInvoices = await loadNfseMonth(tx, { orgId, year: period.year, month: period.month });
    return { rows, events, nfseSettings, nfseInvoices };
```

(e desestruturar `const { rows, events, nfseSettings, nfseInvoices } = await withOrgTx(...)`).

4. Trocar o `return <OfficeFeeControlBoard ... />` final por:

```tsx
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <NfsePanel
        clanId={clanId}
        year={period.year}
        month={period.month}
        canManage={canManage}
        isAdmin={isAdmin}
        settings={
          nfseSettings
            ? {
                providerCnpj: nfseSettings.providerCnpj,
                dpsSeries: nfseSettings.dpsSeries,
                template: nfseSettings.template,
                serviceSeenAt: nfseSettings.serviceSeenAt?.toISOString() ?? null,
                serviceEnvironment: nfseSettings.serviceEnvironment,
                certificateValidUntil: nfseSettings.certificateValidUntil?.toISOString() ?? null,
                serviceError: nfseSettings.serviceError,
              }
            : null
        }
        invoices={nfseInvoices.map((invoice) => ({ ...invoice, issuedAt: invoice.issuedAt?.toISOString() ?? null }))}
      />
      <OfficeFeeControlBoard clanId={clanId} year={period.year} month={period.month} canManage={canManage} members={memberships} rows={views} />
    </div>
  );
```

Em `page.tsx`, no `<OfficeFeeTab ...>`, acrescentar `isAdmin={isAdminRole(role)}`
(`isAdminRole` e `role` já existem no arquivo).

- [ ] **Passo 4: conferir**

Rodar: `npx tsc --noEmit -p . && npx eslint "src/app/(app)/clans/[id]" && npx vitest run`
Esperado: sem erros.

- [ ] **Passo 5: conferência renderizada medida**

Tela nova não sobe sem conferência renderizada (release #34). Sem sessão na
homologação, renderizar `NfsePanel` num teste descartável do Vitest
(`renderToStaticMarkup`, `next/navigation` e as actions mockadas) com o CSS de
`.next/static/chunks/` depois de um `npm run build`, servir por
`python -m http.server` via `.claude/launch.json` e MEDIR por script, em 375 e
1100 px: nenhum filho do painel mais largo que o painel; a tabela rola
dentro de `overflow-x-auto`, não estica a página. Apagar o teste descartável
ao terminar. Receita no Cerebro: "Grade sem colunas explícitas cresce até o
texto truncado e o chanfro esconde o vazamento".

- [ ] **Passo 6: commit**

```bash
git add "src/app/(app)/clans/[id]/nfse-panel.tsx" "src/app/(app)/clans/[id]/nfse-settings-dialog.tsx" "src/app/(app)/clans/[id]/office-fee-tab.tsx" "src/app/(app)/clans/[id]/page.tsx"
git commit -m "feat: painel de notas de honorario na aba Honorarios"
```

---

### Tarefa 18: Documentação, portões e entrega na develop

**Arquivos:**
- Modificar: `docs/environments.md`, `CLAUDE.md`, `.env.example`

- [ ] **Passo 1: `docs/environments.md`** — nova seção ao fim:

```markdown
## Serviço fiscal (notas de honorário)

Segundo serviço por ambiente, **mesma imagem** do app, com
`GUILDA_SERVICE=fiscal`: o `start-production.mjs` sobe só
`scripts/fiscal-service.ts` (sem migrations, sem Next, sem Telegram). É o
único processo com o certificado A1 do escritório.

- **Sem domínio público.** O app fala com ele pela rede interna do Easypanel
  (`http://<projeto>_<serviço>:4100`). Ele só responde `GET /health` e
  `POST /danfse.zip` com o token.
- Homologação usa `NFSE_AMBIENTE` vazio (produção restrita). Só o serviço da
  produção recebe `NFSE_AMBIENTE=producao`.

| Variável | Serviço | Observação |
| --- | --- | --- |
| `GUILDA_SERVICE` | fiscal | `fiscal` |
| `DATABASE_URL` | fiscal | `guilda_app`, o mesmo banco do app do ambiente |
| `NFSE_CERT_PFX_BASE64` | fiscal | o `.pfx` A1 em base64 (`base64 -w0 certificado.pfx`) |
| `NFSE_CERT_PASSWORD` | fiscal | senha do `.pfx` |
| `NFSE_AMBIENTE` | fiscal | vazio = produção restrita; `producao` só na produção |
| `FISCAL_SERVICE_TOKEN` | fiscal **e** app | 32+ caracteres aleatórios, iguais nos dois |
| `FISCAL_SERVICE_URL` | app | endereço interno do serviço fiscal |

O certificado nunca vai para o serviço do app, para o repositório nem para o
Cerebro.
```

- [ ] **Passo 2: `CLAUDE.md`** — nova seção depois de "Desafio do dado nos Fechamentos":

```markdown
## Notas de honorário pela API nacional (decisão de 2026-10-10)

Desenho em `docs/superpowers/specs/2026-10-10-notas-de-honorario-design.md`.

- A aba Honorários emite, cancela e baixa os PDFs das NFS-e de honorário pela
  API do Sistema Nacional. **O certificado A1 mora só no serviço fiscal**
  (outro serviço do Easypanel, `GUILDA_SERVICE=fiscal`); o app nunca o vê. Não
  levar o certificado para o app "para simplificar".
- App e serviço conversam pela fila no banco (`nfse_invoices`) e, para PDFs,
  pela rede interna com `FISCAL_SERVICE_TOKEN`. **PDF e XML não são
  guardados**, a pedido do Bruno: só chave e número.
- Série de DPS própria (1–49999); o Emissor Web usa 70000–79999. O número da
  DPS é reservado na fila e nunca muda; antes de emitir, o serviço consulta a
  DPS — é isso que impede nota duplicada.
- Emitida marca a etapa "Nota" do controle (PA marca "Parcela adicional") pela
  `applyOfficeFeeStepChange`; cancelada reabre. Emitir/cancelar: Fiscal e
  admins; modelo da nota: só admin.
- Homologação só fala com a produção restrita (`NFSE_AMBIENTE` vazio).
```

- [ ] **Passo 3: `.env.example`** — acrescentar, comentado:

```bash
# Servico fiscal (notas de honorario). So no servico com GUILDA_SERVICE=fiscal:
# NFSE_CERT_PFX_BASE64=
# NFSE_CERT_PASSWORD=
# NFSE_AMBIENTE=            # vazio = producao restrita
# No app e no servico fiscal (o mesmo valor, 32+ caracteres):
# FISCAL_SERVICE_TOKEN=
# So no app:
# FISCAL_SERVICE_URL=http://localhost:4100
```

- [ ] **Passo 4: portões**

```bash
npx vitest run
npx tsc --noEmit -p .
npx eslint
NODE_OPTIONS=--max-old-space-size=6144 npm run build
```

Esperado: tudo verde. Build em OneDrive pode cair com 134 depois de compilar;
rodar de novo.

- [ ] **Passo 5: commit e push**

```bash
git add docs/environments.md CLAUDE.md .env.example
git commit -m "docs: servico fiscal e notas de honorario"
git push origin develop
```

---

## Depois deste plano (etapa 2, com o Bruno)

1. Criar no Easypanel o serviço `guilda-fiscal` da homologação (mesmo
   repositório e Dockerfile, branch `develop`, sem domínio), com as variáveis
   da tabela de `docs/environments.md`. Acrescentar `FISCAL_SERVICE_URL` e
   `FISCAL_SERVICE_TOKEN` ao app da homologação.
2. Na homologação, um admin preenche o "Modelo da nota" com dados de teste (o
   CNPJ tem de ser o do certificado). O painel deve mostrar "Ambiente de
   TESTE".
3. Abrir o controle do mês, emitir uma nota para uma empresa fictícia, baixar
   o PDF e cancelar. Anotar as respostas reais do Sistema Nacional e ajustar o
   parser se o formato divergir.
```
