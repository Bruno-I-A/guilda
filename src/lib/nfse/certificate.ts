import forge from "node-forge";

export interface NfseCertificate {
  privateKeyPem: string;
  /** Só o certificado da pessoa jurídica: vai no X509Data (EndCertOnly). */
  certificatePem: string;
  /** Certificado + intermediários do .pfx, para o mTLS. */
  chainPem: string;
  cnpj: string;
  validUntil: Date;
}

export class NfseCertificateError extends Error {}

/** e-CNPJ ICP-Brasil: o CN termina em ":<CNPJ>". */
function cnpjFromCertificate(cert: forge.pki.Certificate): string | null {
  const commonName = cert.subject.getField("CN")?.value;
  const match = typeof commonName === "string" ? /:(\d{14})$/.exec(commonName.trim()) : null;
  return match?.[1] ?? null;
}

/**
 * Abre o A1 (.pfx em base64) com node-forge, que lê os algoritmos antigos de
 * PKCS#12 que o OpenSSL 3 do Node recusa — por isso o mTLS usa a chave e a
 * cadeia em PEM, não o .pfx direto.
 */
export function loadNfseCertificate(pfxBase64: string, password: string): NfseCertificate {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const der = forge.util.decode64(pfxBase64.replace(/\s+/g, ""));
    p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), false, password);
  } catch {
    throw new NfseCertificateError(
      "Não foi possível abrir o certificado: arquivo inválido ou senha errada.",
    );
  }
  const shrouded = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
    forge.pki.oids.pkcs8ShroudedKeyBag
  ];
  const plain = p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag];
  const privateKey = (shrouded?.[0]?.key ?? plain?.[0]?.key) as forge.pki.rsa.PrivateKey | undefined;
  if (!privateKey) throw new NfseCertificateError("O certificado não traz a chave privada.");

  const certificates = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [])
    .map((bag) => bag.cert)
    .filter((cert): cert is forge.pki.Certificate => Boolean(cert));
  const own = certificates.find((cert) =>
    (cert.publicKey as forge.pki.rsa.PublicKey).n.equals(privateKey.n),
  );
  if (!own) throw new NfseCertificateError("Nenhum certificado do arquivo corresponde à chave privada.");
  const cnpj = cnpjFromCertificate(own);
  if (!cnpj) throw new NfseCertificateError("CNPJ não encontrado no certificado. Ele é um e-CNPJ?");

  const chain = [own, ...certificates.filter((cert) => cert !== own)];
  return {
    privateKeyPem: forge.pki.privateKeyToPem(privateKey),
    certificatePem: forge.pki.certificateToPem(own),
    chainPem: chain.map((cert) => forge.pki.certificateToPem(cert)).join(""),
    cnpj,
    validUntil: own.validity.notAfter,
  };
}
