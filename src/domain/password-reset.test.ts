import { describe, expect, test } from "vitest";

import { authorizePasswordReset, generateTemporaryPassword } from "./password-reset";

const base = { isSelf: false, targetInOtherOrganization: false };

describe("quem redefine a senha de quem", () => {
  test("owner redefine a senha de admin e de membro", () => {
    expect(authorizePasswordReset({ ...base, actorRole: "owner", targetRole: "admin" }).allowed).toBe(true);
    expect(authorizePasswordReset({ ...base, actorRole: "owner", targetRole: "member" }).allowed).toBe(true);
  });

  test("admin redefine só a de membro", () => {
    expect(authorizePasswordReset({ ...base, actorRole: "admin", targetRole: "member" }).allowed).toBe(true);
    expect(authorizePasswordReset({ ...base, actorRole: "admin", targetRole: "admin" }).allowed).toBe(false);
    expect(authorizePasswordReset({ ...base, actorRole: "admin", targetRole: "owner" }).allowed).toBe(false);
  });

  test("membro não redefine a senha de ninguém", () => {
    expect(authorizePasswordReset({ ...base, actorRole: "member", targetRole: "member" }).allowed).toBe(false);
  });

  test("ninguém redefine a própria senha por aqui", () => {
    expect(
      authorizePasswordReset({ ...base, isSelf: true, actorRole: "owner", targetRole: "owner" }),
    ).toEqual({ allowed: false, reason: "Para trocar a sua própria senha, use Alterar senha." });
  });

  test("quem participa de outra organização fica de fora, mesmo para o owner", () => {
    const decisao = authorizePasswordReset({
      ...base,
      actorRole: "owner",
      targetRole: "member",
      targetInOtherOrganization: true,
    });
    expect(decisao.allowed).toBe(false);
  });
});

describe("senha temporária", () => {
  test("tem 10 caracteres sem os ambíguos", () => {
    let i = 0;
    const senha = generateTemporaryPassword(() => i++ % 7);
    expect(senha).toHaveLength(10);
    expect(senha).not.toMatch(/[0O1lI]/);
  });

  test("usa o alfabeto inteiro conforme o índice", () => {
    expect(generateTemporaryPassword(() => 0, 3)).toBe("AAA");
    expect(generateTemporaryPassword((n) => n - 1, 2)).toBe("99");
  });
});
