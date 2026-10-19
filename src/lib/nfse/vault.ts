import {
  constants,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  privateDecrypt,
  type KeyObject,
} from "node:crypto";

import { z } from "zod";

/**
 * Cofre dos certificados A1 das empresas: o navegador cifra { pfx, senha }
 * com AES-256-GCM e embrulha a chave AES com a pública do serviço fiscal
 * (RSA-OAEP, SHA-256). Só o serviço fiscal tem a privada
 * (NFSE_VAULT_PRIVATE_KEY); o app e o banco só veem o envelope.
 *
 * Nenhuma mensagem de erro daqui pode carregar envelope, senha, certificado
 * ou chave: elas vão para log e para a tela.
 */

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export const vaultEnvelopeSchema = z.object({
  v: z.literal(1),
  keyId: z.string().regex(/^[0-9a-f]{16}$/),
  wrappedKey: z.string().max(1024).regex(BASE64),
  iv: z.string().max(32).regex(BASE64),
  // Um .pfx tem poucos KB; 200 mil caracteres de base64 sobram.
  ciphertext: z.string().min(1).max(200_000).regex(BASE64),
});
export type VaultEnvelope = z.infer<typeof vaultEnvelopeSchema>;

export interface VaultSecret {
  /** O .pfx em base64, como o loadNfseCertificate recebe. */
  pfx: string;
  password: string;
}

export class VaultError extends Error {}

export interface VaultKey {
  keyId: string;
  /** Chave pública SPKI (DER) em base64, publicada em nfse_settings. */
  publicKeySpki: string;
  open(envelope: VaultEnvelope): VaultSecret;
}

const AES_KEY_BYTES = 32;
const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;

/** Recebe a NFSE_VAULT_PRIVATE_KEY: a privada PEM (PKCS#8) em base64. */
export function loadVaultKey(privateKeyBase64: string): VaultKey {
  let privateKey: KeyObject;
  let spki: Buffer;
  try {
    privateKey = createPrivateKey(Buffer.from(privateKeyBase64, "base64").toString("utf8"));
    if (privateKey.asymmetricKeyType !== "rsa") throw new Error("tipo");
    spki = createPublicKey(privateKey).export({ type: "spki", format: "der" });
  } catch {
    // O erro original do OpenSSL pode ecoar pedaços do valor: não repassa.
    throw new Error("NFSE_VAULT_PRIVATE_KEY inválida.");
  }
  const keyId = createHash("sha256").update(spki).digest("hex").slice(0, 16);
  return {
    keyId,
    publicKeySpki: spki.toString("base64"),
    open(envelope) {
      if (envelope.keyId !== keyId) {
        throw new VaultError("O certificado foi cifrado com outra chave do serviço fiscal. Envie de novo.");
      }
      try {
        const aesKey = privateDecrypt(
          { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
          Buffer.from(envelope.wrappedKey, "base64"),
        );
        const iv = Buffer.from(envelope.iv, "base64");
        // O WebCrypto põe a tag do GCM no fim do texto cifrado.
        const data = Buffer.from(envelope.ciphertext, "base64");
        if (aesKey.length !== AES_KEY_BYTES || iv.length !== GCM_IV_BYTES || data.length <= GCM_TAG_BYTES) {
          throw new Error("formato");
        }
        // authTagLength fixo: sem ele o Node aceitaria uma tag curta (e fraca).
        const decipher = createDecipheriv("aes-256-gcm", aesKey, iv, { authTagLength: GCM_TAG_BYTES });
        decipher.setAuthTag(data.subarray(data.length - GCM_TAG_BYTES));
        const plain = Buffer.concat([decipher.update(data.subarray(0, data.length - GCM_TAG_BYTES)), decipher.final()]);
        const secret = JSON.parse(plain.toString("utf8")) as Partial<VaultSecret>;
        if (typeof secret.pfx !== "string" || typeof secret.password !== "string") throw new Error("conteúdo");
        return { pfx: secret.pfx, password: secret.password };
      } catch {
        throw new VaultError("Não foi possível abrir o envelope do certificado. Envie de novo.");
      }
    },
  };
}
