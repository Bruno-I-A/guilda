import { randomBytes } from "node:crypto";
import { describe, expect, test } from "vitest";

import {
  decryptFlowSecretWithKey,
  encryptFlowSecretWithKey,
} from "./secrets";

describe("cofre do Fluxo", () => {
  test("cifra e recupera a senha sem mantê-la em texto aberto", () => {
    const key = randomBytes(32);
    const encrypted = encryptFlowSecretWithKey("senha-muito-secreta", key);

    expect(encrypted.ciphertext).not.toContain("senha-muito-secreta");
    expect(decryptFlowSecretWithKey(encrypted, key)).toBe("senha-muito-secreta");
  });
});
