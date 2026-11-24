import { describe, expect, it } from "vitest";

import {
  generateVerificationCode,
  hashVerificationCode,
  parseVerificationMessage,
  VERIFICATION_ALPHABET,
  verificationLink,
} from "./member-verification";

describe("código de confirmação do número", () => {
  it("gera 6 caracteres do alfabeto sem 0, O, 1 e I", () => {
    let i = 0;
    const code = generateVerificationCode((max) => (i++ * 7) % max);
    expect(code).toHaveLength(6);
    expect([...code].every((char) => VERIFICATION_ALPHABET.includes(char))).toBe(true);
    expect(VERIFICATION_ALPHABET).not.toMatch(/[0O1I]/);
  });

  it("o hash depende da organização e ignora maiúscula", () => {
    expect(hashVerificationCode("org-a", "4f7k2q")).toBe(hashVerificationCode("org-a", "4F7K2Q"));
    expect(hashVerificationCode("org-a", "4F7K2Q")).not.toBe(hashVerificationCode("org-b", "4F7K2Q"));
  });

  it("lê a mensagem com negrito, minúscula e dois-pontos", () => {
    expect(parseVerificationMessage("GUILDA 4F7K2Q")).toBe("4F7K2Q");
    expect(parseVerificationMessage("  *guilda* 4f7k2q ")).toBe("4F7K2Q");
    expect(parseVerificationMessage("Guilda: 4F7K2Q")).toBe("4F7K2Q");
  });

  it("não confunde conversa comum com confirmação", () => {
    expect(parseVerificationMessage("guilda")).toBeNull();
    expect(parseVerificationMessage("GUILDA 4F7K2Q obrigado")).toBeNull();
    expect(parseVerificationMessage("GUILDA 0O1I23")).toBeNull();
    expect(parseVerificationMessage(undefined)).toBeNull();
  });

  it("monta o link do WhatsApp com a mensagem pronta", () => {
    expect(verificationLink("+55 (54) 99999-0000", "4F7K2Q")).toBe("https://wa.me/5554999990000?text=GUILDA%204F7K2Q");
    expect(verificationLink("", "4F7K2Q")).toBeNull();
  });
});
