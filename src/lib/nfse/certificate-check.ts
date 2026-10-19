import { formatCnpj } from "@/domain/cnpj";
import { cnpjRootMatches } from "@/domain/nfse-xml";

import { loadNfseCertificate, type NfseCertificate, NfseCertificateError } from "./certificate";
import { type VaultEnvelope, VaultError, type VaultKey, type VaultSecret } from "./vault";

export type CertificateCheck =
  | { status: "valid"; cnpj: string; validUntil: Date }
  | { status: "invalid"; message: string };

/**
 * Abre o envelope, abre o A1 e confere a raiz do CNPJ com a do cadastro.
 *
 * Certificado vencido NÃO é "invalid" aqui: a conferência devolve a validade
 * e quem mostra o estado (certificateState) compara com a data de hoje.
 * As mensagens de "invalid" vão para a tela e nunca carregam senha, envelope
 * ou conteúdo do certificado.
 */
export function checkClientCertificate(input: {
  vault: Pick<VaultKey, "open">;
  envelope: VaultEnvelope;
  clientCnpj: string | null;
}): CertificateCheck {
  if (!input.clientCnpj) return { status: "invalid", message: "A empresa está sem CNPJ no cadastro." };

  let secret: VaultSecret;
  try {
    secret = input.vault.open(input.envelope);
  } catch (error) {
    return { status: "invalid", message: error instanceof VaultError ? error.message : "Envelope inválido. Envie de novo." };
  }

  let certificate: NfseCertificate;
  try {
    certificate = loadNfseCertificate(secret.pfx, secret.password);
  } catch (error) {
    return {
      status: "invalid",
      message: error instanceof NfseCertificateError ? error.message : "O arquivo não é um certificado A1.",
    };
  }

  if (!cnpjRootMatches(certificate.cnpj, input.clientCnpj)) {
    return { status: "invalid", message: `O certificado é de outro CNPJ (${formatCnpj(certificate.cnpj)}).` };
  }
  return { status: "valid", cnpj: certificate.cnpj, validUntil: certificate.validUntil };
}
