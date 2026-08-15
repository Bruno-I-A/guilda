import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db/org-tx", () => ({ withOrgTx: vi.fn() }));
vi.mock("@/db/schema", () => ({}));
vi.mock("@/lib/ai/informative", () => ({
  extractInformative: vi.fn(),
  resolveInformativeClan: vi.fn(),
}));
vi.mock("@/lib/org", () => ({
  listActiveClans: vi.fn(),
  listOrgMembers: vi.fn(),
}));
vi.mock("@/lib/tasks/create", () => ({ createTaskRecord: vi.fn() }));

import type { InformativeDraftPayload } from "@/lib/ai/informative-schema";

import { draftPreview } from "./ai-informative";

const clanDraft = {
  kind: "general_task",
  sourceFormat: "business_mission",
  company: {
    systemCode: null,
    legalName: null,
    cnpj: null,
    taxRegime: null,
    city: null,
    contact: null,
    summary: "Solicitação geral.",
    normalizedCnpj: null,
    clientId: null,
    createClient: false,
  },
  tasks: [
    {
      assignmentType: "clan",
      category: "general",
      title: "Conferir obrigações",
      description: "Conferir as obrigações do mês.",
      assigneeId: null,
      assigneeName: null,
      clanId: "123e4567-e89b-12d3-a456-426614174000",
      clanName: "Fiscal",
      priority: 2,
      difficulty: 2,
      dueDate: null,
      closingYear: null,
      sourceSection: "Fiscal, conferir obrigações",
    },
  ],
  ignoredNotes: [],
  warnings: [],
  unresolvedAssignees: [],
} satisfies InformativeDraftPayload;

describe("draftPreview", () => {
  it("explicita que uma missão do clã ainda não possui responsável", () => {
    expect(draftPreview(clanDraft)).toContain(
      "Clã Fiscal · sem responsável — Conferir obrigações",
    );
  });
});
