import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteUser: vi.fn(),
  findUserByEmail: vi.fn(),
  hash: vi.fn(),
  linkAccount: vi.fn(),
  createUser: vi.fn(),
  releaseOrphanedUserEmail: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth-orphan", () => ({
  releaseOrphanedUserEmail: mocks.releaseOrphanedUserEmail,
}));
vi.mock("@/lib/auth", () => ({
  auth: {
    $context: Promise.resolve({
      internalAdapter: {
        createUser: mocks.createUser,
        deleteUser: mocks.deleteUser,
        findUserByEmail: mocks.findUserByEmail,
        linkAccount: mocks.linkAccount,
      },
      password: { hash: mocks.hash },
    }),
  },
}));

import { createUserWithPassword } from "@/lib/auth-admin";

const input = {
  name: "Pessoa nova",
  email: " Financeiro@Example.com ",
  password: "senha-temporaria",
  mustChangePassword: true,
};

describe("createUserWithPassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hash.mockResolvedValue("hash-novo");
    mocks.createUser.mockResolvedValue({ id: "new-user" });
    mocks.linkAccount.mockResolvedValue({ id: "new-account" });
    mocks.deleteUser.mockResolvedValue(undefined);
  });

  test("libera uma conta órfã e cria uma identidade nova com o mesmo e-mail", async () => {
    mocks.findUserByEmail.mockResolvedValue({
      user: { id: "old-user" },
      accounts: [],
    });
    mocks.releaseOrphanedUserEmail.mockResolvedValue(true);

    await expect(createUserWithPassword(input)).resolves.toEqual({
      ok: true,
      userId: "new-user",
    });

    expect(mocks.releaseOrphanedUserEmail).toHaveBeenCalledWith(
      "financeiro@example.com",
    );
    expect(mocks.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "financeiro@example.com",
        name: "Pessoa nova",
        mustChangePassword: true,
      }),
    );
    expect(mocks.linkAccount).toHaveBeenCalledWith({
      userId: "new-user",
      providerId: "credential",
      accountId: "new-user",
      password: "hash-novo",
    });
  });

  test("não toma o e-mail de uma conta que ainda está ativa", async () => {
    mocks.findUserByEmail.mockResolvedValue({
      user: { id: "active-user" },
      accounts: [],
    });
    mocks.releaseOrphanedUserEmail.mockResolvedValue(false);

    await expect(createUserWithPassword(input)).resolves.toEqual({
      ok: false,
      reason: "email_taken",
    });
    expect(mocks.hash).not.toHaveBeenCalled();
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  test("remove a conta incompleta quando a credencial não pode ser vinculada", async () => {
    mocks.findUserByEmail.mockResolvedValue(null);
    mocks.linkAccount.mockRejectedValue(new Error("falha"));

    await expect(createUserWithPassword(input)).resolves.toEqual({
      ok: false,
      reason: "create_failed",
    });
    expect(mocks.deleteUser).toHaveBeenCalledWith("new-user");
  });
});
