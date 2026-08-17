import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db/org-tx", () => ({ withOrgTx: vi.fn() }));
vi.mock("@/db/schema", () => ({}));
vi.mock("@/lib/ai/informative", () => ({ extractInformative: vi.fn() }));
vi.mock("@/lib/org", () => ({
  listActiveClans: vi.fn(),
  listOrgMembers: vi.fn(),
}));
vi.mock("@/lib/tasks/create", () => ({ createTaskRecord: vi.fn() }));

import type { InformativeDraftPayload } from "@/lib/ai/informative-schema";

import { draftPreview } from "./ai-informative";

const CLAN_ID = "123e4567-e89b-12d3-a456-426614174000";

const baseDraft = {
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
  tasks: [],
  ignoredNotes: [],
  observations: [],
  warnings: [],
  unresolvedAssignees: [],
} satisfies InformativeDraftPayload;

const taskCore = {
  category: "general",
  title: "Conferir obrigações",
  description: "Conferir as obrigações do mês.",
  priority: 2,
  difficulty: 2,
  dueDate: null,
  closingYear: null,
  sourceSection: "Fiscal, conferir obrigações",
  sector: "Fiscal",
} as const;

describe("draftPreview", () => {
  it("explicita que uma missão do clã ainda não possui responsável", () => {
    const preview = draftPreview({
      ...baseDraft,
      tasks: [
        {
          ...taskCore,
          assignmentType: "clan",
          assigneeId: null,
          assigneeName: null,
          clanId: CLAN_ID,
          clanName: "Fiscal",
          suggestions: [],
        },
      ],
    });
    expect(preview).toContain("Clã Fiscal · sem responsável — Conferir obrigações");
  });

  it("mostra o Att. do informativo como sugestão, não como atribuição", () => {
    const preview = draftPreview({
      ...baseDraft,
      tasks: [
        {
          ...taskCore,
          assignmentType: "clan",
          assigneeId: null,
          assigneeName: null,
          clanId: CLAN_ID,
          clanName: "Fiscal",
          suggestions: [
            { rawName: "Camila", userId: "user-1", name: "Camila Schütz" },
            { rawName: "Eduarda", userId: null, name: null },
          ],
        },
      ],
    });
    expect(preview).toContain("sugestão do informativo: Camila Schütz, Eduarda");
    expect(preview).toContain("sem responsável");
  });

  it("avisa que a missão sem destino precisa de decisão no painel", () => {
    const preview = draftPreview({
      ...baseDraft,
      tasks: [
        {
          ...taskCore,
          sector: null,
          assignmentType: "pending",
          assigneeId: null,
          assigneeName: null,
          clanId: null,
          clanName: null,
          reason: "Sem setor de clã e sem pessoa indicada. Escolha o destino.",
          suggestions: [],
        },
      ],
    });
    expect(preview).toContain("Sem destino · decida no painel");
    expect(preview).toContain("1 missão(ões) sem clã e sem pessoa");
  });

  it("informa que as observações vão para o mural, não viram missão", () => {
    const preview = draftPreview({
      ...baseDraft,
      observations: ["Camila responde por todos os informativos da empresa."],
    });
    expect(preview).toContain("irão para o mural");
  });
});
