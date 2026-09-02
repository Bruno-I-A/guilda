import { describe, expect, test } from "vitest";

import {
  dashboardShortcutOptions,
  resolveDashboardShortcuts,
} from "./dashboard-shortcuts";

describe("atalhos do dashboard", () => {
  test("oferece as áreas específicas de cada clã", () => {
    const options = dashboardShortcutOptions([
      { id: "societario-id", name: "Societário", slug: "societario" },
      { id: "contabilidade-id", name: "Contabilidade", slug: "contabilidade" },
      { id: "fiscal-id", name: "Fiscal", slug: "fiscal" },
    ]);

    expect(options).toContainEqual(expect.objectContaining({
      target: "clan:societario-id:flow",
      href: "/clans/societario-id?tab=flow",
    }));
    expect(options).toContainEqual(expect.objectContaining({
      target: "clan:contabilidade-id:closings",
      href: "/clans/contabilidade-id?tab=closings",
    }));
    expect(options).toContainEqual(expect.objectContaining({
      target: "clan:fiscal-id:mei",
      href: "/clans/fiscal-id?tab=mei",
    }));
  });

  test("preserva o nome personalizado e ignora destinos sem acesso", () => {
    const options = dashboardShortcutOptions([]);
    expect(resolveDashboardShortcuts([
      { target: "tasks", label: "Meu trabalho" },
      { target: "clan:removido:flow", label: "Sem acesso" },
    ], options)).toEqual([
      expect.objectContaining({ target: "tasks", label: "Meu trabalho" }),
    ]);
  });
});
