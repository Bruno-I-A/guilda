import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ member: vi.fn(), tx: vi.fn(), fiscal: vi.fn(), load: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/db/org-tx", () => ({ withOrgTx: mocks.tx }));
vi.mock("@/lib/action-context", () => ({ requireMemberContext: mocks.member }));
vi.mock("@/lib/office-fees/fiscal-clan", () => ({ requireFiscalClan: mocks.fiscal }));
vi.mock("@/lib/nfse/xml-requests", () => ({ loadXmlArchiveInput: mocks.load }));

import { GET } from "./route";

const url = "http://localhost/api/nfse/xml?clanId=00000000-0000-4000-8000-000000000001&year=2026&month=9";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.tx.mockImplementation((_org, run) => run({}));
  mocks.member.mockResolvedValue({ ok: true, orgId: "org", userId: "u1", role: "owner" });
  mocks.fiscal.mockResolvedValue({ facts: { role: "owner" } });
  mocks.load.mockResolvedValue({ companies: [], missing: [] });
});

test("pedido invalido falha antes da sessao e do banco", async () => {
  expect((await GET(new Request(url.replace("month=9", "month=13")))).status).toBe(400);
  expect(mocks.member).not.toHaveBeenCalled();
  expect(mocks.tx).not.toHaveBeenCalled();
});
test("sem sessao nao acessa o banco", async () => {
  mocks.member.mockResolvedValue({ ok: false, error: "Entre na Guilda." });
  expect((await GET(new Request(url))).status).toBe(401);
  expect(mocks.tx).not.toHaveBeenCalled();
});
test("cla fora do Fiscal ou sem acesso nao carrega XML", async () => {
  mocks.fiscal.mockResolvedValue(null);
  expect((await GET(new Request(url))).status).toBe(403);
  expect(mocks.load).not.toHaveBeenCalled();
});
test("XML avulso tem nome seguro e nao fica em cache", async () => {
  mocks.load.mockResolvedValue({ companies: [{ folder: "padaria-33000167", notes: [{ fileName: "000107.xml", xml: "<NFSe/>", cancellation: null }] }], missing: [] });
  const response = await GET(new Request(url + "&clientId=00000000-0000-4000-8000-000000000002"));
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("application/xml");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("Content-Disposition")).toContain("padaria-33000167-000107.xml");
  expect(await response.text()).toBe("<NFSe/>");
});
