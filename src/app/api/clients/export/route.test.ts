import { readSheet } from "read-excel-file/node";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ member: vi.fn(), tx: vi.fn(), rows: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/db/org-tx", () => ({ withOrgTx: mocks.tx }));
vi.mock("@/lib/action-context", () => ({ requireMemberContext: mocks.member }));

import { GET } from "./route";

/** Encadeamento do Drizzle que devolve as linhas no `orderBy` final. */
function fakeTx() {
  const chain = {
    select: () => chain,
    from: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    orderBy: () => mocks.rows(),
  };
  return chain;
}

const url = "http://localhost/api/clients/export";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.tx.mockImplementation((_org, run) => run(fakeTx()));
  mocks.member.mockResolvedValue({ ok: true, orgId: "org", userId: "u1", role: "owner" });
  mocks.rows.mockResolvedValue([
    {
      client: {
        name: "Padaria Aurora Ltda",
        tradeName: null,
        cnpj: "84009016100028",
        taxRegime: "simples",
        active: true,
        cadastralSituation: null,
        openedAt: null,
        legalNature: null,
        companySize: null,
        shareCapital: null,
        headquartersType: null,
        cnaeCode: null,
        cnaeDescription: null,
        secondaryCnaes: [],
        address: null,
        operationalEmail: null,
        operationalPhone: null,
        revenueEmail: null,
        revenuePhones: [],
        qsa: [],
        dominioCode: null,
        createdAt: new Date("2026-09-01T15:00:00Z"),
      },
      fiscalOwnerName: "Catiele",
    },
  ]);
});

test("filtro inválido falha antes da sessão e do banco", async () => {
  expect((await GET(new Request(`${url}?regime=xpto`))).status).toBe(400);
  expect((await GET(new Request(`${url}?regime=mei&regime=xpto`))).status).toBe(400);
  expect(mocks.member).not.toHaveBeenCalled();
  expect(mocks.tx).not.toHaveBeenCalled();
});

test("aceita vários regimes de uma vez", async () => {
  const response = await GET(new Request(`${url}?regime=mei&regime=simples&regime=presumido`));
  expect(response.status).toBe(200);
  expect(mocks.tx).toHaveBeenCalledTimes(1);
});

test("sem sessão não acessa o banco", async () => {
  mocks.member.mockResolvedValue({ ok: false, error: "Sessão expirada." });
  expect((await GET(new Request(url))).status).toBe(401);
  expect(mocks.tx).not.toHaveBeenCalled();
});

test("membro comum não baixa a base de clientes", async () => {
  mocks.member.mockResolvedValue({ ok: true, orgId: "org", userId: "u2", role: "member" });
  expect((await GET(new Request(url))).status).toBe(403);
  expect(mocks.tx).not.toHaveBeenCalled();
});

test("admin baixa um .xlsx de verdade, sem cache, na organização da sessão", async () => {
  mocks.member.mockResolvedValue({ ok: true, orgId: "org", userId: "u3", role: "admin" });
  const response = await GET(new Request(`${url}?regime=simples&inativas=1`));
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toContain("spreadsheetml.sheet");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("Content-Disposition")).toMatch(/empresas-guilda-\d{4}-\d{2}-\d{2}\.xlsx/);
  expect(mocks.tx).toHaveBeenCalledWith("org", expect.any(Function));

  const rows = await readSheet(Buffer.from(await response.arrayBuffer()));
  expect(rows[1][0]).toBe("Padaria Aurora Ltda");
  expect(rows[1]).toContain("Catiele");
});
