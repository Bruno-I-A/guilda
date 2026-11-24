import { describe, expect, it } from "vitest";

import { draftButtonId, parseMemberButton, parseMemberInbound } from "./member-inbound";

const TASK = "11111111-1111-4111-8111-111111111111";

describe("mensagem do integrante", () => {
  it("lê texto, resposta de modelo e resposta interativa", () => {
    const parsed = parseMemberInbound({
      messages: [
        { id: "wamid.1", from: "5554999990000", timestamp: "1795622400", type: "text", text: { body: "Ana, conferir a folha até sexta" } },
        { id: "wamid.2", from: "5554999990000", timestamp: "1795622401", type: "button", button: { payload: `task:approve:${TASK}`, text: "Aprovar" } },
        { id: "wamid.3", from: "5554999990000", timestamp: "1795622402", type: "interactive", interactive: { type: "button_reply", button_reply: { id: `task:start:${TASK}`, title: "Iniciar missão" } } },
        { id: "wamid.4", from: "5554999990000", timestamp: "1795622403", type: "audio", audio: { id: "1" } },
      ],
    });
    expect(parsed.map((m) => [m.kind, m.text ?? null, m.buttonId ?? null])).toEqual([
      ["text", "Ana, conferir a folha até sexta", null],
      ["button", "Aprovar", `task:approve:${TASK}`],
      ["button", "Iniciar missão", `task:start:${TASK}`],
      ["other", null, null],
    ]);
    expect(parsed[0].occurredAt.toISOString()).toBe(new Date(1795622400 * 1000).toISOString());
  });

  it("ignora mensagem sem id ou com remetente estranho", () => {
    expect(parseMemberInbound({ messages: [{ from: "55", type: "text" }, { id: "x", from: "+55abc", type: "text" }] })).toEqual([]);
    expect(parseMemberInbound({})).toEqual([]);
  });
});

describe("id do botão", () => {
  it("aceita só missão e prévia com uuid", () => {
    expect(parseMemberButton(`task:start:${TASK}`)).toEqual({ type: "task", action: "start", taskId: TASK });
    expect(parseMemberButton(draftButtonId("confirm", TASK))).toEqual({ type: "draft", decision: "confirm", draftId: TASK });
    expect(parseMemberButton(`task:delete:${TASK}`)).toBeNull();
    expect(parseMemberButton("task:start:1; drop table")).toBeNull();
    expect(parseMemberButton(undefined)).toBeNull();
  });
});
