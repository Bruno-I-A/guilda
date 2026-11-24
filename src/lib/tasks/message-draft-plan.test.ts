import { describe, expect, it } from "vitest";

import type { InformativeDraftPayload } from "@/lib/ai/informative-schema";

import { messageDraftPreview, needsInformative, parseMessageMissionPlan, planFromInformative } from "./message-draft-plan";

const CLAN = "123e4567-e89b-12d3-a456-426614174000";

const base = {
  kind: "general_task",
  sourceFormat: "business_mission",
  freeNotice: null,
  company: {
    systemCode: null, legalName: null, cnpj: null, taxRegime: null, city: null, contact: null, summary: "Pedido.",
    normalizedCnpj: null, clientId: null, createClient: false, cnaeCode: null, cnaeDescription: null, secondaryCnaes: null,
    openedAt: null, pendingFiscalNote: null, suggestedFiscalOwnerId: null,
  },
  tasks: [],
  commitments: [],
  ignoredNotes: [],
  observations: [],
  warnings: [],
  unresolvedAssignees: [],
} satisfies InformativeDraftPayload;

const core = { category: "general", description: null, priority: 2, difficulty: 2, closingYear: null, sourceSection: "", sector: null, suggestions: [] } as const;

describe("missão avulsa por mensagem", () => {
  it("vira missão para a pessoa e para o clã, com a empresa cadastrada", () => {
    const result = planFromInformative({
      ...base,
      company: { ...base.company, legalName: "ACME Ltda", clientId: "client-1" },
      tasks: [
        { ...core, title: "Conferir a folha", dueDate: "2026-11-27", assignmentType: "individual", assigneeId: "ana", assigneeName: "Ana Souza", clanId: CLAN, clanName: "RH" },
        { ...core, title: "Revisar o DAS", dueDate: null, assignmentType: "clan", assigneeId: null, assigneeName: null, clanId: CLAN, clanName: "Fiscal" },
      ],
    } as unknown as InformativeDraftPayload);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.clientId).toBe("client-1");
    expect(result.plan.missions.map((m) => m.assignment)).toEqual([
      { type: "individual", userId: "ana", name: "Ana Souza" },
      { type: "clan", clanId: CLAN, name: "Fiscal" },
    ]);
    const preview = messageDraftPreview(result.plan, result.notes);
    expect(preview).toContain("Prévia das 2 missões");
    expect(preview).toContain("Empresa: ACME Ltda");
    expect(preview).toContain("1. Ana Souza: Conferir a folha");
    expect(preview).toContain("prazo 27/11/2026 · 50 XP");
    expect(preview).toContain("Clã Fiscal (sem responsável): Revisar o DAS");
    expect(parseMessageMissionPlan(JSON.parse(JSON.stringify(result.plan)))).not.toBeNull();
  });

  it("empresa nova não é criada por mensagem: a missão sai sem empresa e a prévia avisa", () => {
    const result = planFromInformative({
      ...base,
      company: { ...base.company, legalName: "Nova Ltda", createClient: true },
      tasks: [{ ...core, title: "Abrir cadastro", dueDate: null, assignmentType: "individual", assigneeId: "ana", assigneeName: "Ana", clanId: CLAN, clanName: "RH" }],
    } as unknown as InformativeDraftPayload);
    expect(result.ok && result.plan.clientId).toBeNull();
    expect(result.ok && result.notes[0]).toContain("Nova Ltda não está cadastrada");
  });

  it("recusa quem não foi achado, destino incerto, mensagem sem tarefa e excesso", () => {
    expect(planFromInformative({ ...base, unresolvedAssignees: ["Zé"] } as unknown as InformativeDraftPayload)).toMatchObject({ ok: false, message: expect.stringContaining("Zé") });
    expect(planFromInformative({
      ...base,
      tasks: [{ ...core, title: "Algo", dueDate: null, assignmentType: "pending", assigneeId: null, assigneeName: null, clanId: null, clanName: null, reason: "x" }],
    } as unknown as InformativeDraftPayload)).toMatchObject({ ok: false, message: expect.stringContaining("para quem") });
    expect(planFromInformative(base as unknown as InformativeDraftPayload)).toMatchObject({ ok: false });
    const many = Array.from({ length: 11 }, (_, i) => ({ ...core, title: `T${i}`, dueDate: null, assignmentType: "clan", assigneeId: null, assigneeName: null, clanId: CLAN, clanName: "RH" }));
    expect(planFromInformative({ ...base, tasks: many } as unknown as InformativeDraftPayload)).toMatchObject({ ok: false, message: expect.stringContaining("até 10") });
  });

  it("só empresa, Mural, distribuição e fechamento precisam do Informativo", () => {
    const task = { ...core, title: "Comprar chopp", dueDate: null, assignmentType: "individual", assigneeId: "ana", assigneeName: "Ana", clanId: CLAN, clanName: "RH" };
    const plain = { ...base, tasks: [task] } as unknown as InformativeDraftPayload;
    expect(needsInformative(plain)).toBe(false);
    expect(needsInformative({ ...plain, kind: "new_client" } as InformativeDraftPayload)).toBe(true);
    expect(needsInformative({ ...plain, kind: "client_closure" } as InformativeDraftPayload)).toBe(true);
    expect(needsInformative({ ...plain, freeNotice: { title: "Aviso", body: "Sem expediente" } } as unknown as InformativeDraftPayload)).toBe(true);
    expect(needsInformative({ ...plain, company: { ...plain.company, createClient: true } } as InformativeDraftPayload)).toBe(true);
    expect(needsInformative({ ...plain, tasks: [{ ...task, category: "closing_period" }] } as unknown as InformativeDraftPayload)).toBe(true);
  });

  it("payload adulterado não passa", () => {
    expect(parseMessageMissionPlan({ version: 1, missions: [{ title: "x", priority: 2, difficulty: 2, dueDate: "amanhã", assignment: { type: "clan", clanId: CLAN } }] })).toBeNull();
    expect(parseMessageMissionPlan({ version: 1, missions: [{ title: "x", priority: 2, difficulty: 2, dueDate: null, assignment: { type: "org" } }] })).toBeNull();
  });
});
