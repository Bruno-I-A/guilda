// Gera a NFSE_VAULT_PRIVATE_KEY do guilda-fiscal: uma chave RSA de 3072 bits
// em PEM (PKCS#8), em base64. Rode, copie a linha para a variável no
// Easypanel e não guarde em mais lugar nenhum.
//   node scripts/nfse-vault-key.mjs
import { generateKeyPairSync } from "node:crypto";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 3072 });
process.stdout.write(`${Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" })).toString("base64")}\n`);
