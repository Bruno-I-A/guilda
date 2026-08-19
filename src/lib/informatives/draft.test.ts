import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db/org-tx", () => ({ withOrgTx: vi.fn() }));
vi.mock("@/db/schema", () => ({}));
vi.mock("@/lib/ai/informative", () => ({ extractInformative: vi.fn() }));
vi.mock("@/lib/org", () => ({
  listActiveClans: vi.fn(),
  listOrgMembers: vi.fn(),
}));

import type { InformativeDraftPayload } from "@/lib/ai/informative-schema";

import { draftIsBlocked } from "./draft";

const CLAN_ID = "123e4567-e89b-12d3-a456-426614174000";

function payload(
  overrides: {
    tasks?: InformativeDraftPayload["tasks"];
    createClient?: boolean;
    unresolvedAssignees?: string[];
  } = {},
): InformativeDraftPayload {
  return {
    kind: "new_client",
    sourceFormat: "informative",
    company: {
      systemCode: null,
      legalName: "EMPRESA TESTE LTDA",
      cnpj: null,
      taxRegime: "simples",
      city: null,
      contact: null,
      summary: "Solicitação de teste.",
      normalizedCnpj: "11222333000181",
      clientId: null,
      createClient: overrides.createClient ?? false,
      cnaeCode: null,
      cnaeDescription: null,
      secondaryCnaes: null,
      openedAt: null,
      pendingFiscalNote: null,
      suggestedFiscalOwnerId: null,
    },
    tasks: overrides.tasks ?? [],
    commitments: [],
    ignoredNotes: [],
    observations: [],
    warnings: [],
    unresolvedAssignees: overrides.unresolvedAssignees ?? [],
  } satisfies InformativeDraftPayload;
}

const clanTask: InformativeDraftPayload["tasks"][number] = {
  assignmentType: "clan",
  assigneeId: null,
  assigneeName: null,
  clanId: CLAN_ID,
  clanName: "Fiscal",
  suggestions: [],
  category: "general",
  title: "Parametrizar o Simples",
  description: "Parametrizar o Simples Nacional.",
  priority: 2,
  difficulty: 2,
  dueDate: null,
  closingYear: null,
  sourceSection: "FISCAL - parametrizar o Simples",
  sector: "FISCAL",
};

const pendingTask: InformativeDraftPayload["tasks"][number] = {
  ...clanTask,
  assignmentType: "pending",
  clanId: null,
  clanName: null,
  reason: "Sem setor reconhecido.",
};

describe("draftIsBlocked", () => {
  test("prévia com missão de clã é confirmável", () => {
    expect(draftIsBlocked(payload({ tasks: [clanTask] }))).toBe(false);
  });

  // A regressão que chegou ao usuário: no cadastro de cliente novo todas as
  // linhas podem ser combinado do Fiscal ou "sem particularidades", e aí zero
  // missão é o resultado CERTO — mas a confirmação ainda precisa criar a
  // empresa e enfileirá-la na carteira.
  test("zero missão NÃO bloqueia quando há empresa nova a cadastrar", () => {
    expect(draftIsBlocked(payload({ tasks: [], createClient: true }))).toBe(false);
  });

  test("zero missão bloqueia quando não há empresa nova — nada a fazer", () => {
    expect(draftIsBlocked(payload({ tasks: [], createClient: false }))).toBe(true);
  });

  test("nome não reconhecido bloqueia mesmo com empresa nova", () => {
    expect(
      draftIsBlocked(
        payload({
          tasks: [clanTask],
          createClient: true,
          unresolvedAssignees: ["Fulano"],
        }),
      ),
    ).toBe(true);
  });

  test("missão sem destino bloqueia mesmo com empresa nova", () => {
    expect(
      draftIsBlocked(payload({ tasks: [pendingTask], createClient: true })),
    ).toBe(true);
  });
});
