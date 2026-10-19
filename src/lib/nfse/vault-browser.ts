import type { VaultEnvelope } from "./vault";

/**
 * Lado do navegador do cofre (WebCrypto). Também roda no Node 22, o que
 * deixa o teste usar exatamente o mesmo código que a tela.
 *
 * Importado por componente "use client": nada de `node:*` aqui, e do
 * `vault.ts` só os tipos (import type) — o runtime dele é do serviço fiscal.
 */

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

// Retorno com ArrayBuffer explícito: o WebCrypto não aceita ArrayBufferLike como BufferSource.
function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function sealCertificate(input: {
  publicKeySpki: string;
  keyId: string;
  pfx: Uint8Array;
  password: string;
}): Promise<VaultEnvelope> {
  // O navegador só expõe o WebCrypto em contexto seguro (https ou localhost).
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("Este navegador não consegue cifrar o certificado. Abra a Guilda pelo endereço https e tente de novo.");
  }
  const rsa = await subtle.importKey("spki", fromBase64(input.publicKeySpki), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["wrapKey"]);
  const aes = await subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify({ pfx: toBase64(input.pfx), password: input.password }));
  const ciphertext = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv }, aes, plain));
  const wrappedKey = new Uint8Array(await subtle.wrapKey("raw", aes, rsa, { name: "RSA-OAEP" }));
  return { v: 1, keyId: input.keyId, wrappedKey: toBase64(wrappedKey), iv: toBase64(iv), ciphertext: toBase64(ciphertext) };
}
