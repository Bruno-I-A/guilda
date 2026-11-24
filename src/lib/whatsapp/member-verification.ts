import { createHash } from "node:crypto";

/**
 * Confirmação do número do integrante (2026-11-24). O Perfil gera o código, a
 * pessoa manda "GUILDA <código>" do próprio WhatsApp ao escritório e a Guilda
 * confere. Só o hash fica no banco; o código vale 30 minutos.
 *
 * Sem 0/O e 1/I: o código é lido na tela e digitado à mão no computador.
 */
export const VERIFICATION_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const VERIFICATION_CODE_LENGTH = 6;
export const VERIFICATION_TTL_MS = 30 * 60 * 1000;

export function generateVerificationCode(randomInt: (max: number) => number): string {
  let code = "";
  for (let i = 0; i < VERIFICATION_CODE_LENGTH; i++) {
    code += VERIFICATION_ALPHABET[randomInt(VERIFICATION_ALPHABET.length)];
  }
  return code;
}

/** O hash leva a organização: o mesmo código em outra org não confere. */
export function hashVerificationCode(orgId: string, code: string): string {
  return createHash("sha256")
    .update("guilda:member-whatsapp:verification:v1\0", "utf8")
    .update(orgId, "utf8")
    .update("\0", "utf8")
    .update(code.toUpperCase(), "utf8")
    .digest("hex");
}

/**
 * "GUILDA 4F7K2Q", com ou sem negrito do WhatsApp, maiúscula ou não. Qualquer
 * outra coisa não é tentativa de confirmação e segue o caminho normal.
 */
export function parseVerificationMessage(text: string | undefined | null): string | null {
  if (!text) return null;
  const clean = text.replace(/[*_~`]/g, "").trim();
  const match = /^guilda[\s:-]+([a-z0-9]{6})$/i.exec(clean);
  if (!match) return null;
  const code = match[1].toUpperCase();
  return [...code].every((char) => VERIFICATION_ALPHABET.includes(char)) ? code : null;
}

/** Abre o WhatsApp com a mensagem pronta para o número do escritório. */
export function verificationLink(officePhone: string, code: string): string | null {
  const digits = officePhone.replace(/\D/g, "");
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(`GUILDA ${code}`)}`;
}
