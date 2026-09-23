import { describe, expect, test } from "vitest";

import { informativeDraftPayloadSchema } from "@/lib/ai/informative-schema";
import { buildStructuredInformativePayload } from "./structured";
import {
  informativeTasksRevision,
  reviseInformativeTasks,
} from "./revision";

const societario = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Societário",
};
const financeiro = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Financeiro",
};

function draft() {
  return buildStructuredInformativePayload({
    clans: [societario, financeiro],
    missions: [
      {
        clanId: societario.id,
        description: "Atualizar cadastro na Junta Comercial.",
      },
    ],
  });
}

describe("edição de missões na prévia", () => {
  test("edita título e descrição sem alterar os vínculos técnicos da missão", () => {
    const original = draft();
    const revised = reviseInformativeTasks(original, {
      type: "edit",
      index: 0,
      title: "Conferir cadastro",
      description: "Conferir os dados antes de atualizar a Junta.",
      destination: null,
    });

    expect(revised.tasks[0]).toMatchObject({
      title: "Conferir cadastro",
      description: "Conferir os dados antes de atualizar a Junta.",
      category: "general",
      clanId: societario.id,
      assignmentType: "clan",
    });
    expect(revised.tasks[0].sourceSection).toBe(original.tasks[0].sourceSection);
    expect(informativeTasksRevision(revised.tasks)).not.toBe(
      informativeTasksRevision(original.tasks),
    );
  });

  test("adiciona missão para clã escolhido e remove outra sem mudar o restante da prévia", () => {
    const original = draft();
    const added = reviseInformativeTasks(original, {
      type: "add",
      title: "Cobrar honorários",
      description: "Emitir a cobrança combinada com o cliente.",
      destination: financeiro,
    });
    const removed = reviseInformativeTasks(added, { type: "remove", index: 0 });

    expect(added.tasks).toHaveLength(2);
    expect(removed.tasks).toHaveLength(1);
    expect(removed.tasks[0]).toMatchObject({
      title: "Cobrar honorários",
      clanId: financeiro.id,
      assignmentType: "clan",
    });
    expect(removed.company).toEqual(original.company);
    expect(removed.observations).toEqual(original.observations);
  });

  test("editar destino resolve missão pendente e índice inexistente é rejeitado", () => {
    const original = draft();
    const pending = informativeDraftPayloadSchema.parse({
      ...original,
      tasks: [
        {
          ...original.tasks[0],
          assignmentType: "pending",
          assigneeId: null,
          assigneeName: null,
          clanId: null,
          clanName: null,
          reason: "Clã não identificado.",
        },
      ],
    });
    const revised = reviseInformativeTasks(pending, {
      type: "edit",
      index: 0,
      title: pending.tasks[0].title,
      description: pending.tasks[0].description,
      destination: societario,
    });

    expect(revised.tasks[0]).toMatchObject({
      assignmentType: "clan",
      clanId: societario.id,
    });
    expect(() => reviseInformativeTasks(original, { type: "remove", index: 5 })).toThrow(
      RangeError,
    );
  });
});
