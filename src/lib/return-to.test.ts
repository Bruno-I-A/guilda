import { describe, expect, test } from "vitest";

import { parseReturnTo } from "./return-to";

const CLAN = "/clans/3f2a1c4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b";

describe("destinos aceitos", () => {
  test("lista de missões preserva o recorte", () => {
    expect(parseReturnTo("/tasks?view=informative&scope=clan")).toEqual({
      href: "/tasks?view=informative&scope=clan",
      label: "Missões",
    });
  });

  test("clã preserva a aba de onde a pessoa saiu", () => {
    expect(parseReturnTo(`${CLAN}?tab=closings`)).toEqual({
      href: `${CLAN}?tab=closings`,
      label: "Clã",
    });
  });

  test("mural volta para o mural", () => {
    expect(parseReturnTo("/mural")).toEqual({ href: "/mural", label: "Mural" });
  });

  test("dashboard volta para o início", () => {
    expect(parseReturnTo("/dashboard")).toEqual({
      href: "/dashboard",
      label: "Início",
    });
  });
});

describe("guarda de open redirect", () => {
  const fallback = { href: "/tasks", label: "Missões" };

  test.each([
    ["ausente", undefined],
    ["vazio", ""],
    ["host externo", "https://evil.com/phish"],
    ["barra dupla vira host", "//evil.com"],
    ["protocolo estranho", "javascript:alert(1)"],
    ["caminho desconhecido", "/settings"],
    ["clã com id inválido", "/clans/nao-e-uuid"],
    ["rota abaixo do clã", `${CLAN}/algo`],
  ])("%s cai na lista de missões", (_caso, entrada) => {
    expect(parseReturnTo(entrada)).toEqual(fallback);
  });

  test("array pega o primeiro valor e valida igual", () => {
    expect(parseReturnTo(["https://evil.com", "/tasks"])).toEqual(fallback);
  });
});
