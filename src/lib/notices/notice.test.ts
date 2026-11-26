import { describe, expect, it } from "vitest";

import { resolveShortRef, shortRef } from "./links";
import {
  NOTICE_TEMPLATES,
  noticeButtons,
  noticeTemplate,
  noticeText,
  parseMemberV3Payload,
  taskButton,
  templateParam,
  type Notice,
} from "./notice";

const TASK = "11111111-1111-4111-8111-111111111111";

describe("modelos dos avisos", () => {
  it("nenhum corpo começa ou termina em variável e cada variável tem exemplo", () => {
    for (const template of Object.values(NOTICE_TEMPLATES)) {
      expect(template.body.trim()).not.toMatch(/^\{\{\d+\}\}/);
      expect(template.body.trim()).not.toMatch(/\{\{\d+\}\}\.?$/);
      const variables = template.body.match(/\{\{\d+\}\}/g) ?? [];
      expect(template.examples).toHaveLength(variables.length);
      expect(template.body.length).toBeLessThan(1024);
      expect(template.name).toMatch(/^[a-z0-9_]{1,512}$/);
    }
  });

  it("variável sem quebra de linha, sem espaço longo e nunca vazia", () => {
    expect(templateParam("Linha 1\n\nLinha\t2     fim")).toBe("Linha 1 Linha 2 fim");
    expect(templateParam("   ")).toBe("-");
    expect(templateParam("a".repeat(200), 20)).toHaveLength(20);
  });
});

describe("aviso de nova missão", () => {
  const notice: Notice = {
    family: "new_mission",
    heading: "Nova missão para você",
    title: "Conferir a folha",
    context: "clã RH",
    due: "25/11/2026",
    xp: 50,
    path: `tasks/${TASK}`,
    button: taskButton("start", TASK),
  };

  it("dentro da janela vai com o link e o botão Iniciar", () => {
    const text = noticeText(notice);
    expect(text).toContain("Nova missão para você");
    expect(text).not.toMatch(/https?:|Abrir:/);
    expect(noticeButtons(notice)).toEqual([{ id: `task:start:${TASK}`, title: "Iniciar missão" }]);
  });

  it("fora da janela vira o modelo nova_missao com o caminho no botão", () => {
    expect(noticeTemplate(notice)).toEqual({
      key: "nova_missao",
      bodyParams: ["Conferir a folha (clã RH)", "25/11/2026"],
      urlRef: `t-${TASK}`,
    });
  });
});

describe("aviso de entrega para aprovação", () => {
  const notice: Notice = { family: "approval", who: "Ana", title: "Folha", xp: 40, note: "Tudo certo\nconferido", path: `tasks/${TASK}`, taskId: TASK };

  it("o botão Aprovar existe nas duas formas", () => {
    expect(noticeButtons(notice)).toEqual([{ id: `task:approve:${TASK}`, title: "Aprovar" }]);
    const call = noticeTemplate(notice);
    expect(call.key).toBe("aprovacao");
    expect(call.quickReplyPayload).toBe(`task:approve:${TASK}`);
    expect(NOTICE_TEMPLATES.aprovacao.quickReply).toBe("Aprovar");
  });

  it("o retorno aparece no texto", () => {
    expect(noticeText(notice)).toContain("Retorno: Tudo certo\nconferido");
  });
});

describe("demais famílias", () => {
  it("prazo diz se vence hoje ou está atrasada", () => {
    const notice: Notice = { family: "deadline", title: "Folha", overdue: true, due: "20/11/2026", xp: 30, path: `tasks/${TASK}` };
    expect(noticeTemplate(notice).bodyParams).toEqual(["Folha", "está atrasada (prazo 20/11/2026)"]);
    expect(noticeText(notice)).toMatch(/^Missão atrasada/);
  });

  it("aviso geral junta título e resumo numa variável", () => {
    const notice: Notice = { family: "general", heading: "Fechamento concluído", summary: "ACME, Balanço 2025", path: "closings" };
    expect(noticeTemplate(notice)).toEqual({ key: "aviso", bodyParams: ["Fechamento concluído, ACME, Balanço 2025"], urlRef: "f" });
    expect(noticeButtons(notice)).toEqual([]);
  });

  it("o texto não leva link: a ação vem nos botões (pedido do Bruno)", () => {
    const notice: Notice = { family: "daily_summary", open: 2, available: 1, xp: 300, path: "dashboard" };
    expect(noticeText(notice)).toBe("Resumo da Guilda\n\n2 missão(ões) em aberto com você\n1 disponível(is) nos seus clãs\n300 XP no total");
    expect(noticeTemplate(notice)).toEqual({ key: "resumo", bodyParams: ["2", "1"], urlRef: "d" });
  });
});

describe("referência curta do botão de link", () => {
  it("ida e volta para missão, Mural e listas", () => {
    expect(shortRef(`tasks/${TASK}`)).toBe(`t-${TASK}`);
    expect(resolveShortRef(`t-${TASK}`)).toBe(`/tasks/${TASK}`);
    expect(resolveShortRef(shortRef(`mural#aviso-${TASK}`))).toBe(`/mural#aviso-${TASK}`);
    expect(resolveShortRef(shortRef("tasks?view=informative"))).toBe("/tasks?view=informative");
    expect(resolveShortRef(shortRef("closings"))).toBe("/closings");
    expect(shortRef(`tasks/${TASK}`)).toMatch(/^[a-z0-9-]+$/);
  });

  it("referência desconhecida nunca vira endereço livre", () => {
    expect(resolveShortRef("https://evil.example")).toBe("/dashboard");
    expect(resolveShortRef("t-../../x")).toBe("/dashboard");
    expect(resolveShortRef("//evil.example")).toBe("/dashboard");
  });
});

describe("payload gravado na fila", () => {
  it("aceita aviso e resposta da versão 3", () => {
    const notice = { family: "general", heading: "x", summary: "y", path: "mural" };
    expect(parseMemberV3Payload({ version: 3, kind: "notice", preference: "mural", notice })).not.toBeNull();
    expect(parseMemberV3Payload({ version: 3, kind: "reply", text: "Oi", buttons: [{ id: "draft:cancel:1", title: "Cancelar" }] })).not.toBeNull();
  });

  it("recusa preferência, família ou botão desconhecidos", () => {
    expect(parseMemberV3Payload({ version: 3, kind: "notice", preference: "spam", notice: { family: "general", path: "x" } })).toBeNull();
    expect(parseMemberV3Payload({ version: 3, kind: "notice", preference: "tasks", notice: { family: "outra", path: "x" } })).toBeNull();
    expect(parseMemberV3Payload({ version: 3, kind: "reply", text: "Oi", buttons: [{ id: "x", title: "título longo demais para botão" }] })).toBeNull();
    expect(parseMemberV3Payload({ version: 1 })).toBeNull();
  });
});
