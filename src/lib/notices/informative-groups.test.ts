import { describe, expect, it } from "vitest";

import { groupInformativeNotices } from "./informative-groups";
import { noticeTemplate, noticeText } from "./notice";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("aviso das missões de Informativo", () => {
  const tasks = [
    { id: id(1), assigneeId: "ana", title: "Folha — ACME", dueDate: new Date("2026-11-30T00:00:00Z"), xpValue: 40 },
    { id: id(2), assigneeId: "ana", title: "Pró-labore — ACME", dueDate: new Date("2026-11-27T00:00:00Z"), xpValue: 30 },
    { id: id(3), assigneeId: "bia", title: "Guia do Simples — ACME", dueDate: null, xpValue: 50 },
    { id: id(4), assigneeId: "lider", title: "Conferir — ACME", dueDate: null, xpValue: 20 },
    { id: id(5), assigneeId: null, title: "Do clã — ACME", dueDate: null, xpValue: 20 },
  ];

  it("um aviso por pessoa, sem quem pediu e sem missão só do clã", () => {
    const groups = groupInformativeNotices({ requesterId: "lider", companyName: "ACME Ltda", tasks });
    expect(groups.map((g) => g.userId)).toEqual(["ana", "bia"]);
  });

  it("várias missões viram uma lista com o prazo mais próximo e o XP somado", () => {
    const [ana] = groupInformativeNotices({ requesterId: "lider", companyName: "ACME Ltda", tasks });
    expect(ana.notice).toMatchObject({ title: "2 missões de ACME Ltda", due: "27/11/2026 (a mais próxima)", xp: 70, path: "tasks?view=informative" });
    expect(noticeText(ana.notice, null)).toContain("• Pró-labore — ACME");
    expect(noticeTemplate(ana.notice)).toMatchObject({ key: "nova_missao", bodyParams: ["2 missões de ACME Ltda", "27/11/2026 (a mais próxima)", "70"], urlRef: "ti" });
  });

  it("uma missão só vai com o botão Iniciar", () => {
    const [, bia] = groupInformativeNotices({ requesterId: "lider", companyName: null, tasks });
    expect(bia.notice).toMatchObject({ title: "Guia do Simples — ACME", due: "Sem prazo", button: { id: `task:start:${id(3)}` } });
  });
});
